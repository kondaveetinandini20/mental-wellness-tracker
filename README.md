# Mindful Streak

A responsive mental wellness habit tracker built from the supplied SRS. It uses a small Node.js server and a plain HTML/CSS/JavaScript frontend, with no package dependencies.

## Run it

1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run `npm start`.
4. Visit [http://localhost:3000](http://localhost:3000) and create an account.

The server creates a `.data` folder for account and wellness data. Wellness profiles, habits, moods, and reflections are encrypted at rest; the encryption key is stored in `.data` for local development. This folder is excluded from Git. Keep a separate, secure backup of this folder if you run the app yourself; users can also export and restore their own account data in Settings.

## Included

- Email/password registration and sign-in; passwords are salted and hashed with scrypt.
- Server-backed accounts so users can sign in from more than one device connected to the same server.
- Starter habits, a wellness habit library, custom habits, daily progress, reminders, streaks, and streak freezes.
- XP, levels, milestone badges, mood check-ins, a calendar, 30/90-day completion rates, and weekly reflections.
- Dark mode, timezone-aware day boundaries, configurable quiet hours, and browser notification reminders while the site is open.
- Optional buddy invitations for existing accounts, predefined encouragement nudges, and an opt-in friends leaderboard.

## Notes before a public launch

This is a self-hostable starter app, not a managed production service. The included JSON store is suitable for local development and a single server instance; use a managed database and automated backups for a public or multi-instance deployment. For production, set `NODE_ENV=production`, put the app behind HTTPS, and set `DATA_ENCRYPTION_KEY` to a base64-encoded 32-byte key (for example, generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`). Keep that key safe and back it up separately; losing it makes encrypted account data unreadable. Browser reminders only fire while the website is open, and buddy invitations are delivered in-app to an existing account; this version does not send email or web push notifications.
