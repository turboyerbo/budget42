import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(URL, KEY);

/** Postgres and PostgREST codes for "that table does not exist". */
const isMissingTable = err =>
  err?.code === '42P01' || err?.code === 'PGRST205' ||
  /schema cache|does not exist|not find the table/i.test(err?.message || '');

/** A table/bucket that DOES exist, but Row Level Security is blocking the
 *  read/write — a completely different failure from "missing," with its own
 *  distinct error shape, and one the old narrow checks below didn't catch at
 *  all: an RLS-denied insert would fall through as a raw, unexplained error
 *  instead of a clear "here's what to fix" message. */
export const isRlsDenied = err =>
  err?.code === '42501' ||
  /row-level security|permission denied|new row violates/i.test(err?.message || '');


// ── Auth ─────────────────────────────────────────────────────────────────────
export async function signUp(email, password, meta) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: meta },   // meta = { name, role, goal, color }
  });
  if (error) throw error;
  return data.user;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export function onAuthChange(cb) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(cb);
  return () => subscription.unsubscribe();
}

// Update user metadata (name, role, goal, etc.)
export async function updateUserMeta(meta) {
  const { data, error } = await supabase.auth.updateUser({ data: meta });
  if (error) throw error;
  return data.user;
}

// ── Transactions ──────────────────────────────────────────────────────────────
export async function getTxns(year, month) {
  const { data, error } = await supabase.from('transactions').select('*')
    .eq('year',year).eq('month',month).order('ts',{ascending:false});
  if (error) throw error;
  return data || [];
}
export async function insertTxn(txn) {
  const { data, error } = await supabase.from('transactions').insert(txn).select().single();
  if (error) throw error;
  return data;
}
export async function deleteTxn(id) {
  const { error } = await supabase.from('transactions').delete().eq('id',id);
  if (error) throw error;
}

// ── Settings ──────────────────────────────────────────────────────────────────
export async function getSettings(year, month) {
  const { data, error } = await supabase.from('budget_settings').select('*')
    .eq('year',year).eq('month',month).maybeSingle();
  if (error) throw error;
  return data;
}
export async function upsertSettings(year, month, income, cc_target) {
  const { error } = await supabase.from('budget_settings')
    .upsert({ year, month, income, cc_target }, { onConflict:'year,month' });
  if (error) throw error;
}

// ── Bank imports ──────────────────────────────────────────────────────────────
export async function getBankImports(year, month) {
  const { data, error } = await supabase.from('bank_imports').select('*')
    .eq('year',year).eq('month',month).order('date',{ascending:false});
  if (error) throw error;
  return data || [];
}
export async function insertBankImports(rows) {
  const { error } = await supabase.from('bank_imports').insert(rows);
  if (error) throw error;
}
export async function deleteBankImport(id) {
  const { error } = await supabase.from('bank_imports').delete().eq('id',id);
  if (error) throw error;
}
export async function getAllBankImports() {
  const { data, error } = await supabase.from('bank_imports')
    .select('year,month,category,amount');
  if (error) throw error;
  return data || [];
}

