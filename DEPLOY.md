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

---

## v10 — category drill-down

Tap any category on the Home tab to expand it and see every transaction making
up that total. Each row shows the merchant, date, source account and amount,
with a dropdown to move it to a different category. Changes save straight to
Supabase and the bars update immediately.

### Two new built-in categories

`Credit card payments` and `Transfers` are marked `excluded: true`. They are
tracked and visible, but never counted as spending — paying a card is moving
money, not spending it. They show a small NOT SPENDING tag and are left out of
the Home total, the donut chart and the annual bar chart.

`parse.js` now routes obvious card payments into `cc_payment` at import time.
This is deliberate redundancy: even if transfer pairing misses one half of a
pair, an excluded category keeps it out of the spending total anyway.

Custom categories are deleted from inside the expanded panel now — the row
itself became a button, and a button cannot be nested inside another button.

---

## v11 — cross-partner reconciliation

### REQUIRED migration

Run this once in Supabase → SQL Editor before deploying:

```sql
alter table bank_imports add column if not exists direction text default 'debit';
```

Pairing an e-transfer means knowing whether an existing row was money in or
money out. Without this column the app still runs, but partner transfers on
rows imported before the migration cannot be matched.

### What the second person's upload now does

When Ness imports her CIBC statement, it is checked against everything Jordan
has already imported:

**Partner transfers.** Money out of one person's account matching money into
the other's, same amount, within three days, is the two of you moving household
money — not spending. If either description mentions an e-transfer it is
excluded automatically; otherwise it becomes a question.

**Shared moments.** Same merchant, same day, two different people means you
were out together. Those get a heart in the category drill-down and in History,
plus a summary card on Home: *"3 outings together · $312.40 spent side by side
this month."*

### The ambiguity that matters

Same merchant and same day could mean a date — or it could mean the same
statement was uploaded by both of you. The tell is the amount and the account:
if those match too, it is almost certainly a duplicate import, so it is routed
to the duplicate checker instead of being celebrated as an outing. Two different
amounts on two different cards at the same restaurant is a real date.

---

## v12 — income derived from statements, and a Combined view

### The bug underneath this

Income transactions were being *discarded* at import. The credit check offered
"Yes — this is income, skip it", and skip meant dropped. So there was nothing in
the database to build a real income figure from, which is why income had to be
typed in by hand.

Credits are now filed under a new `income` category (excluded from spending,
like card payments and transfers) rather than thrown away.

### No more manual income fields

The three inputs (Jordan's salary, Ness's contribution, SunLife) are gone.
Income is now read off the statements and grouped by person automatically, with
a "Show every deposit" drill-down. If something lands in income that isn't
income, change its category and it moves out.

Nobody declares what anyone contributed. It comes from the deposits.

### Just me / Combined

A toggle at the top of Home switches between your own transactions and the
household's. It drives the hero figures, the category bars, the income
breakdown and the Charts tab. `budget_settings` still stores the credit-card
payment target; the `income` jsonb column is now unused and can be ignored.

### Note for existing data

Statements imported before this version had their income rows dropped at import
time. Those deposits are not recoverable from the database. Re-import any
statement whose income you want reflected, and the duplicate checker will keep
the spending rows from being counted twice.

---

## v13 — corrected model strings

The app was calling `claude-sonnet-4-6`, which is not in the current model
lineup. Every AI feature would have failed with a 400 invalid model error the
moment an API key was added.

Models now live in `src/models.js`:

```js
export const MODEL_SMART = 'claude-sonnet-5';            // PDF vision, insight
export const MODEL_FAST  = 'claude-haiku-4-5-20251001';  // categorising, bank ID
```

Reading a multi-page PDF and reasoning about spending patterns uses the
stronger model. Sorting a merchant name into one of fifteen buckets does not,
and those calls happen in bulk, so they use the cheaper faster one. Change both
in one file if the lineup moves again.

---

## v14 — the API key moved to the server

### Why this was necessary

