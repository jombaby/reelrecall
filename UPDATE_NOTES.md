# ReelRecall settings, AI queue, and admin update

## Changes

- Moved WhatsApp import into a Settings dialog opened from the bottom of the left sidebar.
- Removed the iPhone Share setup button from the application header. Existing iPhone Shortcut and share routes remain functional.
- AI Organize now processes only pending or previously failed videos. Completed and manually corrected videos are skipped.
- AI classification runs in batches of three and displays progress in the header.
- Added Settings > Admin > Clear all videos with two confirmation dialogs.
- Clearing videos removes active and archived videos from Neon and local cache while preserving categories.
- Canonical Facebook `/reel/{id}` links use the video embed; legacy `/share/r/` links use the post fallback.
- Facebook links that require authentication now show a clean sign-in panel instead of Facebook's misleading "post unavailable" message; the Reel remains available in the library.
- Facebook cards now use a safe preview by default, with separate Try inline and Open Facebook actions, because iframe errors cannot be inspected across Facebook's domain.
- AI now replaces generic platform/date/sender headings with specific content titles while preserving manually edited titles and previously completed category/tag choices.

## Deploy

```bash
npm install
npm run build
git add app/page.tsx app/globals.css UPDATE_NOTES.md
git commit -m "Add settings and improve AI organization"
git push origin main
```
