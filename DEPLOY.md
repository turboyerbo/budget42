# Deploying Home Budget to Netlify

A step-by-step guide — takes about 10 minutes from start to live URL.

---

## Option A — Drag & Drop (easiest, no Git needed)

This is the fastest way. You only need a Netlify account (free).

### Step 1 — Install dependencies and build the app

Open Terminal and run:

```bash
cd household-budget          # go into the project folder
npm install                  # install packages (one-time, takes ~30 seconds)
npm run build                # create the production files → creates a "dist" folder
```

You'll now have a `dist/` folder inside `household-budget/`.

### Step 2 — Deploy to Netlify

1. Go to **https://app.netlify.com** and sign in (or create a free account).
2. Click **Add new site → Deploy manually**.
3. Drag the **`dist`** folder (the entire folder, not just its contents) into the upload box.
4. Netlify assigns a random URL like `https://quirky-lemon-123.netlify.app`.
5. Click **Site settings → Change site name** to rename it to something like `jordan-ness-budget`.

Your app is live at `https://jordan-ness-budget.netlify.app`.

---

## Option B — GitHub + Auto-deploy (recommended for updates)

This way, every time you push a change to GitHub, Netlify automatically rebuilds and redeploys.

### Step 1 — Create a GitHub repo

1. Go to **https://github.com/new** and create a private repo called `household-budget`.
2. In Terminal:

```bash
cd household-budget
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/household-budget.git
git push -u origin main
```

### Step 2 — Connect to Netlify

1. In Netlify → **Add new site → Import an existing project → GitHub**.
2. Authorise Netlify and select your `household-budget` repo.
3. Build settings (Netlify usually auto-detects these):
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
4. Click **Deploy site**.

Netlify will build and deploy automatically. Any future `git push` redeploys the app.

---

## Step 3 — Add to Home Screen (makes it feel like a native app)

**On iPhone:**
1. Open Safari and go to your Netlify URL.
2. Tap the Share button → **Add to Home Screen**.
3. Name it "Home Budget" and tap Add.

It'll appear on your home screen like a regular app, full-screen with no browser chrome.

Do this on both Jordan's and Ness's phones.

---

## Syncing Between Phones

Because the app uses your phone's local storage (not a cloud database), Jordan and Ness each have their own copy of the data. To keep them in sync:

1. Open the app → tap the **Sync** tab.
2. On the phone with the latest data, tap **Generate export** → **Copy to clipboard**.
3. Send that text to the other person via iMessage.
4. On the other phone, paste it into the **Import** box → tap **Import data**.
5. Reload the app — both phones now have identical data.

This is a manual process. If you'd like automatic background sync, ask Claude to add Firebase support — it's about 30 minutes of extra work and uses Google's free tier.

---

## Making Changes to the App

If you ever want to update categories, amounts, or add features:

1. Edit the files in `src/App.jsx` or `src/storage.js`.
2. Run `npm run build` to rebuild.
3. Either drag the new `dist/` folder to Netlify again (Option A) or `git push` (Option B).

If you're not sure how to make a change, just describe what you want to Claude.

---

## Folder Structure

```
household-budget/
├── src/
│   ├── App.jsx        ← all the UI and logic
│   ├── storage.js     ← localStorage adapter + export/import
│   ├── main.jsx       ← React entry point
│   └── index.css      ← global reset
├── index.html         ← HTML shell
├── package.json       ← project dependencies
├── vite.config.js     ← build config
├── netlify.toml       ← Netlify build settings
└── DEPLOY.md          ← this file
```