`VITE_` prefixed variables are compiled into the browser bundle. Two consequences:

1. Anyone could open the site, press F12 and read the key.
2. **Netlify's secret scanner detects the key value in the build output and
   fails the deploy.** If your builds have been failing or the key never seemed
   to take effect, this is very likely why.

### New setup

In Netlify → Site configuration → Environment variables:

```
ANTHROPIC_API_KEY = sk-ant-...
```

**No `VITE_` prefix.** That prefix is exactly what caused the problem. If you
already added `VITE_ANTHROPIC_API_KEY`, delete it.

Then redeploy. You can now also delete any `SECRETS_SCAN_*` workarounds, since
there is no longer a secret in the bundle to scan for.

### How it works

`netlify/functions/claude.js` runs on Netlify's servers, holds the key, and
forwards requests to Anthropic. The browser calls `/api/claude` instead of
calling Anthropic directly.

The function restricts requests to the two models this app uses and caps
`max_tokens`, so an exposed endpoint cannot be turned into an open bill.

The app asks the function on load whether a key is configured, and the upload
screen says plainly whether Claude is connected rather than guessing.

The CSP no longer needs `https://api.anthropic.com` in `connect-src`, since the
browser only ever talks to your own domain now.

---

## v15 — key validation and diagnostics

### The problem with v14's health check

It only checked that the environment variable existed and was non-empty. A
truncated or revoked key passes that test, so the UI cheerfully said "Claude
connected" and then failed with a 401 on the first real request. Misleading.

The health check now makes a one-token call to Haiku to prove the key actually
works before claiming it does.

### Whitespace and quotes are stripped

Pasting a key from a browser dialog into a Netlify form frequently drags along a
trailing newline, a leading space, or a pair of quotes. Every one of those
produces a 401 that is indistinguishable from a wrong key. The function now
trims whitespace and strips surrounding quotes before use.

### Diagnostics in the UI

When the key is refused, the upload screen shows the first 11 and last 4
characters, the length, whether the `sk-ant-` prefix is present, and whether
whitespace had to be trimmed. Enough to spot a truncated paste at a glance
without revealing the secret.

### Checking it yourself

Visit `https://your-site.netlify.app/api/claude?verify=1` in a browser. It
returns JSON showing whether the key is present and whether Anthropic accepts it.

---

## v16 — PDFs are read in page batches

### Why 504 happened

Moving the API key server-side put every Claude call behind a Netlify function,
and those have an execution ceiling of roughly 10 seconds. Sending a twelve-page
statement in one request runs well past that, so the gateway gave up and
returned 504. Calling Anthropic directly from the browser had no such limit,
which is why this only appeared after v14.

### The fix

`src/pdfsplit.js` splits the document client-side with `pdf-lib` into batches of
three pages. Each batch is a separate short request that finishes comfortably
inside the limit. Verified against a ten-page document: four batches, no pages
lost.

Side benefits:

- Real progress instead of a spinner. The modal now reads "Reading pages 4-6 of
  10 · batch 2 of 4".
- One failed batch no longer destroys the whole import. The pages that worked
  are kept and a warning names the pages that did not.

Account keys are namespaced per batch before merging, since Claude numbers them
`acct1` independently in each request and they would otherwise collide.

### If you still hit a timeout

Reduce the batch size in `pdf.js`:

```js
const batches = await splitPDF(file, 3);   // try 2, or 1
```

---

## v17 — two runtime bugs, and a guard against repeating them

### `PROMPT is not defined`

The v16 rewrite of `pdf.js` replaced the whole function body, and the prompt
constant lived inside it. Every PDF upload threw a ReferenceError before doing
any work. `vite build` reported success because an undefined reference is a
runtime error, not a syntax error.

The prompt now sits at module scope where refactoring the caller cannot remove it.

### `income is not defined`

Same class of bug, introduced back in v12. Removing the manual income editor
left one reference behind in the CTFS payment-target input, so editing that
field had been throwing since then. `saveSettings` now takes only the
credit-card target, since income is derived from transactions.

