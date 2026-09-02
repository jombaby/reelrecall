# Git and Vercel deployment on Mac

Open **Terminal**, go to the extracted project folder, and run the commands below.

## 1. Test the project

```bash
npm install
npm run build
npm run dev
```

Visit http://localhost:3000. Stop the server with `Control + C`.

## 2. Create the Git repository

```bash
git init
git add .
git commit -m "Create Recipe Reel Library"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/recipe-reel-library.git
git push -u origin main
```

Create the empty `recipe-reel-library` repository on GitHub before the final two commands. Do not initialize it with a README, because this project already includes one.

## 3. Deploy using Vercel's website (recommended)

1. Sign in to https://vercel.com with GitHub.
2. Select **Add New → Project**.
3. Import `recipe-reel-library`.
4. Keep the detected framework as **Next.js** and click **Deploy**.

Vercel will redeploy automatically whenever you run:

```bash
git add .
git commit -m "Describe your change"
git push
```

## Alternative: deploy from Terminal

```bash
npm install -g vercel
vercel login
vercel
vercel --prod
```

The first `vercel` command links the local folder and creates a preview deployment. `vercel --prod` publishes it to the production URL.
