require('dotenv').config(); 
// Load environment variables from .env file

const { createClient } = require('webdav');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const ical = require('node-ical');
const { RRule } = require('rrule');
const path = require('path');


// Create a WebDAV client to access calendar files with credentials from environment variables
const clientCAL = createClient(
    process.env.WEBDAV_URL,
    {
        username: process.env.WEBDAV_USERNAME,
        password: process.env.WEBDAV_PASSWORD
    }
);

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

const FORGEJO_API = process.env.FORGEJO_API;
const FORGEJO_ORG = process.env.FORGEJO_ORG;
const FORGEJO_TOKEN = process.env.FORGEJO_TOKEN;

let previousUIDs = new Set(); // Stores UIDs of previously loaded events to detect new ones
let initialLoadDone = false;  // Flag to check if initial events load is done

// Define slash commands for the Discord bot
const nextCommand = new SlashCommandBuilder()
  .setName('next')
  .setDescription('Show upcoming calendar events');

const clrCommand = new SlashCommandBuilder()
  .setName('clr')
  .setDescription('Clear a specified number of recent messages (admin only)')
  .addIntegerOption(option =>
    option.setName('ilosc')
      .setDescription('Number of messages to delete')
      .setRequired(true)
  );

const tokenGenCommand = new SlashCommandBuilder()
  .setName('token')
  .setDescription('Generate a token for Forgejo runner');

const commands = [nextCommand, clrCommand, tokenGenCommand ].map(command => command.toJSON());

// Initialize REST API client for registering slash commands with Discord
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands('1374840486811926588'), // Discord application ID
      { body: commands }
    );
    console.log('Commands registered!');
  } catch (error) {
    console.error(error);
  }
})();

// Convert a UTC date to Europe/Warsaw local time zone
function toLocal(dateUTC) {
  return new Date(dateUTC.toLocaleString('en-US', { timeZone: 'Europe/Warsaw' }));
}

// Create a Discord client with required intents for guilds and messages
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

let allEvents = []; // Array to hold all parsed calendar events
const scheduledReminders = new Set(); // Track scheduled reminders to avoid duplicates

