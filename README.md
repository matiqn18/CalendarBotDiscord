# Discord Calendar Reminder Bot

Node.js-based Discord bot that integrates with a WebDAV calendar (e.g., from ownCloud, Nextcloud) using `.ics` files. It parses calendar events and sends reminders to a specified Discord channel.


## 🚀 Features

- Parses recurring and one-time calendar events from `.ics` files.
- Supports `VALARM` reminders (e.g. 30 minutes before).
- Sends:
  - A reminder the day before (8 PM).
  - A morning reminder (8 AM).
  - Additional reminders based on calendar-defined VALARMs.
- Supports slash command `/next` to show upcoming events.
- **Ready-to-use Docker setup included** for easy deployment.

## 🛠️ Setup

### Running on Node Server

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
4. Run script:
   ```bash
   node index.js
   
### Running with Docker

This project includes a `Dockerfile` and `docker-compose.yml` for simple deployment and management.

To run the bot using Docker:

1. Clone the repository.
2. start directly with docker-compose:
   ```bash
   docker-compose up -d

## 📜 License
MIT – Use it freely and modify as needed.

## 👤 Author
Michał Łukaszczyk
   
