import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(URL, KEY);

/** Postgres and PostgREST codes for "that table does not exist". */
const isMissingTable = err =>
  err?.code === '42P01' || err?.code === 'PGRST205' ||
  /schema cache|does not exist|not find the table/i.test(err?.message || '');


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

// Full fields needed for duplicate detection
export async function getAllBankImportsRaw() {
  const { data, error } = await supabase
    .from('bank_imports')
    .select('id,date,amount,description,category,source,who,direction');
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

