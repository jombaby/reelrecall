# ReelRecall

A private, database-backed library for Instagram, Facebook, and other links saved in WhatsApp.

## What is persisted

Reels, WhatsApp timestamps, categories/subcategories, tags, notes, favorites, manual-edit protection, and Archive status are stored in Neon Postgres. Imported URLs are normalized and protected by a database unique constraint, so importing the same chat again does not create duplicates. Results are sorted newest-first using the WhatsApp message date when available.

The first time version 2 opens in a browser that contains version 1 data, it copies that browser data into Postgres. It leaves the original local copy intact as a fallback.

## 1. Install

```bash
npm install
```

## 2. Create the Neon database in Vercel

1. Open the ReelRecall project in Vercel.
2. Open **Storage**, choose **Create Database**, and select **Neon Postgres**.
3. Connect it to ReelRecall. Vercel adds `DATABASE_URL` automatically.
4. In the Neon SQL Editor, paste and run the complete contents of `db/schema.sql`.

## 3. Add security variables

In **Vercel → ReelRecall → Settings → Environment Variables**, add:

- `REELRECALL_PASSWORD`: the private password used to enter ReelRecall
- `SESSION_SECRET`: generate a long random value on your Mac with `openssl rand -base64 48`

Apply both to Production, Preview, and Development. Never commit `.env.local` or real secrets to Git.

For local development, copy `.env.example` to `.env.local` and enter the same three values. Then run `npm run dev`.

## Git commands

```bash
git add .
git commit -m "Add persistent database and private sign-in"
git push origin main
```

After pushing, Vercel redeploys automatically. Facebook and Instagram videos remain on those platforms; Postgres stores their links and ReelRecall metadata.
