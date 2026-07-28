import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(URL, KEY);

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
    .on('postgres_changes',{event:'*',schema:'public',table:'transactions'},
      p => onChange({ ...p, table:'transactions' }))
    .on('postgres_changes',{event:'*',schema:'public',table:'bank_imports'},
      p => onChange({ ...p, table:'bank_imports' }))
    .on('postgres_changes',{event:'*',schema:'public',table:'budget_settings'},
      p => onChange({ ...p, table:'budget_settings' }))
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
 * dismissals, confirmations, and bills added by hand. Shared, so both people
 * see the same list.
 */
export async function getBillRules() {
  const { data, error } = await supabase.from('bill_rules').select('*');
  if (error) throw error;
  return data || [];
}

export async function upsertBillRule(rule) {
  const { error } = await supabase.from('bill_rules')
    .upsert({ ...rule, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

export async function deleteBillRule(key) {
  const { error } = await supabase.from('bill_rules').delete().eq('key', key);
  if (error) throw error;
}
