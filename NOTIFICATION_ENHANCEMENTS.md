# Budget For Two v29: Comprehensive Partner Notifications

## Overview

This release significantly expands the partner notification system to ensure **every change one person makes immediately notifies the other**. Previously, some actions (like editing bill rules or budget targets) didn't trigger notifications. Now they do.

## 📢 What Gets Notified Now

### 1. **Bill Management** ✅
- ✏️ Adding a new bill rule → "Jordan added a new bill: Rent + home"
- ✏️ Editing a bill rule → "Jordan updated the Rent + home bill rule"  
- 🗑️ Deleting a bill rule → "Jordan removed the Rent + home bill rule"
- ☑️ Marking a bill paid → "Jordan paid Rent + home" (already worked)
- ☑️ Unmarking a bill paid → "Jordan marked Rent + home as not paid" (already worked)

### 2. **Budget Targets** ✅
- 🎯 When one partner updates monthly category budgets
- → "Jordan updated budget targets for categories"
- **Now synced to Supabase** so both partners see the same goals

### 3. **Transactions** ✅
- ➕ Adding a manual transaction → "Ness added $42.50 to Groceries"
- ✏️ Editing a transaction → "Ness edited a Groceries transaction"
- 🗑️ Removing a transaction → "Ness removed a transaction"

### 4. **Imports** ✅
- 📥 Uploading a bank statement → "Ness imported a transaction — $120.00 in Restaurant & takeout"

### 5. **Settings** ✅  
- ⚙️ Updating income or CC payment targets → "Jordan updated the income or credit-card targets"

---

## 🔄 Realtime Sync Architecture

### Tables with Partner Notifications
```
• transactions       → Changes instantly trigger toast + activity panel
• bank_imports       → CSV/PDF uploads show immediately  
• bill_payments      → Bill payment status updates in real time
• bill_rules         → NEW: Bill additions/edits/deletions sync
• category_targets   → NEW: Budget target changes sync
• budget_settings    → Monthly settings (income, CC targets) sync
```

### How It Works
1. User makes a change → Database update
2. Supabase realtime broadcasts to all connected clients
3. `subscribeToPartnerActivity()` receives the change
4. `describeChange()` creates human-readable text
5. Toast notification appears + activity log updated
6. If it's your own change (same name), it's silently ignored
7. Partner sees the notification in 1-2 seconds

---

## 📁 Code Changes

### `supabase.js`
```javascript
// Added to subscribeToPartnerActivity():
.on('postgres_changes', {event:'*', schema:'public', table:'bill_rules'}, ...)
.on('postgres_changes', {event:'*', schema:'public', table:'category_targets'}, ...)

// New functions:
export async function getCategoryTargets() { ... }
export async function upsertCategoryTargets(targets, who) { ... }
```

### `App.jsx`
```javascript
// Enhanced describeChange() to handle:
- bill_rules (INSERT/UPDATE/DELETE)
- category_targets (any change)

// Updated acceptSuggested():
- Now calls upsertCategoryTargets() to sync to Supabase
- Notification triggers automatically via realtime

// New in partner activity handler:
- Reloads bill_rules when partner edits them
- Reloads category_targets when partner changes budget
- Filters out your own changes by name

// On app startup:
- Loads category_targets from Supabase (was localStorage-only before)
```

---

## 🚀 Setup Instructions

### Required: Enable Realtime for New Tables

Run this SQL in **Supabase → SQL Editor → New query**:

```sql
-- Create category_targets table (shared across partners)
create table if not exists category_targets (
  id text primary key default 'shared',
  targets jsonb not null default '{}',
  updated_by text not null,
  updated_at timestamptz default now()
);

alter table category_targets enable row level security;

create policy "allow all on category_targets" on category_targets
  for all using (true) with check (true);

-- Enable realtime updates for all notification tables
alter publication supabase_realtime add table bill_rules;
alter publication supabase_realtime add table category_targets;
```

### That's It!
- No environment variables to add
- No code changes needed on your end
- Works with existing data
- Backwards compatible

---

## ✨ User Experience Improvements

