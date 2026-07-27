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
