import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(URL, KEY);

// ── Transactions (manual entries) ─────────────────────────────────────────────

export async function getTxns(year, month) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('year', year).eq('month', month)
    .order('ts', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function insertTxn(txn) {
  const { data, error } = await supabase.from('transactions').insert(txn).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTxn(id) {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
}

// ── Budget settings (income, cc_target) ──────────────────────────────────────

export async function getSettings(year, month) {
  const { data, error } = await supabase
    .from('budget_settings').select('*')
    .eq('year', year).eq('month', month).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertSettings(year, month, income, cc_target) {
  const { error } = await supabase.from('budget_settings')
    .upsert({ year, month, income, cc_target }, { onConflict: 'year,month' });
  if (error) throw error;
}

// ── Bank imports (from uploaded statements) ───────────────────────────────────

export async function getBankImports(year, month) {
  const { data, error } = await supabase
    .from('bank_imports').select('*')
    .eq('year', year).eq('month', month)
    .order('date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function insertBankImports(rows) {
  const { error } = await supabase.from('bank_imports').insert(rows);
  if (error) throw error;
}

export async function deleteBankImport(id) {
  const { error } = await supabase.from('bank_imports').delete().eq('id', id);
  if (error) throw error;
}

// All bank imports ever — for computing spending averages across months
export async function getAllBankImports() {
  const { data, error } = await supabase
    .from('bank_imports').select('year,month,category,amount');
  if (error) throw error;
  return data || [];
}

// ── Real-time subscriptions ───────────────────────────────────────────────────

export function subscribeToMonth(year, month, onTxn, onSettings, onImport) {
  const ch = supabase.channel(`budget-${year}-${month}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' },
      p => { if (p.new?.year === year && p.new?.month === month) onTxn(p);
             if (p.old?.year === year && p.old?.month === month) onTxn(p); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_settings' },
      p => { if ((p.new?.year ?? p.old?.year) === year) onSettings(p); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bank_imports' },
      p => { if ((p.new?.year ?? p.old?.year) === year &&
                 (p.new?.month ?? p.old?.month) === month) onImport(p); })
    .subscribe();
  return () => supabase.removeChannel(ch);
}