### The guard

`eslint` with `no-undef` now runs as part of `npm run build`:

```json
"build": "eslint src netlify && vite build"
```

A broken reference fails the build instead of reaching the browser. Verified by
deliberately renaming the constant and confirming the build refuses.

Netlify runs `npm run build`, so this protects deploys too.

---

## v18 — "Committed" was double counting, and is now derived

### The bug

`Committed` came from two hardcoded arrays in `App.jsx`: `FIXED` (rent,
insurance, phone) and `SUBS` (Netflix, Claude, Dropbox). Their total was
subtracted from income every month.

But those same charges arrive in the imported statements, so they were already
inside `Spent`. Rent was being subtracted twice. On a screen showing income
$5,478 and spent $5,057, the app reported minus $1,965 available when the real
figure was plus $421.

They also could not be edited, so as bills changed the number quietly drifted
further from reality.

### The model now

`src/recurring.js` works out recurring charges from your own statements: a
merchant appearing in at least two different months, on a similar day, for a
similar amount.

Then the question becomes "what is still to come this month" rather than "what
do I owe monthly". A bill already charged is spending. A bill not yet charged
is a commitment. Only the second is subtracted, so nothing is counted twice.

The hero now reads **Still to come**, with "3 bills not yet charged" underneath,
and a card below lists them with the ones already charged struck through.

Two guards stop habits being mistaken for bills:

- **Amount spread**, not distance from the median. Grocery runs of 130 / 160 /
  190 all sit within 25% of the median individually, yet are obviously variable.
- **Day clustering.** Bills land on roughly the same date; shopping does not.
  Month-end wraparound (the 30th and the 1st) is handled.

Verified: rent, Netflix, phone and a variable electricity bill are detected;
scattered grocery shops and payroll are not.

The credit-card target gets the same treatment. If a payment has already gone
out this month, only the remainder is pledged.

### Bills tab restored

It had been dropped from the navigation back in v5 and left as dead code, still
holding the hardcoded arrays. It is now a real screen built from detected
recurring charges. `FIXED`, `SUBS` and `UPCOMING` are deleted.

### Bundle

`pdf-lib` is loaded on demand rather than at startup, so the initial bundle
stays around 500KB instead of 940KB.

---

## v19 — the white-screen fix, and tests that would have caught it

### The bug

`HomeTab` computed `committed` from `everythingThisMonth` several lines above
where that variable was declared. Reading a `const` before its declaration is a
temporal dead zone error, so React threw during render and the whole app showed
a blank screen.

`no-undef` could not see it, because the name does exist — just not yet.

### Two guards added

**`no-use-before-define`** in eslint. Verified by reintroducing the bug and
confirming the lint fails.

**A smoke test that actually renders.** `npm test` mounts every tab with mock
data using `renderToString`. A build only proves the code parses; all three
runtime bugs shipped in the last few versions parsed perfectly and then threw on
first render.

Coverage includes both view modes, and the empty-history case, which is what a
new user sees.

Verified by reintroducing the exact bug: the smoke test fails with
`Cannot access 'everythingThisMonth' before initialization` across all three
HomeTab cases.

Both now run as part of `npm run build`:

```json
"build": "eslint src netlify && node test/run.mjs && vite build"
```

Netlify runs `npm run build`, so a broken render fails the deploy rather than
reaching a phone.

The tab components are exported now solely so the test can render them in
isolation.

---

## v20 — telling which build is actually running

### Diagnosing "the fix didn't work"

The reported error referenced bundle `index-PbR8mguP.js`, the identical hash
from before the fix. A Vite bundle hash is derived from its content, so an
unchanged hash means unchanged code: the browser was running the old build.

That is hard to spot, so v20 makes it obvious.

**Console stamp on boot:**

```
Budget For Two v20   built 2026-07-27 22:05 UTC
```

**Footer on the Upload screen** showing the same thing, for checking on a phone
where there is no console.

