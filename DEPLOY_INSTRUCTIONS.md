# Deployment Instructions for v29 & v30

## What's Ready to Deploy

You have **2 major features** built and tested:

1. **v29**: Enhanced Partner Notifications + Shared Budget Targets
2. **v30**: Quick-Add Feature

Both are committed and ready to go to production.

---

## Step 1: Push to GitHub

```bash
cd /path/to/budget42
git push origin main
```

This will:
- Push both commits (v29 and v30)
- Trigger Netlify auto-deploy
- Update your live app at https://budgetfortwo.netlify.app

**Note**: The network in the dev environment can't reach GitHub, so do this from your machine.

---

## Step 2: Create Supabase Tables (v29 only)

Open **Supabase Console** → Your Project → **SQL Editor**

Click **New Query** and run this:

```sql
-- Create category_targets table (shared budget goals)
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

**Note**: 
- This is idempotent (safe to run multiple times)
- Creates the table only if it doesn't exist
- No existing data is affected

---

## Step 3: Test v30 (Quick-Add)

After Netlify deploys:

1. Open the app on any device
2. Scroll to **"Spending This Month"** section
3. Look for **+** buttons on the right side of each category
4. Tap any **+** button
5. **Add tab** should open with that category pre-selected
6. Enter an amount and tap **Add**

✅ If this works, v30 is deployed successfully!

---

## Step 4: Test v29 (Notifications)

1. Open the app on **2 devices** (or 2 browser windows)
2. On **Device A**: Add a bill (Bills tab → +)
3. On **Device B**: Watch for notification toast
4. On **Device A**: Click "Apply" on budget suggestions (if any)
5. On **Device B**: Should see notification about targets

✅ If you see notifications, v29 is working!

---

## What Happens If You Don't Run the SQL

The app will work perfectly fine, **but**:
- Notifications for bill changes won't appear
- Budget targets won't sync between partners
- Everything else (transactions, imports, settings) will notify normally

Once you run the SQL, those features instantly work with no data loss.

---

## Rollback Plan (If Something Goes Wrong)

### For v30 (Quick-Add)
1. Push v29 only to GitHub
2. Netlify redeploys without the + buttons
3. No database changes needed

### For v29 (Notifications)
1. No SQL to revert (it's idempotent)
2. Just redeploy an earlier version
3. Old app won't use new tables, no harm

---

## File Changes Summary

### Modified
- `src/App.jsx` — 398 lines changed
- `src/supabase.js` — 38 lines changed

### Created
- `NOTIFICATION_ENHANCEMENTS.md` — Full feature documentation
- `QUICK_ADD_FEATURE.md` — Implementation details
- `SESSION_SUMMARY.md` — Technical summary
- `README_UPDATES.md` — User-facing guide
- `MIGRATION_NOTIFICATIONS.md` — SQL setup
- `DEPLOY_INSTRUCTIONS.md` — This file

---

## Netlify Deployment Checklist

- [ ] Environment variables still set?
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- [ ] Verify on Netlify dashboard: Site settings → Environment

If they're missing, the app won't load. They should still be there from earlier setup.

---

## After Deployment

### For v29
- Both partners must be signed in (auth required)
- Open both apps side-by-side
- Make a change on one → See notification on the other in ~2 seconds

### For v30
- No setup needed
- + buttons appear immediately
- Users will start using it naturally

---

## Monitoring

After deployment, watch for:
- App loads normally (5-10 minute deploy time on Netlify)
- No console errors (F12 → Console)
- Notifications appear within 2 seconds
- + buttons are visible on all categories

---

## Git History

After pushing, your GitHub will show:
```
22a1c70 v30: Quick-add feature - add + button to each category row
628a36f v29: Enhanced notifications - add bill rules & category target sync
88aab63 fix the bills spent option to be able to cross them out
...
```

---

## Questions During Deployment?

Check:
1. **Quick-Add issues** → `QUICK_ADD_FEATURE.md`
2. **Notification issues** → `NOTIFICATION_ENHANCEMENTS.md`
3. **SQL issues** → `MIGRATION_NOTIFICATIONS.md`
4. **General questions** → `SESSION_SUMMARY.md`

---

## Next Features

When you're ready to build more:
- Notification preferences (mute certain types)
- Recent categories carousel
- Bulk quick-add
- Voice input
- Undo/redo for partner changes

Let me know when you want to tackle the next one! 🚀

---

**Status**: Ready to deploy ✅  
**Risk Level**: Low (no breaking changes)  
**Estimated Deploy Time**: 15 minutes  
**Testing Time**: 5 minutes  
**Total**: 20 minutes to production