// Load calendar events from WebDAV, parse .ics files and process recurrence rules, exceptions, and alarms
async function loadEvents() {
  try {
    // Fetch directory contents from WebDAV root
    const directoryItems = await clientCAL.getDirectoryContents("/");
    // Filter .ics calendar files
    const icsFiles = directoryItems.filter(item => item.filename.endsWith('.ics'));

    const modifications = {}; // Store event modifications (recurrence overrides)
    const exdates = {};      // Store exception dates for recurring events

    let events = [];

    // Parse each .ics file
    for (const file of icsFiles) {
      const fileContent = await clientCAL.getFileContents(file.filename, { format: "text" });
      const parsed = ical.parseICS(fileContent);

      for (const key in parsed) {
        const ev = parsed[key];
        if (ev.type === 'VEVENT') {
          const uid = ev.uid;

          // Handle recurrence overrides (modifications)
          if (ev['recurrenceid']) {
            if (!modifications[uid]) modifications[uid] = {};
            modifications[uid][ev.recurrenceid.toISOString()] = ev;
            continue;
          }

          // Collect exception dates to exclude from recurrence
          if (ev.exdate) {
            if (!exdates[uid]) exdates[uid] = new Set();
            for (const date of Object.values(ev.exdate)) {
              exdates[uid].add(date.toISOString());
            }
          }

          const alarms = ev.alarms || [];
          const duration = ev.end - ev.start;

          // Handle recurring events with RRule
          if (ev.rrule) {
            const rule = new RRule({
              ...ev.rrule.origOptions,
              dtstart: ev.start
            });

            // Get occurrences within the next 21 days
            const occurrences = rule.between(new Date(), new Date(Date.now() + 1000 * 60 * 60 * 24 * 21), true);

            for (const date of occurrences) {
              const isoDate = date.toISOString();

              // Skip exceptions
              if (exdates[uid] && exdates[uid].has(isoDate)) continue;

              // Use overridden event if exists for this occurrence
              const overridden = modifications[uid]?.[isoDate];
              const start = overridden ? overridden.start : date;
              const end = overridden ? overridden.end : new Date(date.getTime() + (ev.end.getTime() - ev.start.getTime()));
              const summary = overridden ? overridden.summary : ev.summary;
              const description = overridden ? overridden.description : ev.description;
              const alarmsFinal = overridden ? overridden.alarms || [] : alarms;

              events.push({
                summary,
                start,
                end,
                description,
                uid: uid + isoDate,
                alarms: alarmsFinal.map(alarm => ({
                  trigger: alarm.trigger,
                  action: alarm.action
                }))
              });
            }
          } else {
            // Non-recurring event
            events.push({
              summary: ev.summary,
              start: toLocal(ev.start),
              end: toLocal(ev.end),
              description: ev.description || '',
              uid: ev.uid,
              alarms: alarms.map(alarm => ({
                trigger: alarm.trigger,
                action: alarm.action
              }))
            });
          }
        }
      }
    }

    // Create a set of current event UIDs
    const currentUIDs = new Set(events.map(ev => ev.uid));

    if (initialLoadDone) {
      // Find new events that were not present before
      const newEvents = events.filter(ev => !previousUIDs.has(ev.uid));

      // Send notification for new events if Discord client is ready
      if (client.isReady() && newEvents.length > 0) {
        const channel = await client.channels.fetch(CHANNEL_ID);
        for (const ev of newEvents) {
          await channel.send(`📌 New event added: **${ev.summary}** on ${formatDate(ev.start)}`);
        }
      }
    } else {
      // First load - just log without sending messages
      console.log(`Initial load: ${events.length} events`);
      initialLoadDone = true;
    }

    previousUIDs = currentUIDs;

    // Sort events chronologically
    events.sort((a, b) => a.start - b.start);
    allEvents = events;

    console.log(`Loaded ${allEvents.length} events (including those with alarms, if any).`);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

// Format date to readable Polish locale string with time
function formatDate(date) {
  return date.toLocaleString('pl-PL', { 
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', 
    hour: '2-digit', minute: '2-digit' 
  });
}

// Send reminders the evening before and the morning of events
async function dayBeforeAndMorningReminder(testdate = null) {
  if (!client.isReady()) return;

  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel) return;

  const now = testdate || new Date();
  now.setSeconds(0, 0);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setSeconds(0, 0);

    
  for (const event of allEvents) {
    const start = event.start;

    // Reminder at 20:00 the day before the event
    if (
      now.getHours() === 20 &&
      tomorrow.getDate() === start.getDate() &&
      tomorrow.getMonth() === start.getMonth() &&
      tomorrow.getFullYear() === start.getFullYear()
    ) {
      channel.send(`📅 Reminder 📅 \n Tomorrow ${formatDate(start)} there is an event: **${event.summary}** \n <@&1375053450613624903>`);
    }

    // Reminder at 8:00 on the day of the event
    if (
      now.getHours() === 8 &&
      now.getDate() === start.getDate() &&
      now.getMonth() === start.getMonth() &&
      now.getFullYear() === start.getFullYear()
    ) {
      channel.send(`📅 Reminder 📅 \n Today ${formatDate(start)} there is an event: **${event.summary}** \n <@&1375053360192819240>`);
    }
  }
}

// Schedule the daily checks to run reminders at 8:00 and 18:00 local time
function scheduleDailyChecks() {
  const now = new Date();

  // Calculate next 8:00 and 18:00 times
  const next8 = new Date(now);
  next8.setHours(8, 0, 0, 0);
  if (now >= next8) next8.setDate(next8.getDate() + 1);

  const next18 = new Date(now);
  next18.setHours(18, 0, 0, 0);
  if (now >= next18) next18.setDate(next18.getDate() + 1);

  const msTo8 = next8 - now;
  const msTo18 = next18 - now;

  // Schedule first reminder at 8:00 and repeat every 24 hours
  setTimeout(function runAt8() {
    dayBeforeAndMorningReminder();
    setInterval(dayBeforeAndMorningReminder, 24 * 60 * 60 * 1000); 
  }, msTo8);

  // Schedule first reminder at 18:00 and repeat every 24 hours
  setTimeout(function runAt18() {
    dayBeforeAndMorningReminder();
    setInterval(dayBeforeAndMorningReminder, 24 * 60 * 60 * 1000); 
  }, msTo18);
}

// Schedule reminders for upcoming events based on VALARM triggers
function scheduleUpcomingReminders() {
  const now = new Date();

  allEvents.forEach(event => {
    if (!event.alarms || !event.alarms.length) return;

    event.alarms.forEach(alarm => {
      let triggerOffset = 0;

      // Calculate trigger offset in milliseconds if alarm trigger is a duration object
      if (typeof alarm.trigger === 'object' && alarm.trigger.before && alarm.trigger.duration) {
        const duration = alarm.trigger.duration;
        triggerOffset = duration.as('milliseconds');
        if (alarm.trigger.before) {
          triggerOffset = -triggerOffset;
        }
      }

      // Calculate reminder time and delay from now
      const reminderTime = new Date(event.start.getTime() + triggerOffset);
      const delay = reminderTime - now;

      // Schedule reminder if it's in the future and within 1 hour from now
      if (delay > 0 && delay < 1000 * 60 * 60 ) { 
        if (!scheduledReminders.has(event.uid + alarm.trigger.toString())) {
          scheduledReminders.add(event.uid + alarm.trigger.toString());

          setTimeout(async () => {
            const channel = await client.channels.fetch(CHANNEL_ID);
            if (channel) {
              channel.send(`⏰ Event ⏰ - **${event.summary}** is starting now \n @everyone`);
            }
          }, delay);

          console.log(`Scheduled VALARM reminder for ${event.summary} in ${Math.round(delay / 1000)} seconds`);
        }
      }
    });
  });
}

// Handle slash commands from Discord interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'next') {
    const now = new Date();

    // Get next 3 upcoming events
    const upcoming = allEvents
      .filter(ev => ev.start >= now)
      .slice(0, 3);

    if (upcoming.length === 0) {
      await interaction.reply("No upcoming events.");
      return;
    }

    let reply = 'Next 3 events:\n';
    upcoming.forEach(ev => {
      reply += `• **${ev.summary}** — ${formatDate(ev.start)}\n`;
    });

    await interaction.reply(reply);
  }

  if (interaction.commandName === 'clr') {
    // Check if user has admin permissions
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
    }

    const amount = interaction.options.getInteger('ilosc');

    if (amount < 1 || amount > 100) {
      return interaction.reply({ content: '❗ You can delete between 1 and 100 messages.', ephemeral: true });
    }

    try {
      // Bulk delete specified amount of messages
      const messages = await interaction.channel.bulkDelete(amount, true);
      await interaction.reply({ content: `✅ Deleted ${messages.size} messages.`, ephemeral: true });
    } catch (error) {
      console.error('Error deleting messages:', error);
      await interaction.reply({ content: '❌ An error occurred while deleting messages.', ephemeral: true });
    }
  }

  if (interaction.commandName === 'token') {
    // Generate a Forgejo runner registration token via API
    try {
      const response = await fetch(`${FORGEJO_API}/orgs/${FORGEJO_ORG}/actions/runners/registration-token`, {
        method: 'GET',
        headers: {
          'Authorization': `token ${FORGEJO_TOKEN}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Forgejo API error: ${err}`);
      }

      const json = await response.json();
      const token = json.token;

      await interaction.reply(`Forgejo runner registration token:\n\`${token}\``);
    } catch (error) {
      console.error(error);
      await interaction.reply('Failed to fetch Forgejo token.');
    }
  }
});

// When the bot is ready, load calendar events and set reminders
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  loadEvents();
  setInterval(loadEvents, 1000 * 60 * 5); // Reload events every 5 minutes to get updates

  scheduleDailyChecks();
  setInterval(scheduleUpcomingReminders, 1000 * 60); // Check for VALARM reminders every minute
});

// Log in to Discord
client.login(DISCORD_TOKEN);