If that timestamp does not move after a deploy, nothing new has loaded and the
problem is the deploy, not the code.

### Cache headers

`index.html` is now `max-age=0, must-revalidate`, while hashed assets in
`/assets/*` are `immutable` for a year. Previously `index.html` could be served
from cache, which pins the browser to whichever bundle that old HTML references
no matter how many times you deploy.

### Test coverage completed

Every renderable component is now in the smoke test, including screens only
reachable through interaction: AuthScreen, AddTab, AddCatModal,
OtherReviewModal, ActivityPanel, and UploadTab in its key-rejected state. All
pass, so there is no second temporal dead zone hiding in an unrendered branch.

---

## v21 — Bills tab shows a dated schedule

The tab existed from v18 but only grouped charges into "paid" and "still to
come". It did not say *when*, which is the part that matters for knowing whether
a given week is tight.

`buildSchedule()` in `recurring.js` now gives every recurring charge a real
calendar date, how many days away it is, and a status:

- **overdue** — its usual day has passed with no matching transaction
- **due** — still expected
- **paid** — a matching transaction has appeared

The screen leads with what is still to be paid this month, then next-7-days,
already-paid and whole-month figures. Overdue items float to the top with an
explanation, since the usual cause is not a missed payment but a statement that
has not been uploaded yet.

Each row shows the weekday and date, a plain-language "in 3 days" or "7 days
ago", the amount, and a status tag.

Day-of-month is clamped to real dates, so a bill on the 31st shows as the 28th
in February and the 30th in April rather than silently rolling into the next
month. Verified.

The tab needs at least two months of history, since that is what makes a charge
recognisable as recurring.

---

## v22 — reset a month, or start over

A gear icon in the header opens a reset screen with three things on it.

### Backup first

A **Download backup** button writes a JSON file containing every transaction and
setting. It sits at the top of the screen because nothing below it can be
undone, and this is the only way back.

### Reset one month

Clears the month you are currently viewing. Other months are untouched. Three
scopes:

- everything in this month
- imported transactions only, keeping anything typed in by hand
- manual entries only, keeping imported statements

The button states the real count, e.g. "Delete 41 transactions", and disables
itself when there is nothing to delete. The middle option is the useful one
after a bad import: it removes the statement rows without losing hand-entered
cash spending.

### Reset everything

Every transaction in every month for both people, plus category targets and
custom categories. Requires typing `DELETE EVERYTHING` exactly; case and spacing
must match, verified against near-miss inputs.

Accounts and sign-in are not touched. Both of you can still log in to an empty
budget.

### A note on shared data

The screen says plainly that both people share this data, so a reset removes it
for your partner too. Worth knowing before tapping.

---

## v23 — BMO CSVs, and three other parser bugs found with real files

Tested against 24 actual exports. Previously 7 of 24 produced nothing at all
and 6 more errored. All 24 now parse: 1,945 transactions.

### 1. BMO dates were unreadable

BMO writes dates as `20260102` with no separators. `new Date('20260102')`
returns Invalid Date in JavaScript, so every BMO row failed its date check and
was skipped. The file parsed "successfully" with zero rows, which is why the
error message was unhelpful.

`parseDate` now splits the compact form by hand.

BMO also has **two** different export layouts, and the app only understood one:

- `First Bank Card,Transaction Type,Date Posted,Transaction Amount,Description`
- `#,Item,Date,Description,Source,Amount,Category,In / Out`

Both are supported now.

### 2. Canadian Tire signs were inverted

On the CTFS statement a **purchase is positive** and a **payment is negative**,
the opposite of a chequing account. The parser applied chequing rules, so every
Canadian Tire purchase was being filed as income and every payment as spending.

Where a statement has an explicit type column (`PURCHASE`/`PAYMENT`, or
`DEBIT`/`CREDIT`), that is now trusted ahead of the sign. PC Mastercard uses the
opposite convention to CTFS again, and is handled separately.

### 3. Bank detection read transaction text

