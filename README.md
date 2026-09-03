# Recipe Reel Library

## AI organization

ReelRecall can categorize and tag newly imported videos from available titles, captions, and descriptions. Copy `.env.example` to `.env.local` and set `OPENAI_API_KEY`. For Vercel, add the same environment variable in Project Settings → Environment Variables and redeploy.

Manual category and tag edits are stored as locked choices. Automatic organization and later WhatsApp imports do not overwrite them.

A private, database-backed catalog for Instagram, Facebook, and YouTube links saved in WhatsApp.

## Features

- Import a WhatsApp `_chat.txt` export without media
- Add, edit, delete, search, categorize, tag, and favorite recipe links
- Skip duplicate links during imports
- Export and restore a JSON backup
- Responsive layout for iPhone, iPad, and desktop
- Neon Postgres persistence shared across devices
- Private owner-password sign-in
- Installable PWA for iPhone, iPad, Android, and desktop
- Android share target: share Facebook and Instagram reel links straight into ReelRecall

## Run locally on macOS

Install [Node.js LTS](https://nodejs.org/) and then run:

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Import WhatsApp links

On the iPhone, open WhatsApp, open the **Message yourself** chat, tap the contact/chat name, choose **Export Chat**, and select **Without Media**. AirDrop or save the resulting export to the Mac, unzip it, then choose the `.txt` file in the app.

## Share reels directly from Android

After ReelRecall is deployed and installed from Chrome on Android, it registers as a system share target. In Facebook or Instagram, open a reel, tap **Share**, choose the Android share sheet, and select **ReelRecall**. The app extracts the supported reel URL, skips duplicates, adds it to the library, runs the existing AI organization flow, and saves through the same Neon-backed library synchronization.

If the ReelRecall session has expired, sign in when prompted; the pending shared reel is preserved and imported after authentication. If ReelRecall was already installed before this feature was deployed and it does not appear in the Android share sheet after Chrome has refreshed the app, uninstall the PWA and install it again once to refresh the operating-system share-target registration.

Web Share Target is not supported by iPhone/iPad Safari PWAs, so iOS cannot register ReelRecall as a native share-sheet destination using PWA technology alone.

## Database and security setup

1. In Vercel, connect a Neon Postgres database to ReelRecall.
2. Open Neon SQL Editor and run `db/schema.sql` once.
3. Add `REELRECALL_PASSWORD` and `SESSION_SECRET` in Vercel Environment Variables. Generate the secret with `openssl rand -base64 48`.
4. Keep `OPENAI_API_KEY` configured for automatic categories and tags.

The first authenticated launch copies any existing browser-saved library into Neon when the database is empty. Afterwards Neon is authoritative and browser storage is retained as a local recovery cache. Duplicate URLs are normalized and removed before every database write; manual category and tag corrections remain part of the stored record.

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

ReelRecall launches in a standalone app window. Loading synchronized records, playing social videos, retrieving thumbnails, and AI classification require an internet connection.


## iPhone direct sharing

iOS does not currently expose installed PWAs as native Web Share Targets. ReelRecall includes an Apple Shortcuts bridge at `/iphone-share`. In ReelRecall, choose **iPhone Share** in the header for the one-time setup instructions. After creating a Shortcut named **Save to ReelRecall**, Facebook or Instagram can share a reel to that Shortcut; the Shortcut opens `/iphone-share?url=<encoded reel URL>`, which forwards the link into the same duplicate-check, AI organization, and database sync flow used by Android PWA sharing.

## Facebook hybrid playback

Facebook playback now uses a conservative fallback chain instead of assuming an embed error means a reel was removed:

1. ReelRecall asks Meta's tokenless Facebook oEmbed video endpoint whether the public reel/video is embeddable.
2. If Meta returns an embed, ReelRecall renders it inline.
3. If Meta rejects the embed but ReelRecall has a thumbnail, the thumbnail stays visible with a **Watch in Facebook** action.
4. If no thumbnail is available, ReelRecall shows a neutral **This reel can't be played inline** card and a **Watch in Facebook** action.
5. ReelRecall only uses the stronger **may no longer be available** wording for items the user explicitly marked unavailable; an oEmbed failure alone never changes a video's saved status.

This avoids the misleading Facebook iframe message that can appear for login-, audience-, geographic-, age-, or embed-restricted content that is still valid in Facebook.


## Food recipe viewer

Food tiles include a compact **Recipe** button. On first tap, ReelRecall extracts ingredients and cooking steps from the saved/public reel description using the existing OpenAI API key and saves the structured recipe inside the existing JSONB library. Later taps open the saved recipe immediately. No database migration is required.
