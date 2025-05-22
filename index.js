// Required modules
const { createClient } = require('webdav'); // For accessing WebDAV calendar
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js'); // Discord bot API
const ical = require('node-ical'); // For parsing .ics calendar files
const { RRule } = require('rrule'); // For recurring events (RRULE support)

// WebDAV calendar client setup
const clientCAL = createClient("LINK TO CALLENDAR FILE ICAL", {
    username: "",
    password: ""
});

// Discord bot credentials
const DISCORD_TOKEN = '';
const CHANNEL_ID = '';

// Define Discord slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('next')
    .setDescription('Show upcoming calendar events'),
].map(command => command.toJSON());

// Register slash commands
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands('BOT PUBLIC KEY'),
      { body: commands }
    );
    console.log('Slash commands registered!');
  } catch (error) {
    console.error(error);
  }
})();

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

let allEvents = [];
const scheduledReminders = new Set();

// Load events from the WebDAV calendar (.ics files)
async function loadEvents() {
  try {
    const directoryItems = await clientCAL.getDirectoryContents("/");
    const icsFiles = directoryItems.filter(item => item.filename.endsWith('.ics'));

    let events = [];

    for (const file of icsFiles) {
      const fileContent = await clientCAL.getFileContents(file.filename, { format: "text" });
      const parsed = ical.parseICS(fileContent);

      for (const key in parsed) {
        const ev = parsed[key];
        if (ev.type === 'VEVENT') {
          const alarms = ev.alarms || [];

          // Handle recurring events (RRULE)
          if (ev.rrule) {
            const occurrences = ev.rrule.between(new Date(), new Date(Date.now() + 1000 * 60 * 60 * 24 * 14), true);

            for (const date of occurrences) {
              events.push({
                summary: ev.summary,
                start: date,
                end: new Date(date.getTime() + (ev.end.getTime() - ev.start.getTime())),
                description: ev.description || '',
                uid: ev.uid + date.toISOString(),
                alarms: alarms.map(alarm => ({
                  trigger: alarm.trigger,
                  action: alarm.action
                }))
              });
            }
          } else {
            events.push({
              summary: ev.summary,
              start: ev.start,
              end: ev.end,
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

    events.sort((a, b) => a.start - b.start);
    allEvents = events;

    console.log(`Loaded ${allEvents.length} events (with alarms if present).`);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

// Format date into a readable string
function formatDate(date) {
  return date.toLocaleString('pl-PL', { 
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', 
    hour: '2-digit', minute: '2-digit' 
  });
}

// Send reminders the day before and the morning of the event
async function dayBeforeAndMorningReminder(testdate = null) {
  if (!client.isReady()) return;

  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel) return;

  const now = testdate || new Date();
  now.setSeconds(0, 0);

  for (const event of allEvents) {
    const start = event.start;

    // Day-before reminder at 8 PM
    if (
      now.getHours() === 20 &&
      now.getDate() === start.getDate() - 1 &&
      now.getMonth() === start.getMonth() &&
      now.getFullYear() === start.getFullYear()
    ) {
      channel.send(`📅 Reminder 📅 \n Tomorrow ${formatDate(start)} event: **${event.summary}** \n `);
    }

    // Morning reminder at 8 AM
    if (
      now.getHours() === 8 &&
      now.getDate() === start.getDate() &&
      now.getMonth() === start.getMonth() &&
      now.getFullYear() === start.getFullYear()
    ) {
      channel.send(`📅 Reminder 📅 \n Today ${formatDate(start)} event: **${event.summary}** \n`);
    }
  }
}

// Schedule daily checks for reminders
function scheduleDailyChecks() {
  const now = new Date();

  const next8 = new Date(now);
  next8.setHours(8, 0, 0, 0);
  if (now >= next8) next8.setDate(next8.getDate() + 1);

  const next18 = new Date(now);
  next18.setHours(18, 0, 0, 0);
  if (now >= next18) next18.setDate(next18.getDate() + 1);

  const msTo8 = next8 - now;
  const msTo18 = next18 - now;

  setTimeout(function runAt8() {
    dayBeforeAndMorningReminder();
    setInterval(dayBeforeAndMorningReminder, 24 * 60 * 60 * 1000); 
  }, msTo8);

  setTimeout(function runAt18() {
    dayBeforeAndMorningReminder();
    setInterval(dayBeforeAndMorningReminder, 24 * 60 * 60 * 1000); 
  }, msTo18);
}

// Schedule reminders based on VALARM definitions from calendar
function scheduleUpcomingReminders() {
  const now = new Date();

  allEvents.forEach(event => {
    if (!event.alarms || !event.alarms.length) return;

    event.alarms.forEach(alarm => {
      let triggerOffset = 0;

      if (typeof alarm.trigger === 'object' && alarm.trigger.before && alarm.trigger.duration) {
        const duration = alarm.trigger.duration;
        triggerOffset = duration.as('milliseconds');
        if (alarm.trigger.before) {
          triggerOffset = -triggerOffset;
        }
      }

      const reminderTime = new Date(event.start.getTime() + triggerOffset);
      const delay = reminderTime - now;

      if (delay > 0 && delay < 1000 * 60 * 60 ) {
        if (!scheduledReminders.has(event.uid + alarm.trigger.toString())) {
          scheduledReminders.add(event.uid + alarm.trigger.toString());

          setTimeout(async () => {
            const channel = await client.channels.fetch(CHANNEL_ID);
            if (channel) {
              channel.send(`⏰ Event reminder ⏰ - **${event.summary}** is about to start\n @everyone`);
            }
          }, delay);

          console.log(`Scheduled VALARM for ${event.summary} in ${Math.round(delay / 1000)} seconds`);
        }
      }
    });
  });
}

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'next') {
    const now = new Date();

    const upcoming = allEvents
      .filter(ev => ev.start >= now)
      .slice(0, 3);

    if (upcoming.length === 0) {
      await interaction.reply("No upcoming events.");
      return;
    }

    let reply = 'Next 3 upcoming events:\n';
    upcoming.forEach(ev => {
      reply += `• **${ev.summary}** — ${formatDate(ev.start)}\n`;
    });

    await interaction.reply(reply);
  }
});

// Optional test function to confirm bot is online
async function sendTestMessage() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    await channel.send("Bot is online and ready!");
    console.log("Test message sent");
  } catch (error) {
    console.error("Error sending test message:", error);
  }
}

// On bot ready
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await loadEvents();

  scheduleDailyChecks();
  scheduleUpcomingReminders();

  setInterval(scheduleUpcomingReminders, 1000 * 60 * 60); // Rescan VALARMs every hour
  setInterval(loadEvents, 1000 * 60 * 60 * 12); // Refresh events every 12 hour
});

// Start the bot
client.login(DISCORD_TOKEN);