Detection scanned the whole file for a bank name. A BMO statement containing
`INTERAC ETRNSFR ... CANADIAN TIRE BANK` was identified as a Canadian Tire
statement; a PC Mastercard file with a `Payment BMO` line was read as BMO. Six
of 24 files were misidentified.

Detection now reads the column headings, which do not lie in that way. All 24
files identify correctly.

### 4. Wealthsimple monthly exports have no description column

The six-month export includes `description`; the monthly ones do not. The parser
required it and failed with "Could not map columns". It now falls back to
`activity_sub_type` (SPEND, E_TRFOUT, Interest).

Wealthsimple files can also contain several accounts at once, so rows are now
split by `account_id` into joint and personal rather than all landing on one.

### Regression tests

`test/fixtures/` holds anonymised files reproducing each layout exactly:
separator-less dates, inverted signs, missing columns, bank names inside
transaction text. `test/parsers.mjs` runs 36 assertions over them and is part of
`npm run build`.

---

## v24 — bills are detected properly, and editable

### REQUIRED migration

```sql
create table if not exists bill_rules (
  key        text primary key,
  label      text,
  amount     numeric,
  day        int,
  category   text,
  status     text default 'auto',   -- auto | confirmed | hidden | manual
  updated_at timestamptz default now()
);
alter table bill_rules enable row level security;
create policy "allow all on bill_rules" on bill_rules for all using (true) with check (true);
alter publication supabase_realtime add table bill_rules;
```

### Why nothing was being detected

Statements bury the merchant in noise that changes every month, so one payee
looked like several:

```
[OP]RECURRING PYMNT 19JAN2026FREEDOM MOBILE ON
[OP]RECURRING PYMNT 19APR2026FREEDOM MOBILE ON
DROPBOX*CG9F5CS6N7G1
Dropbox RL41LSWNT7HJ
[CW]INTERAC ETRNSFR SENT STELA 20260051757M8FCYA
```

Four Dropbox charges were four unrelated one-offs, so nothing ever reached the
two-month threshold. `src/merchant.js` strips BMO's bracket codes, dates glued
into the description, payment-processor references, and city and province tails.
All five lines above now reduce to one merchant each.

Tested against 24 real statements: 11 bills detected before, 35 after, including
rent, Freedom Mobile, Affirm, Dropbox, YouTube and the electricity bill.

### Transfers were counted as spending

Paying your own credit card from chequing arrives as an ordinary debit, so the
credit-only rule missed it. Wealthsimple writes movements between accounts as
bare codes like `E_TRFOUT` and `TRANSFER_TF`, which were also being spent.
Naming the card issuers and those codes moves them out of spending.

Across the real files this drops the spending total from $119,202 to $74,455.
The difference was money moving between the user's own accounts.

### Confidence, rather than a guess

A shop visited monthly looks like a subscription on paper. Bills charge nearly
the same amount on nearly the same day, so:

- **high** — counted as a bill (identical amount three months running also
  qualifies, which is how rent paid by e-transfer on wandering dates is caught)
- **low** — offered under "Might be bills" with *It's a bill* and *Hide* buttons

### Editing

Tap any bill to rename it, correct the amount or day, change its category, or
remove it. There is also **Add a bill manually** for anything that never appears
in a statement.

Edits are stored per merchant in `bill_rules` and always win over detection, so
a future import cannot overwrite them. They are shared, so both people see the
same list.

---

## v25 — duplicate cleanup

No migration needed.

### Where these came from

Before v23, bank detection scanned transaction text, so a BMO statement
mentioning `CANADIAN TIRE BANK` in an e-transfer was labelled Canadian Tire.
Anyone who imported before and after that fix now has the same purchase stored
twice under two different accounts. One purchase cannot be on two accounts, so
that pairing is a reliable signature and the cleanup screen says so.

### Matching

Import-time checks only see the batch being imported, which is why these
survived. `findExistingDuplicates()` scans what is already saved.

