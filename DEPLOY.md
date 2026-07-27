# Home Budget — Deploy & Setup Guide

## Overview

This app uses **Supabase** as the database so Jordan and Ness can see each other's
entries in real time on separate phones — no copy-paste sync needed.

---

## Step 1 — Create a free Supabase project

1. Go to https://supabase.com and sign up (free, no credit card).
2. Click **New project**.
   - Name: `home-budget`
   - Database Password: pick a strong one (save it somewhere safe)
   - Region: **Canada (Central)** or closest to you
3. Wait ~2 minutes for the project to be created.

---

## Step 2 — Create the database tables

1. In your Supabase project, click **SQL Editor** in the left sidebar.
2. Click **New query**, paste the entire SQL block below, and click **Run**.

```sql
-- Transactions (manual entries from the + Add tab)
create table if not exists transactions (
  id text primary key,
  year int not null,
  month int not null,
  cat text not null,
  amount numeric not null,
  note text default '',
  date text not null,
  who text not null,
  ts bigint not null,
  created_at timestamptz default now()
);

-- Monthly budget settings (income amounts, CC payment target)
create table if not exists budget_settings (
  year int not null,
  month int not null,
  income jsonb not null default '{"jordan":3984.44,"ness":800,"sunlife":0}',
  cc_target numeric not null default 500,
  primary key (year, month)
);

-- Bank statement imports (from the Upload tab)
create table if not exists bank_imports (
  id text primary key,
  date text not null,
  description text not null,
  amount numeric not null,
  category text default 'other',
  source text default '',
  year int not null,
  month int not null,
  who text default 'jordan',
  created_at timestamptz default now()
);

-- Row Level Security — open policies for a private personal app
alter table transactions    enable row level security;
alter table budget_settings enable row level security;
alter table bank_imports    enable row level security;

create policy "allow all on transactions"
  on transactions for all using (true) with check (true);

create policy "allow all on budget_settings"
  on budget_settings for all using (true) with check (true);

create policy "allow all on bank_imports"
  on bank_imports for all using (true) with check (true);

-- Enable real-time updates
alter publication supabase_realtime add table transactions;
alter publication supabase_realtime add table budget_settings;
alter publication supabase_realtime add table bank_imports;
```

---

## Step 3 — Get your Supabase credentials

1. In Supabase, go to **Project Settings → API**.
2. Copy two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public key** — a long JWT string starting with `eyJ...`

---

## Step 4 — Add the credentials to Netlify

1. In Netlify, go to your site → **Site settings → Environment variables**.
2. Add these two variables:

| Variable name            | Value                                 |
|--------------------------|---------------------------------------|
| `VITE_SUPABASE_URL`      | `https://your-project.supabase.co`   |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbG...` (the anon key)           |

3. Click **Save**.

---

## Step 5 — Redeploy

Go to your Netlify site → **Deploys** → **Trigger deploy → Deploy site**.

The app will rebuild with Supabase connected. Takes about 60 seconds.

---

## Step 6 — Add to Home Screen on both phones

Open the live URL in Safari on each phone:
**Share button → Add to Home Screen → Add**

It will appear as a full-screen app. Each person selects who they are on first launch.
From then on, any expense either of you logs appears on the other's screen within seconds.

---

## Using the Upload tab

1. Export a CSV from your bank (BMO: Accounts → Download → CSV)
2. Open the app → **Upload tab**
3. Select the account type (BMO, CTFS, WS, PC MC)
4. Choose whose spending it is (Jordan or Ness)
5. Pick the CSV file
6. Review: transactions are auto-categorised. Tap the category pill to change any.
   Tap ✅ to skip a transaction you don't want to import.
7. Tap **Import** — done. All transactions appear in History and update the budget bars.

After importing a few months of statements, the Home tab will show suggested
budget targets based on your actual average spending. Tap **Apply** to update them.

---

## Folder structure

```
household-budget/
├── src/
│   ├── App.jsx         ← all UI and logic (1000 lines)
│   ├── supabase.js     ← database client and helpers
│   ├── categorize.js   ← rule-based merchant categoriser
│   ├── main.jsx        ← React entry point
│   └── index.css       ← global resets
├── index.html
├── package.json
├── vite.config.js
├── netlify.toml
└── DEPLOY.md           ← this file
```

## Making changes

Edit `src/App.jsx` for UI changes, `src/categorize.js` to add new merchants.
After editing: `npm run build` → push to GitHub (auto-deploys) or drag `dist/` to Netlify.
