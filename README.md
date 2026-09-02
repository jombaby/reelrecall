# Recipe Reel Library

## AI organization

ReelRecall can categorize and tag newly imported videos from available titles, captions, and descriptions. Copy `.env.example` to `.env.local` and set `OPENAI_API_KEY`. For Vercel, add the same environment variable in Project Settings → Environment Variables and redeploy.

Manual category and tag edits are stored as locked choices. Automatic organization and later WhatsApp imports do not overwrite them.

A private, browser-based catalog for recipe links saved in WhatsApp. It recognizes Instagram Reel, Facebook Reel, and `fb.watch` links from a WhatsApp chat export.

## Features

- Import a WhatsApp `_chat.txt` export without media
- Add, edit, delete, search, categorize, tag, and favorite recipe links
- Skip duplicate links during imports
- Export and restore a JSON backup
- Responsive layout for iPhone, iPad, and desktop
- No database or environment variables required

## Run locally on macOS

Install [Node.js LTS](https://nodejs.org/) and then run:

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Import WhatsApp links

On the iPhone, open WhatsApp, open the **Message yourself** chat, tap the contact/chat name, choose **Export Chat**, and select **Without Media**. AirDrop or save the resulting export to the Mac, unzip it, then choose the `.txt` file in the app.

## Important storage note

This version stores data in the current browser's local storage. Use **Export backup** regularly and before clearing browser data. Data is not automatically shared across devices.

## Deploy with Vercel CLI

```bash
npm install
npm run build
npm install -g vercel
vercel login
vercel
vercel --prod
```

## Deploy from GitHub

Create an empty GitHub repository, then run the Git commands shown in `DEPLOY_MAC.md`. In Vercel, choose **Add New → Project**, import the repository, and click **Deploy**. Future pushes to `main` deploy automatically.

## Install as a mobile app (PWA)

- **iPhone/iPad:** open the deployed ReelRecall site in Safari, tap **Share**, choose **Add to Home Screen**, then tap **Add**.
- **Android:** open the deployed site in Chrome and use **Install app** or the in-app **Install** prompt.

ReelRecall launches in a standalone app window. Its interface can reopen when offline, and the saved catalog remains available from browser storage. Playing social videos, retrieving thumbnails, and AI classification still require an internet connection.