It uses a looser merchant key than the bill detector: `RABBA 117` and
`RABBA 117 Q4R` are the same shop, as are `METRO 62` and `METRO 62 TORONTO`.
Date and amount must match exactly as well, so the looser name is safe.

The copy that is kept is the categorised one where there is a choice, so
recategorising work is not thrown away.

### Three ways to remove them

- **Banner on Home** when duplicates exist in the current month, opening a
  review screen that shows which copy is kept and which goes, with a running
  total of the double-counted spending being removed.
- **Delete option in the category dropdown**, in both the "Other" review screen
  and the Home category drill-down: *Delete — this is a duplicate*.
- Existing per-row delete in History.

---

## v26 — categories from your budget, and imports that do not interrogate you

No migration needed.

### Import no longer asks about every line

It was stopping to ask a hundred questions before showing any data. Now every
check takes its safe default, the transactions are imported, and the decisions
are listed afterwards on the done screen:

> **41 left out automatically** — duplicates, transfers between your own
> accounts, and money coming in. You were not asked because the safe answer was
> obvious in each case. 3 were closer calls.
> [ Review 44 decisions ]

Opening that review shows the same screen as before, but retrospectively.
Changing an answer and pressing **Apply these decisions** works out the
difference and syncs it: rows that should now be excluded are deleted, rows that
should now be included are inserted. Nothing is re-imported wholesale.

### Categories now match your budget

The 15 built-in categories are replaced by the 25 from
`2026_Budget_Complete_7months.xlsx`, listed alphabetically:

Alcohol & cigs · Banking fees & interest · Cell phone · Cleaning services ·
Clothing · Credit card payment · Electricity · Entertainment · Gifts ·
Golf & hobbies · Groceries · Income · Legal & professional · Medical & dental ·
Other / uncategorised · Pharmacy · Rent + home · Rental insurance ·
Restaurant & takeout · Salon & spa · Subscriptions · Transfers ·
Transit (Presto) · Travel · Uber & taxis

Existing category ids are preserved, so saved transactions keep their category.
Credit card payment, Transfers and Income are marked as not-spending.

Every dropdown sorts alphabetically, and a custom category added later lands in
its correct place rather than at the end.

### Categorisation rules to match

`categorizeBudget()` adds rules for the new buckets: finance charges and plan
fees to Banking, Freedom Mobile to Cell phone, Metergy to Electricity, STELA to
Rent, TD Insurance to Rental insurance, and so on. Credits that are not card
payments or transfers now go to Income rather than Other.

Measured over the 24 real statements: transactions left in "Other" fell from
45% to 3% of everything carrying a real merchant name. The remaining 30% of rows
are Wealthsimple monthly exports, which contain no merchant name at all — the
column simply says `SPEND`, so nothing can classify them honestly.

---

## v27 — bill editing works without the migration

### The error

`Could not find the table 'public.bill_rules' in the schema cache` means the v24
migration had not been run. Adding a bill failed outright.

Rather than a dead end, bill rules now fall back to this browser's storage when
the table is missing. Everything works; the only loss is that your partner does
not see the changes.

The Bills tab says so plainly, shows the SQL to fix it, and **uploads anything
saved locally the moment the table appears**, so nothing is lost by carrying on
without it.

The detector matches only the genuine "table does not exist" codes (`42P01`,
`PGRST205`, and the schema-cache wording). Real errors such as constraint
violations still surface rather than being swallowed.

To make bill edits shared, run:

```sql
create table if not exists bill_rules (
  key text primary key, label text, amount numeric,
  day int, category text,
  status text default 'auto',
  updated_at timestamptz default now()
);
alter table bill_rules enable row level security;
create policy "allow all on bill_rules" on bill_rules
  for all using (true) with check (true);
```

### The missing Rent category

The build in the screenshot predates v26, which replaced the old 15 categories
with the 25 from your budget. Rent + home is there now, along with Electricity,
Cell phone and Rental insurance, and the bill editor offers all of them.
