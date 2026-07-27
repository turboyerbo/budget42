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
  note text default '',          -- user-added description
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

---

## v5 — Supabase Auth setup (required for login)

### Step 1 — Disable email confirmation (important)

By default Supabase requires users to confirm their email before logging in.
For a private household app, turn this off:

1. Supabase → **Authentication → Providers → Email**
2. Toggle **"Confirm email"** to **OFF**
3. Save

### Step 2 — Enable Supabase Auth in your app

No extra SQL needed — Supabase Auth is built-in. Your two `.env` variables
from earlier are all that's required.

### Step 3 — Both partners create accounts

1. Jordan opens the app, clicks **Create account**, fills in name + email + password + goal
2. After signup, the app shows a link to share with Ness
3. Ness opens the same URL, clicks **Create account**, creates her own account
4. Each person signs in from their own device going forward

### Optional — Claude AI categorisation key

Add to Netlify env vars:
```
VITE_ANTHROPIC_API_KEY = sk-ant-...
```
Get from console.anthropic.com → API Keys. The app works without it but
unknown merchants will land in "Other" instead of being categorised automatically.

### If upgrading from v4/v5 — run this migration

If you already have the tables from a previous version, run this in SQL Editor:

```sql
alter table bank_imports add column if not exists note text default '';
```

---

## v7 — PDF upload, smart data checks, partner notifications

### Required Netlify environment variable

PDF parsing and AI categorisation both run through the Claude API:

```
VITE_ANTHROPIC_API_KEY = sk-ant-...
```

Without it the app still works, but PDF upload is disabled and unrecognised
merchants land in "Other" instead of being categorised automatically.

### Supabase realtime — required for partner notifications

The bell icon in the header only lights up if realtime is enabled on all three
tables. If you set this up in an earlier version you already have it. To confirm,
run in SQL Editor:

```sql
alter publication supabase_realtime add table transactions;
alter publication supabase_realtime add table budget_settings;
alter publication supabase_realtime add table bank_imports;
```

Re-running these is harmless if they're already added.

### No new tables in v7

v7 adds no schema changes. If you're coming from v5 or earlier, you still need
the one v6 migration:

```sql
alter table bank_imports add column if not exists note text default '';
```

---

## v8 — automatic bank detection

The upload screen no longer asks which bank a file came from. Detection runs in
three stages, and the user is only interrupted if all three fail:

1. **Fingerprint** — instant and free. Matches text in the file against known
   markers ("CIBC", "Canadian Tire", Wealthsimple's `net_cash_amount` column, etc).
2. **Claude** — if the fingerprint misses, the first 3000 characters are sent to
   Claude to identify the institution.
3. **Ask the user** — only when both fail. A one-tap list of accounts appears.

PDFs skip straight to Claude, which reads the letterhead directly and can identify
**several accounts inside one document** — a chequing statement and a credit card
statement bundled together are split apart and each transaction is tagged with the
account it belongs to.

Adding a new institution means adding one entry to `INSTITUTIONS` in
`src/detect.js` plus a fingerprint. Nothing else needs to change.

### Spending insight

After each import Claude compares what was just added against the monthly averages
from all previous statements and writes a short summary. This needs
`VITE_ANTHROPIC_API_KEY`; without it the import still succeeds and the insight
panel is simply skipped.

---

## v9 — duplicate and internal-transfer handling

### The root cause of inflated spending

Two bugs were compounding:

1. **`parse.js` discarded the +/- sign** on every CSV amount. A credit-card
   payment is a *credit* on the card statement and a *debit* on the chequing
   statement. With the sign gone, both looked like purchases — so paying $1,200
   off a card added $2,400 of phantom spending.

2. **Income and transfer rows were dropped during parsing**, before validation
   ran. That meant the two halves of a transfer could never be matched to each
   other. Those rows are now kept and tagged instead.

### What happens now

Transfers are paired automatically: a debit and a credit of the same amount,
within three days, on two *different* accounts, is one movement of money. Both
halves are excluded.

Duplicate matching now normalises the merchant name first, so
`SQ *BLUE BOTTLE 8891` and `SQ *BLUE BOTTLE` are recognised as the same shop.
Processor prefixes (`SQ *`, `TST*`, `PAYPAL *`), store numbers and reference
numbers are stripped before comparison.

Anything unambiguous is fixed silently and listed in a green summary card with
a **Keep it** button next to each row, so nothing is hidden and every automatic
decision can be reversed. Only genuinely uncertain cases become questions —
in the common case the user answers nothing at all.