### Before v29
- Edit a bill rule → No notification (partner doesn't know)
- Update budget targets → Only visible on your device
- Partner has to refresh to see your changes
- Some changes silently failed without feedback

### After v29
- Every action triggers instant notification
- "Jordan updated the Rent + home bill rule" appears in toast
- Activity log shows complete change history
- Both partners always see identical budget goals
- Changes visible within 1-2 seconds

---

## 🛡️ Safety & Filtering

### Prevents Notification Spam
```javascript
// Ignores your own changes — only shows partner's
if(actor.includes(me) || me.includes(actor)) return;

// Safely identifies the person who made the change
// Works with first names, full names, different casings
```

### What If Someone's Name Is Generic?
- "Jordan" changes data → All changes labeled as "Jordan"
- "Ness" doesn't see notifications from "Jordan"
- "Ness" changes data → All changes labeled as "Ness"
- "Jordan" sees notifications from "Ness"
- No self-notifications, ever.

---

## 📊 Activity Panel Features

The bell icon shows all partner changes:
- 🔔 Red dot badge when new activity exists
- 📋 List of changes (newest first)
- 👤 Avatar + name of who made the change
- ⏰ Timestamp (formatted: "Jan 15, 3:42 PM")
- 🗑️ "Clear all" button
- 🔄 Automatically keeps last 50 events

---

## ⚠️ Known Limitations

### Category Targets Sync
- **Local storage priority**: If you edited targets locally before the table was created, those take precedence
- **Shared ID**: All partners share a single `category_targets` row (`id='shared'`)
- **Overwrite behavior**: Last edit wins (no merge, no conflict resolution)
  - Safe because targets are usually not both edited simultaneously

### Notification Text Clarity
- Some notifications are generic ("made a change") if the change type isn't recognized
- Bill rule names should be descriptive so "updated the X bill rule" is clear
- Amounts in transaction notifications always shown in CAD ($)

### No Notification Preferences
- Can't turn off notifications for specific types
- All changes notify equally
- 2600ms toast duration (can't change per notification)

---

## 🔮 Future Enhancements

Possible additions in future versions:
- [ ] Undo/redo for partner changes
- [ ] Notification preferences (mute bill changes, etc.)
- [ ] Change diff view (what exactly changed)
- [ ] Notification sounds
- [ ] "Do not disturb" mode (10 PM - 7 AM)
- [ ] Partner confirmation for large changes
- [ ] Bulk operation summaries ("Imported 47 transactions")

---

## 🧪 Testing Checklist

To verify notifications work end-to-end:

1. **Bill Rules**
   - [ ] Add a bill on one device
   - [ ] Other device shows notification
   - [ ] Bill appears in the list immediately
   - [ ] Edit the bill on other device
   - [ ] Notification shows change
   - [ ] Delete the bill
   - [ ] Notification shows deletion

2. **Category Targets**
   - [ ] Click "Apply" on budget suggestions
   - [ ] Other device shows toast
   - [ ] Activity log shows the change
   - [ ] Targets actually updated on other device

3. **Transaction Changes**
   - [ ] Add manual transaction
   - [ ] Edit it
   - [ ] Delete it
   - [ ] All trigger notifications on other device

4. **Import**
   - [ ] Upload CSV statement
   - [ ] Other device shows import notification
   - [ ] Transactions appear in history

5. **Prevent Self-Notifications**
   - [ ] Make a change on Device A
   - [ ] No notification appears on Device A
   - [ ] Notification appears on Device B immediately

---

## 📝 Changelog

**v29 (Current)**
- Add bill_rules to realtime subscriptions
- Add category_targets table + realtime sync
- Sync budget targets to Supabase (shared with partner)
- Enhance notifications for all change types
- Load category_targets on app startup
- Handle partner updates in real time

**v28** (Previous)
- Added bill payment checkboxes
- Manual bill marking with partner notifications
- Bill status persistence per month

---

## ❓ FAQ

**Q: Why don't I see my own changes in notifications?**  
A: By design! You already know what you did. We filter out notifications from yourself by comparing your name to who made the change.

**Q: What if we have the same first name?**  
A: Use full names in your profile ("Jordan Smith" + "Ness Garcia"). The app compares first names, so as long as your first names differ, it works.

**Q: Will old changes appear in the activity log?**  
A: No, activity is realtime only. Past changes are logged but appear separately in History/bills.

**Q: Can I filter notifications by type?**  
A: Not yet. The activity panel shows everything. Could be a future feature.

**Q: What if the database connection is slow?**  
A: Notifications appear in 1-5 seconds depending on latency. The app caches changes locally, so if network fails, changes still save and sync when you reconnect.

**Q: Can I turn off notifications?**  
A: Not currently. Toasts appear for all changes. You can clear the activity log, but new changes will populate it again.

---

## 📞 Support

If notifications aren't working:

1. **Check the migration was run**  
   - Go to Supabase → SQL Editor
   - Run the SQL from MIGRATION_NOTIFICATIONS.md
   - Verify `category_targets` table exists

2. **Check realtime is enabled**  
   - Supabase → Tables → category_targets → Realtime
   - Toggle should be ON (blue)
   - Same for bill_rules

3. **Check both users are signed in**  
   - Notifications only work when both people are logged in
   - Different browsers count as different devices

4. **Check internet connection**  
   - Realtime requires stable WebSocket connection
   - Mobile WiFi can be flaky

5. **Restart the app**  
   - Close and reopen both instances
   - Subscriptions will reinitialize
   - Try making a small change to test

Still broken? Check browser console for errors (F12 → Console tab).
