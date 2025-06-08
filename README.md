# Discord Calendar Reminder Bot

Node.js Discord bot that integrates with a WebDAV calendar (e.g., ownCloud, Nextcloud) using `.ics` files. It parses both recurring and one-time calendar events, supports VALARM reminders, and sends timely notifications to a specified Discord channel.

---

## 🚀 Features

- Parses recurring and single-instance events from `.ics` calendar files.
- Supports VALARM reminders (e.g., 30 minutes before event).
- Sends scheduled reminders:
  - Day-before reminder at 8 PM.
  - Morning reminder at 8 AM on the event day.
  - Custom VALARM reminders based on calendar settings.
- Provides slash commands:
  - `/next` — Shows next 3 upcoming events.
  - `/clr` — Cleans a specified number of messages (admin only).
  - `/token` — Generates a Forgejo runner registration token via API.
- Ready-to-use Docker setup for easy deployment.

---

## 🛠️ Setup

### Running Locally

1. Clone the repository:
2. Install dependencies:
   ```bash
   npm install
   cd <repo-folder>```
3. Create a `.env` file with the required variables (see below).  
4. Run the bot:
   ```bash
   node index.js```

### Running with Docker

This project includes a `Dockerfile` and `docker-compose.yml` for simple deployment and management.

To run the bot using Docker:

1. Clone the repository.  
2. Create a `.env` file with the required variables (see below).  
3. Run with docker-compose:
   ```bash
   docker-compose up -d```

---


## 📋 Environment Variables

Create a `.env` file in the root of the project with the following variables:
   
### WebDAV (ownCloud/Nextcloud) configuration
- WEBDAV_URL= # Full URL to your WebDAV calendar directory (e.g., https://cloud.example.com/remote.php/dav/calendars/username/)
- WEBDAV_USERNAME= # Username for WebDAV access
- WEBDAV_PASSWORD= # Password for WebDAV access

### Discord Bot configuration
- DISCORD_TOKEN= # Your Discord bot token
- CHANNEL_ID= # ID of the Discord channel where reminders will be sent

### Forgejo API configuration (optional, for /token command)
- FORGEJO_API= # Base URL of your Forgejo instance API (e.g., https://forgejo.example.com/api/v1)
- FORGEJO_ORG= # Forgejo organization name
- FORGEJO_TOKEN= # Personal access token with permission to get runner registration tokens

---


## ⚙️ Bot Commands

- `/next` — Shows the next 3 upcoming calendar events.  
- `/clr [ilosc]` — Deletes the specified number of recent messages in the current channel (admin only).  
- `/token` — Generates and sends a Forgejo runner registration token.

---


## 🔄 How it works

- Loads `.ics` calendar files from the WebDAV directory.  
- Parses single and recurring events, handling exceptions and modifications.  
- Schedules reminders based on:  
  - Event date (day before at 8 PM and event day at 8 AM).  
  - VALARM alarms defined inside calendar events.  
- Sends reminders to the specified Discord channel.  
- Supports repeated scheduled checks every hour.

---

## 👤 Author

Michał Łukaszczyk

---

## 📜 License

MIT License — feel free to use and modify as needed.