// ── Realtime ──────────────────────────────────────────────────────────────────
export function subscribeToMonth(year, month, onTxn, onSettings, onImport) {
  const ch = supabase.channel(`budget-${year}-${month}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'transactions'},
      p => { if((p.new?.year??p.old?.year)===year&&(p.new?.month??p.old?.month)===month) onTxn(p); })
    .on('postgres_changes',{event:'*',schema:'public',table:'budget_settings'},
      p => { if((p.new?.year??p.old?.year)===year) onSettings(p); })
    .on('postgres_changes',{event:'*',schema:'public',table:'bank_imports'},
      p => { if((p.new?.year??p.old?.year)===year&&(p.new?.month??p.old?.month)===month) onImport(p); })
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// Listen for ANY change across the whole budget, regardless of month.
// Used to notify the other partner that an update was made.
export function subscribeToPartnerActivity(onChange) {
  const ch = supabase.channel('partner-activity')
    .on('postgres_changes',{event:'*',schema:'public',table:'bill_payments'},
      p => onChange({ ...p, table:'bill_payments' }))
    .on('postgres_changes',{event:'*',schema:'public',table:'transactions'},
      p => onChange({ ...p, table:'transactions' }))
    .on('postgres_changes',{event:'*',schema:'public',table:'bank_imports'},
      p => onChange({ ...p, table:'bank_imports' }))
    .on('postgres_changes',{event:'*',schema:'public',table:'budget_settings'},
      p => onChange({ ...p, table:'budget_settings' }))
    .on('postgres_changes',{event:'*',schema:'public',table:'bill_rules'},
      p => onChange({ ...p, table:'bill_rules' }))
    .on('postgres_changes',{event:'*',schema:'public',table:'category_targets'},
      p => onChange({ ...p, table:'category_targets' }))
    .on('postgres_changes',{event:'*',schema:'public',table:'goals'},
      p => onChange({ ...p, table:'goals' }))
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// ── Update single bank import (category + note) ───────────────────────────────
export async function updateBankImport(id, updates) {
  const { error } = await supabase
    .from('bank_imports')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

// ── Update single manual transaction (note) ───────────────────────────────────
export async function updateTransaction(id, updates) {
  const { error } = await supabase
    .from('transactions')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

// ── Get all "other" imports for a month (for review modal) ───────────────────
export async function getOtherImports(year, month) {
  const { data, error } = await supabase
    .from('bank_imports')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .eq('category', 'other')
    .order('date', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Full fields needed for duplicate detection AND recurring-bill detection —
// detectRecurring() groups by (year, month), so those columns must be here.
export async function getAllBankImportsRaw() {
  const { data, error } = await supabase
    .from('bank_imports')
    .select('id,date,amount,description,category,source,who,direction,year,month');
  if (error) throw error;
  return data || [];
}

// Every field for a month — used to spot shared outings and partner transfers
export async function getMonthImportsFull(year, month) {
  const { data, error } = await supabase.from('bank_imports')
    .select('*').eq('year', year).eq('month', month);
  if (error) throw error;
  return data || [];
}

// ── Export ────────────────────────────────────────────────────────────────────
/** Everything, for a backup file. Taken before any destructive action. */
export async function exportAllData() {
  const [txns, imports, settings] = await Promise.all([
    supabase.from('transactions').select('*'),
    supabase.from('bank_imports').select('*'),
    supabase.from('budget_settings').select('*'),
  ]);
  if (txns.error)     throw txns.error;
  if (imports.error)  throw imports.error;
  if (settings.error) throw settings.error;
  return {
    exportedAt:   new Date().toISOString(),
    transactions: txns.data || [],
    bankImports:  imports.data || [],
    settings:     settings.data || [],
  };
}

/** Row counts, so a confirmation screen can say exactly what will go. */
export async function countMonthData(year, month) {
  const [t, b] = await Promise.all([
    supabase.from('transactions').select('id,amount', { count:'exact' })
      .eq('year', year).eq('month', month),
    supabase.from('bank_imports').select('id,amount', { count:'exact' })
      .eq('year', year).eq('month', month),
  ]);
  const sum = rows => (rows || []).reduce((a, r) => a + Number(r.amount || 0), 0);
  return {
    manual:      t.count || 0,
    imported:    b.count || 0,
    manualTotal: sum(t.data),
    importTotal: sum(b.data),
  };
}

export async function countAllData() {
  const [t, b] = await Promise.all([
    supabase.from('transactions').select('id', { count:'exact', head:true }),
    supabase.from('bank_imports').select('id', { count:'exact', head:true }),
  ]);
  return { manual: t.count || 0, imported: b.count || 0 };
}

// ── Deletion ──────────────────────────────────────────────────────────────────
/**
 * Clear one month. `scope` picks what goes:
 *   'all'      both manual entries and imported transactions
 *   'imported' imported only, keeping anything typed in by hand
 *   'manual'   manual only
 */
export async function deleteMonthData(year, month, scope = 'all') {
  if (scope === 'all' || scope === 'imported') {
    const { error } = await supabase.from('bank_imports').delete()
      .eq('year', year).eq('month', month);
    if (error) throw error;
  }
  if (scope === 'all' || scope === 'manual') {
    const { error } = await supabase.from('transactions').delete()
      .eq('year', year).eq('month', month);
    if (error) throw error;
  }
}

/** Every row in every table. There is no undo. */
export async function deleteAllData() {
  // .neq on the primary key matches every row; Supabase requires a filter
  const r1 = await supabase.from('bank_imports').delete().neq('id', '__never__');
  if (r1.error) throw r1.error;
  const r2 = await supabase.from('transactions').delete().neq('id', '__never__');
  if (r2.error) throw r2.error;
  const r3 = await supabase.from('budget_settings').delete().neq('year', -1);
  if (r3.error) throw r3.error;
}

// ── Bill rules ────────────────────────────────────────────────────────────────
/**
 * User edits layered over detection: renames, corrected amounts and days,
 * dismissals, confirmations, and bills added by hand.
 *
 * These live in Supabase so both people see the same list. If the table has not
 * been created yet the feature still works, backed by this browser only, and the
 * app says so rather than failing with a Postgres error.
 */
const BILLS_LOCAL_KEY = 'b42_bill_rules';

export let billRulesLocalOnly = false;

function readLocalRules() {
  try { return JSON.parse(localStorage.getItem(BILLS_LOCAL_KEY) || '[]'); }
  catch { return []; }
}
function writeLocalRules(rules) {
  try { localStorage.setItem(BILLS_LOCAL_KEY, JSON.stringify(rules)); } catch {}
}

export async function getBillRules() {
  try {
    const { data, error } = await supabase.from('bill_rules').select('*');
    if (error) throw error;
    billRulesLocalOnly = false;
    return data || [];
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    billRulesLocalOnly = true;
    return readLocalRules();
  }
}

export async function upsertBillRule(rule) {
  const row = { ...rule, updated_at: new Date().toISOString() };
  try {
    const { error } = await supabase.from('bill_rules')
      .upsert(row, { onConflict: 'key' });
    if (error) throw error;
    billRulesLocalOnly = false;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    billRulesLocalOnly = true;
    const rules = readLocalRules().filter(r => r.key !== rule.key);
    writeLocalRules([...rules, row]);
  }
}

export async function deleteBillRule(key) {
  try {
    const { error } = await supabase.from('bill_rules').delete().eq('key', key);
    if (error) throw error;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    billRulesLocalOnly = true;
    writeLocalRules(readLocalRules().filter(r => r.key !== key));
  }
}

// ── Which bills apply to which month ────────────────────────────────────────
// Whether a bill "exists" used to be entirely global — hiding it removed it
// from every month, past and future, because detection + a single status
// flag was the only mechanism. These two tables make month membership
// explicit: bill_month_active says which bills are on for a given month,
// bill_month_configured marks a month as having been set up at all (so an
// untouched month can fall back to the old always-show behavior rather than
// looking mysteriously empty the first time you open it).
const LOCAL_ACTIVE_KEY = 'b42_bill_month_active';
const LOCAL_CONFIGURED_KEY = 'b42_bill_month_configured';
const readLocalActive = () => { try { return JSON.parse(localStorage.getItem(LOCAL_ACTIVE_KEY) || '[]'); } catch { return []; } };
const writeLocalActive = rows => { try { localStorage.setItem(LOCAL_ACTIVE_KEY, JSON.stringify(rows)); } catch {} };
const readLocalConfigured = () => { try { return JSON.parse(localStorage.getItem(LOCAL_CONFIGURED_KEY) || '[]'); } catch { return []; } };
const writeLocalConfigured = rows => { try { localStorage.setItem(LOCAL_CONFIGURED_KEY, JSON.stringify(rows)); } catch {} };

export async function getBillMonthActive() {
  try {
    const { data, error } = await supabase.from('bill_month_active').select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return readLocalActive();
  }
}

export async function getBillMonthConfigured() {
  try {
    const { data, error } = await supabase.from('bill_month_configured').select('*');
    if (error) throw error;
    return data || [];
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return readLocalConfigured();
  }
}

/** Sets whether a bill is active for one specific month, without touching
 *  any other month. This is what "delete" actually calls now (active=false). */
export async function setBillActiveForMonth(key, year, month, active) {
  try {
    if (active) {
      const { error } = await supabase.from('bill_month_active')
        .upsert({ key, year, month }, { onConflict: 'key,year,month' });
      if (error) throw error;
    } else {
      const { error } = await supabase.from('bill_month_active')
        .delete().eq('key', key).eq('year', year).eq('month', month);
      if (error) throw error;
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    const rows = readLocalActive().filter(r => !(r.key === key && r.year === year && r.month === month));
    if (active) rows.push({ key, year, month });
    writeLocalActive(rows);
  }
}

/** Sets this month's own amount/label/day/category for a bill — editing a
 *  bill from within a specific month writes here, not to the shared
 *  bill_rules row, so a changed amount only ever affects the month it was
 *  changed in. Income sources and bill amounts genuinely vary month to
 *  month; nothing should silently rewrite the past or the future. */
export async function setBillOverrideForMonth(key, year, month, overrides) {
  const row = { key, year, month, ...overrides };
  try {
    const { error } = await supabase.from('bill_month_active')
      .upsert(row, { onConflict: 'key,year,month' });
    if (error) throw error;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    const rows = readLocalActive().filter(r => !(r.key === key && r.year === year && r.month === month));
    rows.push(row);
    writeLocalActive(rows);
  }
}

/** Marks a month as explicitly set up, optionally seeding it with a starting
 *  snapshot of bills copied from wherever they were showing before (each
 *  entry can include its own amount/label/day/category) — a one-time copy,
 *  not a live link. Editing any of them afterward only affects this month. */
export async function markMonthConfigured(year, month, seedBills = []) {
  try {
    const { error } = await supabase.from('bill_month_configured')
      .upsert({ year, month }, { onConflict: 'year,month' });
    if (error) throw error;
    if (seedBills.length) {
      const rows = seedBills.map(b => ({ key: b.key, year, month, amount: b.amount, label: b.label, day: b.day, category: b.category }));
      const { error: e2 } = await supabase.from('bill_month_active').upsert(rows, { onConflict: 'key,year,month' });
      if (e2) throw e2;
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    const configured = readLocalConfigured().filter(r => !(r.year === year && r.month === month));
    configured.push({ year, month });
    writeLocalConfigured(configured);
    if (seedBills.length) {
      const keepKeys = new Set(seedBills.map(b => b.key));
      const rows = readLocalActive().filter(r => !(r.year === year && r.month === month && keepKeys.has(r.key)));
      seedBills.forEach(b => rows.push({ key: b.key, year, month, amount: b.amount, label: b.label, day: b.day, category: b.category }));
      writeLocalActive(rows);
    }
  }
}

/** Push anything saved locally up once the table exists. */
export async function syncLocalBillRules() {
  const local = readLocalRules();
  if (!local.length) return 0;
  const { error } = await supabase.from('bill_rules')
    .upsert(local, { onConflict: 'key' });
  if (error) throw error;
  writeLocalRules([]);
  billRulesLocalOnly = false;
  return local.length;
}

/** Remove many rows at once, across both tables. */
export async function deleteManyRows(ids) {
  if (!ids?.length) return;
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    const a = await supabase.from('bank_imports').delete().in('id', batch);
    if (a.error) throw a.error;
    const b = await supabase.from('transactions').delete().in('id', batch);
    if (b.error) throw b.error;
  }
}

/** Everything saved for one month, both manual and imported. */
export async function getMonthEverything(year, month) {
  const [t, b] = await Promise.all([
    supabase.from('transactions').select('*').eq('year', year).eq('month', month),
    supabase.from('bank_imports').select('*').eq('year', year).eq('month', month),
  ]);
  if (t.error) throw t.error;
  if (b.error) throw b.error;
  return [
    ...(t.data || []).map(r => ({ ...r, description: r.note || '', _table: 'transactions' })),
    ...(b.data || []).map(r => ({ ...r, _table: 'bank_imports' })),
  ];
}

// ── Manual bill payments ──────────────────────────────────────────────────────
/**
 * A bill ticked off by hand for one month.
 *
 * Detection already marks a bill paid when a matching transaction shows up, but
 * that only works once the statement has been uploaded. Ticking is for the gap
 * in between: you paid the rent today, the statement arrives in three weeks.
 *
 * Keyed by bill + year + month so it never leaks into the following month.
 * Falls back to this browser if the table has not been created, same as
 * bill_rules.
 */
const PAID_LOCAL_KEY = 'b42_bill_paid';

export let billPaidLocalOnly = false;

const readLocalPaid  = () => {
  try { return JSON.parse(localStorage.getItem(PAID_LOCAL_KEY) || '[]'); }
  catch { return []; }
};
const writeLocalPaid = rows => {
  try { localStorage.setItem(PAID_LOCAL_KEY, JSON.stringify(rows)); } catch {}
};

const paidId = (key, year, month) => `${key}|${year}-${month}`;

export async function getBillPayments(year, month) {
  try {
    const { data, error } = await supabase.from('bill_payments')
      .select('*').eq('year', year).eq('month', month);
    if (error) throw error;
    billPaidLocalOnly = false;
    return data || [];
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    billPaidLocalOnly = true;
    return readLocalPaid().filter(r => r.year === year && r.month === month);
  }
}

// Unscoped by month — used to check whether a PAST month's bill was ticked
// off by hand, so an unpaid bill from a prior month can be carried forward
// as "overdue" instead of silently disappearing when the month changes.
export async function getAllBillPayments() {
  try {
    const { data, error } = await supabase.from('bill_payments').select('*');
    if (error) throw error;
    billPaidLocalOnly = false;
    return data || [];
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    billPaidLocalOnly = true;
    return readLocalPaid();
  }
}

export async function setBillPaid(key, year, month, paid, who, label) {
  const row = {
    id: paidId(key, year, month),
    key, year, month, label,
    paid_by: who,
    paid_at: new Date().toISOString(),
  };
  try {
    if (paid) {
      const { error } = await supabase.from('bill_payments')
        .upsert(row, { onConflict: 'id' });
      if (error) throw error;
    } else {
      const { error } = await supabase.from('bill_payments')
        .delete().eq('id', row.id);
      if (error) throw error;
    }
    billPaidLocalOnly = false;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    billPaidLocalOnly = true;
    const rows = readLocalPaid().filter(r => r.id !== row.id);
    writeLocalPaid(paid ? [...rows, row] : rows);
  }
  return row;
}

export async function syncLocalBillPayments() {
  const local = readLocalPaid();
  if (!local.length) return 0;
  const { error } = await supabase.from('bill_payments')
    .upsert(local, { onConflict: 'id' });
  if (error) throw error;
  writeLocalPaid([]);
  billPaidLocalOnly = false;
  return local.length;
}

// ── Category targets (shared across partners) ──────────────────────────────
export async function getCategoryTargets() {
  try {
    const { data, error } = await supabase.from('category_targets')
      .select('*').maybeSingle();
    if (error) throw error;
    return data?.targets || {};
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return {};
  }
}

export async function upsertCategoryTargets(targets, who) {
  try {
    const { error } = await supabase.from('category_targets')
      .upsert(
        { id: 'shared', targets, updated_by: who, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      );
    if (error) throw error;
  } catch (err) {
    if (isMissingTable(err)) {
      // Table doesn't exist yet, silently fail — user can still use app locally
      return;
    }
    throw err;
  }
}

// ── Goals (shared across partners, backs up localStorage so goals survive
// even if one partner's browser storage gets cleared or they're on a new device) ──
export async function getGoals() {
  try {
    const { data, error } = await supabase.from('goals')
      .select('*').maybeSingle();
    if (error) throw error;
    return data?.goals || null;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    return null;
  }
}

export async function upsertGoals(goals, who) {
  try {
    const { error } = await supabase.from('goals')
      .upsert(
        { id: 'shared', goals, updated_by: who, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      );
    if (error) throw error;
  } catch (err) {
    if (isMissingTable(err)) {
      // Table doesn't exist yet, silently fail — user can still use app locally
      return;
    }
    throw err;
  }
}

// ── Receipt scanning (photo → Storage + a row, then Claude reads it) ───────────
const isMissingBucket = err =>
  err?.statusCode === '404' || err?.status === 404 ||
  /bucket not found|does not exist/i.test(err?.message || '');

/**
 * Upload a receipt photo to the 'receipts' Storage bucket.
 * Returns { path, url }. Throws a specific, readable error for the two
 * distinct ways this fails — the bucket doesn't exist yet, or it exists but
 * Row Level Security is denying the upload — rather than one narrow check
 * that only caught the first case and let the second one through as a raw,
 * unexplained Supabase error.
 */
export async function uploadReceiptImage(file, id) {
  const ext = file.type === 'image/png' ? 'png'
            : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${id}.${ext}`;
  const { error } = await supabase.storage.from('receipts')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
  if (error) {
    if (isMissingBucket(error)) {
      throw new Error(
        "The 'receipts' storage bucket hasn't been created yet. Run " +
        "RECEIPT_SCANNING_MIGRATION.sql in Supabase (SQL Editor) once, then try again."
      );
    }
    if (isRlsDenied(error)) {
      throw new Error(
        "The 'receipts' storage bucket exists but its permissions are blocking uploads. " +
        "Re-run RECEIPT_SCANNING_MIGRATION.sql in Supabase (SQL Editor) — it recreates the " +
        "upload policy even if the bucket is already there."
      );
    }
    throw new Error('Could not upload to Storage: ' + (error.message || error));
  }
  const { data } = supabase.storage.from('receipts').getPublicUrl(path);
  return { path, url: data.publicUrl };
}

/**
 * A cheap, harmless check for whether receipt scanning can actually work
 * right now — run once when the scan modal opens, so a broken backend shows
 * a clear message immediately instead of only surfacing after someone has
 * already taken a photo and waited for it to fail.
 *
 * Checks BOTH halves independently — the Storage bucket AND the receipts
 * table — because they can fail separately. A table-only problem is the
 * sneakiest case: the photo uploads fine, the transaction gets added fine
 * (that doesn't depend on this table at all), so nothing visibly breaks —
 * but the receipt record never actually saves, "View past scanned receipts"
 * stays empty no matter how many photos get scanned, and there's no error
 * anywhere to explain why. Checking only the bucket (the original version
 * of this function) would have missed exactly that case.
 */
export async function checkReceiptsBackendReady() {
  const bucketCheck = async () => {
    try {
      const { error } = await supabase.storage.from('receipts').list('', { limit: 1 });
      if (!error) return { ready: true };
      if (isMissingBucket(error)) return { ready: false, reason: 'bucket-missing' };
      if (isRlsDenied(error)) return { ready: false, reason: 'bucket-rls-denied' };
      return { ready: false, reason: 'bucket-unknown' };
    } catch {
      return { ready: false, reason: 'bucket-unknown' };
    }
  };
  const tableCheck = async () => {
    try {
      const { error } = await supabase.from('receipts').select('id').limit(1);
      if (!error) return { ready: true };
      if (isMissingTable(error)) return { ready: false, reason: 'table-missing' };
      if (isRlsDenied(error)) return { ready: false, reason: 'table-rls-denied' };
      return { ready: false, reason: 'table-unknown' };
    } catch {
      return { ready: false, reason: 'table-unknown' };
    }
  };

  const [bucket, table] = await Promise.all([bucketCheck(), tableCheck()]);
  if (bucket.ready && table.ready) return { ready: true };
  return { ready: false, bucket, table };
}

export async function insertReceipt(receipt) {
  try {
    const { data, error } = await supabase.from('receipts')
      .insert(receipt).select().single();
    if (error) throw error;
    return data;
  } catch (err) {
    if (isMissingTable(err) || isRlsDenied(err)) return receipt; // degrade gracefully — image is still uploaded
    throw err;
  }
}

export async function updateReceipt(id, updates) {
  try {
    const { error } = await supabase.from('receipts').update(updates).eq('id', id);
    if (error) throw error;
  } catch (err) {
    if (!isMissingTable(err) && !isRlsDenied(err)) throw err;
  }
}

export async function getReceipts(limit = 30) {
  try {
    const { data, error } = await supabase.from('receipts')
      .select('*').order('uploaded_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  } catch (err) {
    if (isMissingTable(err) || isRlsDenied(err)) return [];
    throw err;
  }
}

/**
 * Checks whether the receipts feature is actually usable — both the
 * storage bucket and the table need to exist, and either one missing means
 * every scan will fail. Meant to run once, up front, so "receipts don't
 * work" is a visible, specific banner rather than something only discovered
 * after tapping Scan and getting a cryptic failure.
 */
export async function checkReceiptsSetup() {
  let bucketOk = false, tableOk = false;
  try {
    const { error } = await supabase.storage.from('receipts').list('', { limit: 1 });
    bucketOk = !error;
  } catch { bucketOk = false; }
  try {
    const { error } = await supabase.from('receipts').select('id', { count: 'exact', head: true });
    tableOk = !error;
  } catch { tableOk = false; }
  return { bucketOk, tableOk, ready: bucketOk && tableOk };
}


// ── Predicted income ─────────────────────────────────────────────────────────
// This was the ONLY feature in the app with no database table at all — it
// lived purely in localStorage, which is why it "kept disappearing": iOS
// Safari's tracking prevention evicts localStorage for non-installed sites
// after about seven days of no visits, and nothing here ever synced between
// the two partners' devices either. Same graceful-degradation pattern as
// every other table: works locally if the migration hasn't been run yet.
const LOCAL_EXPECTED_INCOME_KEY = 'b42_expected_income';
const readLocalIncome  = () => { try { return JSON.parse(localStorage.getItem(LOCAL_EXPECTED_INCOME_KEY) || '[]'); } catch { return []; } };
const writeLocalIncome = rows => { try { localStorage.setItem(LOCAL_EXPECTED_INCOME_KEY, JSON.stringify(rows)); } catch {} };
export let expectedIncomeLocalOnly = false;

export async function getExpectedIncome() {
  try {
    const { data, error } = await supabase.from('expected_income').select('*');
    if (error) throw error;
    expectedIncomeLocalOnly = false;
    const rows = data || [];
    // First run after the migration: push anything stranded in localStorage
    // up to the server so nothing is lost in the switchover.
    const local = readLocalIncome();
    if (rows.length === 0 && local.length > 0) {
      try {
        await supabase.from('expected_income').upsert(local, { onConflict: 'id' });
        return local;
      } catch { /* fall through and just show the local copy */ }
    }
    return rows;
  } catch (err) {
    if (!isMissingTable(err) && !isRlsDenied(err)) throw err;
    expectedIncomeLocalOnly = true;
    return readLocalIncome();
  }
}

/** Writes the whole list. Predicted income is a short list edited as a
 *  set (add/edit/remove one row at a time), so replacing it wholesale keeps
 *  the server and the screen in step without a per-row diff. */
export async function saveExpectedIncome(entries) {
  writeLocalIncome(entries); // always keep the offline copy current
  try {
    const { data: existing, error: readErr } = await supabase.from('expected_income').select('id');
    if (readErr) throw readErr;
    const keep = new Set(entries.map(e => e.id));
    const stale = (existing || []).map(r => r.id).filter(id => !keep.has(id));
    if (stale.length) {
      const { error } = await supabase.from('expected_income').delete().in('id', stale);
      if (error) throw error;
    }
    if (entries.length) {
      const { error } = await supabase.from('expected_income').upsert(entries, { onConflict: 'id' });
      if (error) throw error;
    }
    expectedIncomeLocalOnly = false;
  } catch (err) {
    if (!isMissingTable(err) && !isRlsDenied(err)) throw err;
    expectedIncomeLocalOnly = true; // localStorage copy above is the fallback
  }
}
