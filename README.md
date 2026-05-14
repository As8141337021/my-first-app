# Trade Tracker App

A simple React application to record daily trading transactions with email login and Firebase storage.

## Features
- Email/password login and account creation
- Add trade records with share name, buy/sell price, quantity, and notes
- Automatically compute profit/loss per trade
- Store data per user in Firebase Firestore

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a Firebase project at https://console.firebase.google.com
3. Enable Email/Password authentication in Firebase Authentication
4. Create a Firestore database in test or locked mode
5. Replace the values in `src/firebase.js` with your Firebase config

## Run

```bash
npm run dev
```

Open the local URL shown in the terminal.

## Notes
- The app uses `firebase` client SDK and Firestore to save trades per user.
- You can edit and delete saved trades.
- A monthly summary and total profit/loss are shown for your records.
- You can export all trades to CSV for offline analysis.
- The login persists across refreshes as long as the browser session remains active.
