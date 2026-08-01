# v29 — Enhanced partner notifications and shared category targets

This version expands the notification system to cover all budget changes and adds support for shared category targets.

## What's new

### Partner notifications now cover
- 🧾 **Bill rule changes** — when one partner adds, edits, or removes a recurring bill
- 🎯 **Category target changes** — when one partner updates budget targets (shared across partners)
- 💳 **Bill payments** — when marking bills paid/unpaid (already existed)
- 💰 **Transactions** — when adding, editing, or removing manual entries
- 📥 **Bank imports** — when uploading statements
- ⚙️ **Settings changes** — when updating income or credit card targets

### Shared category targets
Category targets (monthly budgets per category) are now synced to Supabase, so both partners always see the same budget goals. Previously these were stored only in your device's localStorage.

## Required SQL migration

Run this in Supabase → SQL Editor → New query:

```sql
-- Category targets (shared budget goals across partners)
create table if not exists category_targets (
  id text primary key default 'shared',
  targets jsonb not null default '{}',
  updated_by text not null,
  updated_at timestamptz default now()
);

alter table category_targets enable row level security;

create policy "allow all on category_targets" on category_targets
  for all using (true) with check (true);

-- Enable realtime for bill_rules and category_targets
alter publication supabase_realtime add table bill_rules;
alter publication supabase_realtime add table category_targets;
```

## What happens if you skip the migration

The app still works completely. Category targets will:
- Store locally on each device (not synced to partner)
- Sync to Supabase the moment the table exists
- No data is lost

Bill rule notifications will work the moment `bill_rules` is enabled for realtime.

## Backwards compatibility

✅ All existing data is preserved — nothing breaks
✅ Apps without the migration just don't notify on bill/target changes
✅ The moment the table is created, syncing starts automatically
