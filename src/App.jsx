import { useState, useEffect, useRef } from 'react';
import {
  ShoppingBasket, Utensils, Wine, Car, Train, Pill, Stethoscope,
  Ticket, Code2, CreditCard, Shirt, Plane, Scissors, Scale, Package,
  Home, Plus, History, CalendarDays, Calendar, Upload, PieChart, Wallet,
  Tag, Coffee, Music, BookOpen, Camera, Dumbbell, Leaf, PawPrint, Brush, Baby,
  ChevronRight, Trash2, Check, X, Sparkles, AlertCircle, Eye, EyeOff, LogOut,
  Bell, BellRing, Landmark, HelpCircle, Heart, Settings, Download,
  Smartphone, Zap, Gift, Shield, ArrowLeftRight,
} from 'lucide-react';
import { supabase, getTxns, insertTxn, deleteTxn,
         getSettings, upsertSettings,
         getBankImports, insertBankImports, deleteBankImport, getAllBankImports,
         updateBankImport, updateTransaction, getOtherImports,
         subscribeToMonth, subscribeToPartnerActivity,
         signUp, signIn, signOut, onAuthChange, updateUserMeta,
         getAllBankImportsRaw, exportAllData, countMonthData, countAllData,
         deleteMonthData, deleteAllData,
         getBillRules, upsertBillRule, deleteBillRule, syncLocalBillRules,
         getBillMonthActive, getBillMonthConfigured, setBillActiveForMonth, markMonthConfigured, setBillOverrideForMonth,
         getBillPayments, setBillPaid, syncLocalBillPayments, getAllBillPayments,
         deleteManyRows, getMonthEverything,
         getCategoryTargets, upsertCategoryTargets,
         getGoals, upsertGoals,
         uploadReceiptImage, insertReceipt, updateReceipt } from './supabase.js';
import { analyzeReceipt } from './receipt.js';
import { categorize } from './categorize.js';
import { parseStatementCSV } from './parse.js';
import { aiCategorize, AI_AVAILABLE, computeTargets, suggestCategory, spendingInsight } from './ai.js';
import { getBudgetAdvice } from './advice.js';
import { parsePDFStatement, PDF_AVAILABLE } from './pdf.js';
import { checkAI, aiDiagnostics } from './claude.js';
import { detectRecurring, splitRecurring, buildSchedule, relativeDay,
         applyBillRules, getCarriedOverBills } from './recurring.js';
import { detectBank, INSTITUTIONS, instLabel, instColor, instKind } from './detect.js';
import { detectPartnerTransfers, findSharedMoments, summariseTogether, firstName } from './together.js';
import { buildValidationReport, findExistingDuplicates } from './validate.js';
import React from 'react';

// ─── LOCAL STORAGE KEYS ───────────────────────────────────────────────────────
const CUSTOM_CATS_KEY = 'b42_custom_cats';
const CAT_TARGETS_KEY = 'b42_cat_targets';
const NOTIFS_KEY = 'b42_notifs';
const EXPECTED_INCOME_KEY = 'b42_expected_income';
const GOALS_KEY = 'b42_goals';
const BUDGET_OVERRIDE_KEY = 'b42_budget_override';
const today = () => new Date().toISOString().slice(0,10);
const uid   = () => Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const capitalize = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
// `new Date('2026-08-01')` parses as UTC midnight — in any timezone behind
// UTC (Toronto included), reading it back with local getters like getMonth()
// silently shifts it to the previous day, and near a month boundary that
// means the previous MONTH. An entry dated the 1st then vanishes from that
// month's filtered view entirely. Parsing the parts directly and building
// the Date with the local constructor sidesteps the UTC round-trip.
function parseLocalDate(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return new Date(dateStr);
  return new Date(y, m - 1, d);
}
// Filters a combined list of transactions down to whoever the view is
// currently set to. Strict matching only — a transaction with no reliable
// "who" attribution used to silently count as "mine" too (via a permissive
// fallback), which made "Just me" and "Combined" look almost identical
// whenever attribution was missing, and was very likely why the toggle
// looked broken. Unattributed transactions now only show up in Combined,
// where they belong until someone attributes them.
export function filterByView(everything, view, myFirstName, partnerFirstName) {
  if (view === 'mine') return everything.filter(t => firstName(t.who) === myFirstName);
  if (view === 'partner') return everything.filter(t => firstName(t.who) === partnerFirstName);
  return everything; // 'combined'
}
// Each view gets its own accent so it's immediately obvious, at a glance,
// whose numbers are on screen — not just a label, the whole hero changes color.
const VIEW_COLOR = { mine: '#1d4ed8', partner: '#be185d', combined: '#1a7a4a' };

// Turns a picker's selection into the actual full name to store as "who."
// Used everywhere a transaction can be logged on behalf of either partner —
// whichever name comes back here is what every filter, avatar, and total
// downstream will treat as the real owner of the record.
export function resolveWho(selection, myFullName, partnerFullName, meKey = 'mine') {
  const isMine = selection === meKey || selection === firstName(myFullName);
  if (isMine) return myFullName || 'unknown';
  return partnerFullName || capitalize(selection) || 'Partner';
}

// Today's date if it falls within the given month, otherwise the 1st of that month —
// used so "add income/expense for this month" forms default sensibly when you're
// looking at a month other than the current one.
function defaultDateForMonth(year, month) {
  const now = new Date();
  if (now.getFullYear() === year && now.getMonth() === month) return today();
  return `${year}-${String(month+1).padStart(2,'0')}-01`;
}

// Goals are organized into three groups of three: each person's own goals,
// plus goals the couple is saving toward together. The 'jordan'/'mariel' ids
// are just stable internal keys (kept for backward compatibility with
// already-saved data) — they are never shown to anyone. Displayed labels are
// always computed from the real names on screen; see personGroupLabel().
const GOAL_GROUPS = [
  { person: 'jordan' },
  { person: 'mariel' },
  { person: 'couple' },
];
// Consistent accent colors so each person's goals are visually distinct at a glance
const GOAL_GROUP_COLOR = { jordan: '#1d4ed8', mariel: '#be185d', couple: '#7c3aed' };

// Turns an internal group key into a real display label, e.g. "Alex's Goals".
// The two individual keys are assigned to whichever of the two real names
// sorts first alphabetically — deterministic, so both partners see the same
// group under the same name regardless of who's logged in when it renders.
function personGroupLabel(personKey, myName, partnerNameVal) {
  if (personKey === 'couple') return "Couple's Goals";
  const names = [myName, partnerNameVal].filter(Boolean).sort((a,b)=>a.localeCompare(b));
  const name = personKey === 'jordan' ? names[0] : names[1];
  return `${capitalize(firstName(name)) || 'Their'}'s Goals`;
}

function blankGoal(id, person, label) {
  return { id, person, label, target: 0, monthlyContribution: 0, description: '', currentBalance: 0, deposits: [] };
}
function defaultGoals() {
  return [
    blankGoal('goal-jordan-1', 'jordan', 'Short-term Goal'),
    blankGoal('goal-jordan-2', 'jordan', 'Medium-term Goal'),
    blankGoal('goal-jordan-3', 'jordan', 'Long-term Goal'),
    blankGoal('goal-mariel-1', 'mariel', 'Short-term Goal'),
    blankGoal('goal-mariel-2', 'mariel', 'Medium-term Goal'),
    blankGoal('goal-mariel-3', 'mariel', 'Long-term Goal'),
    blankGoal('goal-couple-1', 'couple', 'Short-term Goal'),
    blankGoal('goal-couple-2', 'couple', 'Medium-term Goal'),
    blankGoal('goal-couple-3', 'couple', 'Long-term Goal'),
  ];
}
// Migrates older saved goal lists (e.g. 3 shared goals with no person group)
// up to the 3-groups-of-3 shape, without losing anything already saved.
function ensureGoalGroups(saved) {
  const list = Array.isArray(saved) ? saved.map(g => ({
    ...g,
    person: g.person === 'shared' || !g.person ? 'couple' : g.person,
    deposits: g.deposits || [],
  })) : [];
  GOAL_GROUPS.forEach(({person}) => {
    const inGroup = list.filter(g => g.person === person);
    for (let i = inGroup.length; i < 3; i++) {
      const kind = i === 0 ? 'Short-term Goal' : i === 1 ? 'Medium-term Goal' : 'Long-term Goal';
      list.push(blankGoal(`goal-${person}-${i+1}-${uid()}`, person, kind));
    }
  });
  return list;
}

// ─── TOP NAVIGATION ───────────────────────────────────────────────────────────
function TopNav({tabs, activeTab, onTabChange, C, SANS}) {
  return (
    <div style={{
      position:'sticky', top:50, zIndex:40,
      background:C.white, borderBottom:`1px solid ${C.sandMid}`,
      display:'flex', overflowX:'auto', padding:'0 8px',
      gap:4
    }}>
      {tabs.map(({id, label, Icon}) => (
        <button key={id} onClick={() => onTabChange(id)} style={{
          padding:'10px 14px', border:'none', background:'transparent',
          cursor:'pointer', color: activeTab===id ? C.green : C.inkSoft,
          fontWeight: activeTab===id ? 600 : 400, fontSize:13,
          fontFamily:SANS, whiteSpace:'nowrap',
          borderBottom: activeTab===id ? `2px solid ${C.green}` : '2px solid transparent',
          transition:'all 0.2s', display:'flex', alignItems:'center', gap:6
        }}>
          <Icon size={16} />
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── BOTTOM BAR ───────────────────────────────────────────────────────────────
function BottomBar({profile, onSettings, onViewChange, view, onExport, onEmailPreview, C, SANS, nameColor, nameInitials}) {
  const color = nameColor(profile?.name);
  return (
    <div style={{
      position:'fixed', bottom:0, left:0, right:0, zIndex:50,
      background:C.white, borderTop:`1px solid ${C.sandMid}`,
      padding:'8px 16px', paddingBottom:`max(8px, env(safe-area-inset-bottom, 0px))`,
      display:'flex', alignItems:'center', justifyContent:'space-between',
      gap:12, height:60, overflowX:'auto'
    }}>
      <div style={{display:'flex', gap:8, alignItems:'center', minWidth:0}}>
        <button onClick={onSettings} style={{
          padding:'6px 12px', border:`1px solid ${C.sandDark}`,
          background:C.white, borderRadius:8, cursor:'pointer',
          fontSize:12, fontFamily:SANS, display:'flex', gap:4, alignItems:'center', flexShrink:0
        }}>
          <Settings size={14} />
          Settings
        </button>
        <button onClick={onViewChange} style={{
          padding:'6px 12px', border:`1px solid ${C.sandDark}`,
          background: view==='combined' ? color+'20' : C.white,
          borderRadius:8, cursor:'pointer', fontSize:12, fontFamily:SANS,
          color: view==='combined' ? color : C.inkMid, flexShrink:0
        }}>
          {view==='combined' ? '👥 Combined' : '👤 Just me'}
        </button>
      </div>
      
      <div style={{display:'flex', gap:8, alignItems:'center', minWidth:0}}>
        <button onClick={onEmailPreview} style={{
          padding:'6px 12px', border:`1px solid ${C.blue}22`,
          background:C.blue+'10', borderRadius:8, cursor:'pointer',
          fontSize:12, fontFamily:SANS, fontWeight:600, color:C.blue,
          display:'flex', gap:4, alignItems:'center', flexShrink:0
        }} title="Preview weekly email">
          📧
        </button>
        <button onClick={onExport} style={{
          padding:'6px 12px', border:`1px solid ${C.green}`,
          background:C.green+'20', borderRadius:8, cursor:'pointer',
          fontSize:12, fontFamily:SANS, fontWeight:600, color:C.green,
          display:'flex', gap:4, alignItems:'center', flexShrink:0
        }}>
          <Download size={14} />
          Export
        </button>
        <div style={{
          padding:'4px 8px', borderRadius:99, background:color+'15',
          display:'flex', alignItems:'center', gap:6, flexShrink:0
        }}>
          <div style={{
            width:24, height:24, borderRadius:'50%', background:color,
            color:'#fff', display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:11, fontWeight:700, fontFamily:SANS
          }}>
            {nameInitials(profile?.name)}
          </div>
          <span style={{fontSize:12, fontWeight:600, color, fontFamily:SANS}}>
            {profile?.name?.split(' ')[0] || 'User'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── PARTNER ACTIVITY HELPER MODAL ───────────────────────────────────────────
function PartnerActivityHelper({unreviewed, onClose, C, SERIF, SANS}) {
  if(!unreviewed || unreviewed.length === 0) return null;

  const transactionCount = unreviewed.filter(u => u.table === 'transactions').length;
  const billCount = unreviewed.filter(u => u.table === 'bill_payments').length;
  const billRulesCount = unreviewed.filter(u => u.table === 'bill_rules').length;

  return (
    <div style={{position:'fixed', inset:0, zIndex:850, display:'flex', alignItems:'center', justifyContent:'center'}}>
      <div onClick={onClose} style={{position:'absolute', inset:0, background:'rgba(26,26,24,0.65)'}}/>
      <div style={{position:'relative', background:C.white, borderRadius:20, padding:'28px 24px', 
        maxWidth:340, boxShadow:'0 20px 60px rgba(0,0,0,0.3)', animation:'slideUp 0.25s ease'}}>
        
        <div style={{textAlign:'center', marginBottom:20}}>
          <p style={{margin:0, fontSize:28, fontWeight:600, fontFamily:SERIF, color:C.ink}}>
            👋 Hey, {C.green}welcome back!
          </p>
          <p style={{margin:'6px 0 0', fontSize:13, color:C.inkSoft, fontFamily:SANS}}>
            Your partner added some new activity
          </p>
        </div>

        {transactionCount > 0 && (
          <div style={{background:C.sand, borderRadius:12, padding:12, marginBottom:12}}>
            <p style={{margin:0, fontSize:13, fontWeight:600, color:C.ink, fontFamily:SANS}}>
              💰 {transactionCount} new transaction{transactionCount !== 1 ? 's' : ''}
            </p>
            <p style={{margin:'2px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS}}>
              Check the History tab to review
            </p>
          </div>
        )}

        {billCount > 0 && (
          <div style={{background:C.sand, borderRadius:12, padding:12, marginBottom:12}}>
            <p style={{margin:0, fontSize:13, fontWeight:600, color:C.ink, fontFamily:SANS}}>
              ✅ {billCount} bill{billCount !== 1 ? 's marked' : ' marked'} paid
            </p>
            <p style={{margin:'2px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS}}>
              See the Bills tab for details
            </p>
          </div>
        )}

        {billRulesCount > 0 && (
          <div style={{background:C.sand, borderRadius:12, padding:12, marginBottom:12}}>
            <p style={{margin:0, fontSize:13, fontWeight:600, color:C.ink, fontFamily:SANS}}>
              📋 {billRulesCount} new bill rule{billRulesCount !== 1 ? 's' : ''}
            </p>
            <p style={{margin:'2px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS}}>
              Review in Bills tab
            </p>
          </div>
        )}

        <button onClick={onClose} style={{
          width:'100%', background:C.green, color:'white', border:'none',
          borderRadius:12, padding:'12px 20px', fontSize:14, fontWeight:600,
          fontFamily:SANS, cursor:'pointer', marginTop:16,
          transition:'all 0.2s'
        }}>
          Got it, let's go! 🚀
        </button>
      </div>
    </div>
  );
}

// ─── EDIT CATEGORY TARGET MODAL ───────────────────────────────────────────
function EditCategoryTargetModal({catId, catLabel, currentTarget, onSave, onClose, C, SERIF, SANS}) {
  const [amount, setAmount] = React.useState(currentTarget.toString());
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    if (!amount || parseFloat(amount) < 0) return;
    setSaving(true);
    await onSave(catId, parseFloat(amount));
    setSaving(false);
    onClose();
  }

  return (
    <div style={{position:'fixed', inset:0, zIndex:800, display:'flex', alignItems:'center', justifyContent:'center'}}>
      <div onClick={onClose} style={{position:'absolute', inset:0, background:'rgba(26,26,24,0.55)'}}/>
      <div style={{position:'relative', background:C.white, borderRadius:16, padding:'28px 24px', 
        maxWidth:340, boxShadow:'0 20px 60px rgba(0,0,0,0.3)', animation:'slideUp 0.25s ease'}}>
        
        <h2 style={{margin:'0 0 8px', fontFamily:SERIF, fontSize:20, fontWeight:600, color:C.ink}}>
          Budget for {catLabel}
        </h2>
        <p style={{margin:0, fontSize:12, color:C.inkSoft, fontFamily:SANS}}>
          This month's spending target (override average)
        </p>

        <div style={{margin:'20px 0', display:'flex', alignItems:'center', gap:6}}>
          <span style={{fontSize:24, fontWeight:400, color:C.sandDark, fontFamily:SERIF}}>$</span>
          <input 
            type="number" 
            value={amount}
            onChange={e => setAmount(e.target.value)}
            autoFocus
            style={{
              fontFamily:SERIF, fontSize:32, fontWeight:600, color:C.ink,
              border:'none', outline:'none', background:'none', width:200,
              textAlign:'center', borderBottom:`2px solid ${C.green}`
            }}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
        </div>

        <p style={{margin:'8px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS}}>
          Originally: ${currentTarget.toFixed(2)} (average from previous months)
        </p>

        <div style={{display:'flex', gap:8, marginTop:20}}>
          <button onClick={onClose} style={{
            flex:1, border:`1px solid ${C.sandDark}`, background:'white', color:C.ink,
            padding:'12px', borderRadius:10, fontWeight:600, fontSize:13, fontFamily:SANS,
            cursor:'pointer'
          }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={!amount || parseFloat(amount) < 0 || saving} style={{
            flex:1, border:'none', background:C.green, color:'white',
            padding:'12px', borderRadius:10, fontWeight:600, fontSize:13, fontFamily:SANS,
            cursor:saving ? 'default' : 'pointer', opacity:saving ? 0.6 : 1
          }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── QUICK GOAL DEPOSIT MODAL ────────────────────────────────────────────────
function QuickGoalDepositModal({goal, onSave, onClose, C, SERIF, SANS, defaultDate}) {
  const [amount, setAmount] = React.useState('');
  const [date, setDate] = React.useState(defaultDate || today());
  const [saving, setSaving] = React.useState(false);

  async function save() {
    if (!amount || parseFloat(amount) <= 0) return;
    setSaving(true);
    await onSave(parseFloat(amount), date);
    setSaving(false);
    onClose();
  }

  return (
    <div style={{position:'fixed', inset:0, zIndex:800, display:'flex', alignItems:'center', justifyContent:'center'}}>
      <div onClick={onClose} style={{position:'absolute', inset:0, background:'rgba(26,26,24,0.55)'}}/>
      <div style={{position:'relative', background:C.white, borderRadius:16, padding:'28px 24px', 
        maxWidth:340, boxShadow:'0 20px 60px rgba(0,0,0,0.3)', animation:'slideUp 0.25s ease'}}>
        
        <h2 style={{margin:'0 0 8px', fontFamily:SERIF, fontSize:20, fontWeight:600, color:C.ink}}>
          Add to {goal.label}
        </h2>
        <p style={{margin:'0 0 20px', fontSize:12, color:C.inkSoft, fontFamily:SANS}}>
          {goal.description || 'Add deposit to this goal'}
        </p>

        <div style={{margin:'20px 0', display:'flex', alignItems:'center', gap:6, justifyContent:'center'}}>
          <span style={{fontSize:24, fontWeight:400, color:C.sandDark, fontFamily:SERIF}}>$</span>
          <input 
            type="number" 
            value={amount}
            onChange={e => setAmount(e.target.value)}
            autoFocus
            placeholder="0.00"
            style={{
              fontFamily:SERIF, fontSize:32, fontWeight:600, color:C.ink,
              border:'none', outline:'none', background:'none', width:200,
              textAlign:'center', borderBottom:`2px solid ${C.green}`
            }}
            onKeyDown={e => e.key === 'Enter' && save()}
          />
        </div>

        <div style={{marginBottom:12}}>
          <label style={{fontSize:11, color:C.inkSoft, fontFamily:SANS, display:'block', marginBottom:3, textAlign:'center'}}>
            Deposit date
          </label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{width:'100%', padding:'8px 10px', border:`1px solid ${C.sandDark}`, borderRadius:8,
              background:C.sand, color:C.ink, fontFamily:SANS, fontSize:13, outline:'none', boxSizing:'border-box'}}/>
        </div>

        <p style={{margin:'12px 0', fontSize:11, color:C.inkSoft, fontFamily:SANS, textAlign:'center'}}>
          Current balance: ${(goal.currentBalance || 0).toFixed(2)}
        </p>

        <div style={{display:'flex', gap:8, marginTop:24}}>
          <button onClick={onClose} style={{
            flex:1, border:`1px solid ${C.sandDark}`, background:'white', color:C.ink,
            padding:'12px', borderRadius:10, fontWeight:600, fontSize:13, fontFamily:SANS,
            cursor:'pointer'
          }}>
            Cancel
          </button>
          <button onClick={save} disabled={!amount || parseFloat(amount) <= 0 || saving} style={{
            flex:1, border:'none', background:C.green, color:'white',
            padding:'12px', borderRadius:10, fontWeight:600, fontSize:13, fontFamily:SANS,
            cursor:saving || !amount ? 'default' : 'pointer', opacity:saving ? 0.6 : 1
          }}>
            {saving ? 'Saving...' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── WEEKLY EMAIL PREVIEW MODAL ───────────────────────────────────────────────
function WeeklyEmailPreviewModal({txns, bankImports, billPayments, billRules, profile, year, month, onClose, showToast, C, SERIF, SANS}) {
  const [sending, setSending] = React.useState(false);
  const allTx = [...txns, ...(bankImports||[])];
  
  // Calculate weekly summary
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  
  const weekTxns = allTx.filter(t => {
    const txDate = parseLocalDate(t.date);
    return txDate >= startOfWeek && txDate <= endOfWeek;
  });
  
  const totalSpent = weekTxns
    .filter(t => !['income', 'cc_payment', '_skip', 'transfer'].includes(t.category||t.cat))
    .reduce((a, t) => a + Math.abs(t.amount||0), 0);
  
  const upcomingBills = (billRules || [])
    .slice(0, 5)
    .map(b => ({
      label: b.label,
      amount: b.amount,
      date: `~${b.day}th`,
    }));
  
  const billsPaidThisWeek = billPayments?.length || 0;

  async function sendTestEmail() {
    setSending(true);
    try {
      const email = profile?.email || profile?.name?.toLowerCase().replace(' ', '.') + '@example.com';
      const response = await fetch('/.netlify/functions/send-weekly-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          spending: { total: totalSpent },
          bills: { upcoming: upcomingBills, paid: billsPaidThisWeek },
          income: 0,
          startDate: startOfWeek.toLocaleDateString('en-CA'),
          endDate: endOfWeek.toLocaleDateString('en-CA'),
        }),
      });
      
      if (response.ok) {
        showToast(`✅ Test email sent to ${email}!`);
        onClose();
      } else {
        showToast('Could not send email (service not configured yet)');
      }
    } catch (e) {
      showToast('Error sending email: ' + e.message);
    }
    setSending(false);
  }

  return (
    <div style={{position:'fixed', inset:0, zIndex:800, display:'flex', flexDirection:'column', justifyContent:'flex-end'}}>
      <div onClick={onClose} style={{position:'absolute', inset:0, background:'rgba(26,26,24,0.55)'}}/>
      <div style={{position:'relative', background:C.white, borderRadius:'20px 20px 0 0', padding:'22px 20px 34px', animation:'slideUp 0.25s ease', maxHeight:'88dvh', overflowY:'auto'}}>
        
        <div style={{display:'flex', alignItems:'center', marginBottom:16}}>
          <h2 style={{flex:1, margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink}}>
            Weekly Summary Email
          </h2>
          <button onClick={onClose} style={{border:'none', background:'none', padding:6, cursor:'pointer'}}>
            <X size={20} color={C.inkSoft}/>
          </button>
        </div>

        <div style={{background:C.sand, borderRadius:12, padding:16, marginBottom:16}}>
          <p style={{margin:'0 0 12px', fontSize:12, fontWeight:600, color:C.ink, fontFamily:SANS}}>
            📧 Email Preview
          </p>
          <div style={{background:'white', borderRadius:10, padding:14, fontSize:13, color:C.ink, fontFamily:SANS, lineHeight:1.6}}>
            <p style={{margin:'0 0 10px', fontWeight:600}}>📊 Weekly Budget Summary</p>
            <p style={{margin:0, fontSize:12, color:C.inkSoft}}>
              {startOfWeek.toLocaleDateString('en-CA')} — {endOfWeek.toLocaleDateString('en-CA')}
            </p>
            
            <div style={{margin:'12px 0', padding:'12px 0', borderTop:`1px solid ${C.sandMid}`, borderBottom:`1px solid ${C.sandMid}`}}>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
                <div style={{textAlign:'center'}}>
                  <p style={{margin:0, fontSize:11, color:C.inkSoft, textTransform:'uppercase'}}>Total Spent</p>
                  <p style={{margin:'6px 0 0', fontSize:18, fontWeight:600, color:C.ink}}>
                    ${totalSpent.toFixed(2)}
                  </p>
                </div>
                <div style={{textAlign:'center'}}>
                  <p style={{margin:0, fontSize:11, color:C.inkSoft, textTransform:'uppercase'}}>Daily Avg</p>
                  <p style={{margin:'6px 0 0', fontSize:18, fontWeight:600, color:C.ink}}>
                    ${(totalSpent/7).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            {billsPaidThisWeek > 0 && (
              <p style={{margin:'8px 0', fontSize:12, color:C.green}}>
                ✅ {billsPaidThisWeek} bill{billsPaidThisWeek !== 1 ? 's' : ''} paid
              </p>
            )}

            {upcomingBills.length > 0 && (
              <div style={{margin:'12px 0 0'}}>
                <p style={{margin:'0 0 8px', fontSize:11, fontWeight:600, color:C.ink, textTransform:'uppercase'}}>
                  Upcoming Bills
                </p>
                {upcomingBills.map((b, i) => (
                  <p key={i} style={{margin:'4px 0', fontSize:12, color:C.inkMid}}>
                    • {b.label} (${b.amount.toFixed(2)}) — Due {b.date}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>

        <p style={{margin:'0 0 12px', fontSize:12, color:C.inkSoft, fontFamily:SANS}}>
          <strong>How it works:</strong> An email will be sent every Friday with your week's spending, bills paid, and upcoming deadlines. You can set this up with an external scheduler like EasyCron (free tier available).
        </p>

        <button onClick={sendTestEmail} disabled={sending} style={{
          width:'100%', border:'none', background:C.green, color:'#fff',
          padding:'14px 20px', borderRadius:12, fontSize:14, fontWeight:600,
          cursor:sending ? 'default' : 'pointer', opacity:sending ? 0.6 : 1,
          fontFamily:SANS, marginBottom:12, transition:'all 0.2s'
        }}>
          {sending ? 'Sending test email...' : '📧 Send Test Email'}
        </button>

        <button onClick={onClose} style={{
          width:'100%', border:`1px solid ${C.sandDark}`, background:'white', color:C.ink,
          padding:'12px 20px', borderRadius:12, fontSize:14, fontWeight:600,
          cursor:'pointer', fontFamily:SANS, transition:'all 0.2s'
        }}>
          Done
        </button>
      </div>
    </div>
  );
}

// ─── EXPORT MODAL ─────────────────────────────────────────────────────────────
function ExportModal({year, month, txns, bankImports, billPayments, billRules, onClose, showToast, C, SERIF, SANS, MONTHS}) {
  const [exporting, setExporting] = React.useState(false);
  const allTx = [...txns, ...(bankImports||[])];
  
  async function generateAndDownloadPDF(type) {
    setExporting(true);
    try {
      const content = type === 'monthly' 
        ? generateMonthlyPDF(year, month, allTx, billPayments, billRules)
        : generateYearlyPDF(year, allTx, billPayments, billRules);
      
      const link = document.createElement('a');
      link.href = content;
      link.download = `budget-${type}-${year}${type==='monthly'?'-'+(month+1):''}.html`;
      link.click();
      
      showToast(`${type === 'monthly' ? 'Monthly' : 'Yearly'} summary downloaded!`);
      onClose();
    } catch(e) {
      showToast('Could not generate export');
    }
    setExporting(false);
  }
  
  function generateMonthlyPDF(year, month, txns, bills, rules) {
    const spent = txns.reduce((a,t) => a + Math.abs(t.amount||0), 0);
    const billsPaid = bills?.length || 0;
    const totalBills = rules?.length || 0;
    
    // Build transaction rows separately
    const txnRows = txns.slice(0, 20).map(t => 
      `<tr>
        <td>${t.date}</td>
        <td>${t.description || t.note || 'Transaction'}</td>
        <td class="amount">$${Math.abs(t.amount).toFixed(2)}</td>
      </tr>`
    ).join('');
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Budget For Two — ${MONTHS[month]} ${year}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; color: #1a1a18; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .date { color: #888; font-size: 14px; margin-bottom: 30px; }
    .summary { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-bottom: 40px; }
    .card { border: 1px solid #ddd; padding: 16px; border-radius: 10px; }
    .card-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
    .card-value { font-size: 24px; font-weight: 600; color: #1a7a4a; }
    .section { margin-bottom: 40px; }
    .section h2 { font-size: 16px; margin: 0 0 12px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px; font-size: 12px; color: #888; border-bottom: 1px solid #ddd; font-weight: 600; }
    td { padding: 8px; border-bottom: 1px solid #eee; }
    tr:last-child td { border-bottom: none; }
    .amount { text-align: right; font-family: 'Courier New', monospace; }
  </style>
</head>
<body>
  <h1>Budget For Two</h1>
  <p class="date">${MONTHS[month]} ${year}</p>
  
  <div class="summary">
    <div class="card">
      <div class="card-label">Bills Paid</div>
      <div class="card-value">${billsPaid}/${totalBills}</div>
    </div>
    <div class="card">
      <div class="card-label">Total Spent</div>
      <div class="card-value">$${spent.toLocaleString('en-CA', {maximumFractionDigits: 0})}</div>
    </div>
    <div class="card">
      <div class="card-label">Transactions</div>
      <div class="card-value">${txns.length}</div>
    </div>
  </div>
  
  <div class="section">
    <h2>Recent Transactions</h2>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th class="amount">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${txnRows}
      </tbody>
    </table>
  </div>
  
  <p style="font-size: 12px; color: #888; margin-top: 40px; text-align: center;">
    Generated on ${new Date().toLocaleDateString()} • Budget For Two
  </p>
</body>
</html>
    `;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  }
  
  function generateYearlyPDF(year, txns, bills, rules) {
    const spent = txns.reduce((a,t) => a + Math.abs(t.amount||0), 0);
    const billsPaid = bills?.length || 0;
    const totalBills = rules?.length || 0;
    const avgMonthly = (spent / 12).toFixed(2);
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Budget For Two — Year ${year}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; color: #1a1a18; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .date { color: #888; font-size: 14px; margin-bottom: 30px; }
    .summary { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 20px; margin-bottom: 40px; }
    .card { border: 1px solid #ddd; padding: 16px; border-radius: 10px; }
    .card-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
    .card-value { font-size: 24px; font-weight: 600; color: #1a7a4a; }
  </style>
</head>
<body>
  <h1>Budget For Two — Year ${year}</h1>
  <p class="date">Annual Summary</p>
  
  <div class="summary">
    <div class="card">
      <div class="card-label">Total Spent</div>
      <div class="card-value">$${spent.toLocaleString('en-CA', {maximumFractionDigits: 0})}</div>
    </div>
    <div class="card">
      <div class="card-label">Monthly Avg</div>
      <div class="card-value">$${avgMonthly}</div>
    </div>
    <div class="card">
      <div class="card-label">Bills Tracked</div>
      <div class="card-value">${totalBills}</div>
    </div>
    <div class="card">
      <div class="card-label">Transactions</div>
      <div class="card-value">${txns.length}</div>
    </div>
  </div>
  
  <p style="font-size: 12px; color: #888; margin-top: 40px; text-align: center;">
    Generated on ${new Date().toLocaleDateString()} • Budget For Two
  </p>
</body>
</html>
    `;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  }
  
  return (
    <div style={{position:'fixed', inset:0, zIndex:800, display:'flex', flexDirection:'column', justifyContent:'flex-end'}}>
      <div onClick={onClose} style={{position:'absolute', inset:0, background:'rgba(26,26,24,0.55)'}}/>
      <div style={{position:'relative', background:C.white, borderRadius:'20px 20px 0 0', padding:'22px 20px', animation:'slideUp 0.25s ease'}}>
        <h2 style={{margin:'0 0 16px', fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink}}>
          Export Budget Summary
        </h2>
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16}}>
          <button onClick={() => generateAndDownloadPDF('monthly')} disabled={exporting} style={{
            padding:'16px', borderRadius:12, border:'none', background:C.green, color:'#fff',
            fontWeight:600, cursor:exporting?'default':'pointer', opacity:exporting?0.6:1,
            fontFamily:SANS, fontSize:14
          }}>
            {exporting ? 'Generating...' : `📥 ${MONTHS[month]} ${year}`}
          </button>
          <button onClick={() => generateAndDownloadPDF('yearly')} disabled={exporting} style={{
            padding:'16px', borderRadius:12, border:'none', background:C.blue, color:'#fff',
            fontWeight:600, cursor:exporting?'default':'pointer', opacity:exporting?0.6:1,
            fontFamily:SANS, fontSize:14
          }}>
            {exporting ? 'Generating...' : `📥 Year ${year}`}
          </button>
        </div>
        
        <p style={{margin:0, fontSize:12, color:C.inkSoft, fontFamily:SANS}}>
          Download as HTML file. Open in any browser and print/save as PDF.
        </p>
      </div>
    </div>
  );
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  green:'#1a7a4a', greenLight:'#e8f4ee', greenMid:'#2d9d61',
  ink:'#1a1a18', inkMid:'#4a4a46', inkSoft:'#8a8a84',
  sand:'#f5f3ef', sandMid:'#eceae4', sandDark:'#ddd9d0', white:'#ffffff',
  red:'#c0392b', redLight:'#fdf0ee', blue:'#1d4ed8', amber:'#b45309',
  purple:'#7c3aed',
};
const SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
const SANS  = "'DM Sans', system-ui, sans-serif";
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── Categories ───────────────────────────────────────────────────────────────
// Categories that must never count as spending, regardless of whether they're
// still shown as a pickable category. 'income' in particular is assigned
// directly at import time (parse.js) and is no longer a row in the category
// list below — this guarantees it stays excluded from spend totals even so.
const ALWAYS_EXCLUDED_CATS = new Set(['income', 'cc_payment', 'transfer']);

const DEFAULT_CATS = [
  {id:'alcohol',      label:'Alcohol & cigs',        icon:'Wine',           target:175, color:'#7c3aed'},
  {id:'banking',      label:'Banking fees & interest',icon:'Landmark',      target:400, color:'#57534e'},
  {id:'phone',        label:'Cell phone',            icon:'Smartphone',     target:45,  color:'#0891b2'},
  {id:'cleaning',     label:'Cleaning services',     icon:'Brush',          target:25,  color:'#0d9488'},
  {id:'clothing',     label:'Clothing',              icon:'Shirt',          target:50,  color:'#b45309'},
  {id:'cc_payment',   label:'Credit card payment',   icon:'CreditCard',     target:0,   color:'#57534e', excluded:true},
  {id:'entertainment',label:'Entertainment',         icon:'Ticket',         target:100, color:'#065f46'},
  {id:'gifts',        label:'Gifts',                 icon:'Gift',           target:25,  color:'#db2777'},
  {id:'hobbies',      label:'Golf & hobbies',        icon:'Dumbbell',       target:130, color:'#4f46e5'},
  {id:'groceries',    label:'Groceries',             icon:'ShoppingBasket', target:500, color:'#1a7a4a'},
  {id:'legal',        label:'Legal & professional',  icon:'Scale',          target:125, color:'#78716c'},
  {id:'medical',      label:'Medical & dental',      icon:'Stethoscope',    target:600, color:'#c0392b'},
  {id:'other',        label:'Other / uncategorised', icon:'Package',        target:200, color:'#6b7280'},
  {id:'pharmacy',     label:'Pharmacy',              icon:'Pill',           target:200, color:'#be185d'},
  {id:'rent',         label:'Home',                  icon:'Home',           target:1900,color:'#92400e'},
  {id:'rental_insurance',label:'Rental insurance',   icon:'Shield',         target:67,  color:'#1d4ed8'},
  {id:'restaurant',   label:'Restaurant & takeout',  icon:'Utensils',       target:500, color:'#1d4ed8'},
  {id:'salon',        label:'Salon & spa',           icon:'Scissors',       target:50,  color:'#9d174d'},
  {id:'subscriptions',label:'Subscriptions',         icon:'Music',          target:120, color:'#0369a1'},
  {id:'transfer',     label:'Transfers',             icon:'ArrowLeftRight', target:0,   color:'#78716c', excluded:true},
  {id:'transit',      label:'Transit (Presto)',      icon:'Train',          target:50,  color:'#0369a1'},
  {id:'travel',       label:'Travel',                icon:'Plane',          target:250, color:'#0e7490'},
  {id:'uber',         label:'Uber & taxis',          icon:'Car',            target:150, color:'#b45309'},
];
const COLOR_SWATCHES = ['#1a7a4a','#1d4ed8','#7c3aed','#b45309','#0369a1',
  '#be185d','#c0392b','#065f46','#4f46e5','#0891b2','#9d174d','#57534e','#6b7280'];
const ICON_MAP = {
  ShoppingBasket,Utensils,Wine,Car,Train,Pill,Stethoscope,Ticket,Code2,CreditCard,
  Shirt,Plane,Scissors,Scale,Package,Tag,Coffee,Music,BookOpen,Camera,Dumbbell,Leaf,PawPrint,Brush,Baby,
  Landmark,Smartphone,Zap,Gift,Shield,ArrowLeftRight,Home,
};
const PICKABLE_ICONS = Object.keys(ICON_MAP);


// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt   = n => '$' + Math.abs(n).toLocaleString('en-CA',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtK  = n => n>=1000 ? '$'+(n/1000).toFixed(1)+'k' : fmt(n);

// Derive avatar color from name — a stable hash, not a hardcoded name list,
// so this works for any household's actual names, not just specific people.
function nameColor(name) {
  const n = (name||'').toLowerCase();
  const h = [...n].reduce((a,c)=>a*31+c.charCodeAt(0),0);
  return COLOR_SWATCHES[Math.abs(h) % COLOR_SWATCHES.length];
}
function nameInitials(name) {
  return (name||'?').split(/\s+/).map(w=>w[0]).join('').slice(0,3).toUpperCase();
}

// ─── SVG Donut Chart ──────────────────────────────────────────────────────────
function polarXY(cx,cy,r,deg) {
  const rad = (deg-90)*Math.PI/180;
  return {x:cx+r*Math.cos(rad), y:cy+r*Math.sin(rad)};
}
function arcPath(cx,cy,R,r,start,end) {
  if (end-start >= 360) end = start+359.99;
  const la = end-start > 180 ? 1 : 0;
  const s=polarXY(cx,cy,R,start), e=polarXY(cx,cy,R,end);
  const si=polarXY(cx,cy,r,end),  ei=polarXY(cx,cy,r,start);
  return `M${s.x} ${s.y} A${R} ${R} 0 ${la} 1 ${e.x} ${e.y} L${si.x} ${si.y} A${r} ${r} 0 ${la} 0 ${ei.x} ${ei.y}Z`;
}
function DonutChart({data, total, size=220}) {
  const cx=size/2, cy=size/2, R=size*0.42, ri=size*0.26;
  let angle=0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {data.map(d=>{
        const pct=d.value/total; const sweep=pct*360;
        const path=arcPath(cx,cy,R,ri,angle,angle+sweep);
        angle+=sweep;
        return <path key={d.id} d={path} fill={d.color} opacity={0.9}/>;
      })}
      <text x={cx} y={cy-8} textAnchor="middle" fontFamily={SERIF}
        fontSize={size*0.09} fontWeight="600" fill={C.ink}>
        {fmt(total).replace('.00','')}
      </text>
      <text x={cx} y={cy+14} textAnchor="middle" fontFamily={SANS}
        fontSize={size*0.055} fill={C.inkSoft}>total</text>
    </svg>
  );
}

// ─── Atoms ────────────────────────────────────────────────────────────────────
function CatIcon({name,size=18,color='currentColor'}) {
  const Comp=ICON_MAP[name]||Package;
  return <Comp size={size} color={color} strokeWidth={1.6}/>;
}
function B42Logo({size=48}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <rect width="64" height="64" rx="14" fill={C.green}/>
      <text x="32" y="46" fontFamily={SERIF} fontSize="28" fontWeight="700"
        fill="white" textAnchor="middle" letterSpacing="-1">b42</text>
    </svg>
  );
}
function B42Badge() {
  return (
    <svg width="42" height="26" viewBox="0 0 68 40">
      <rect width="68" height="40" rx="8" fill={C.green}/>
      <text x="34" y="29" fontFamily={SERIF} fontSize="22" fontWeight="700"
        fill="white" textAnchor="middle" letterSpacing="-1">b42</text>
    </svg>
  );
}
function UserAvatar({name,size=28}) {
  const color=nameColor(name), initials=nameInitials(name);
  return <div style={{width:size,height:size,borderRadius:'50%',background:color,color:'#fff',
    display:'flex',alignItems:'center',justifyContent:'center',
    fontSize:size*0.29,fontWeight:600,letterSpacing:'-0.02em',flexShrink:0,fontFamily:SANS}}>
    {initials}</div>;
}
// Shared by Home and Spending so the two can never drift apart. Three real
// options — you, your partner, or combined — each with its own color, so
// which one is active is obvious at a glance, not just from the label.
function ViewToggle({view, setView, myLabel, partnerLabel}) {
  const options = [
    ['mine', capitalize(myLabel) || 'Me', VIEW_COLOR.mine],
    ['partner', capitalize(partnerLabel) || 'Partner', VIEW_COLOR.partner],
    ['combined', 'Combined', VIEW_COLOR.combined],
  ];
  return (
    <div style={{display:'flex', background:C.sandMid, borderRadius:12, padding:3, marginBottom:12, gap:3}}>
      {options.map(([k,l,color])=>(
        <button key={k} onClick={()=>setView(k)} style={{
          flex:1, border:'none', borderRadius:9, padding:'8px 4px', fontSize:12, fontWeight:600,
          cursor:'pointer', fontFamily:SANS, background: view===k ? color : 'transparent',
          color: view===k ? '#fff' : C.inkSoft,
          boxShadow: view===k ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
          display:'flex', alignItems:'center', justifyContent:'center', gap:5,
          transition:'background 0.15s, color 0.15s', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'
        }}>
          {k==='combined' && <Heart size={11} color={view===k?'#fff':C.inkSoft} fill={view===k?'#fff':'none'}/>}
          {l}
        </button>
      ))}
    </div>
  );
}
function Bar({spent,target,color}) {
  const pct=Math.min((spent/Math.max(target,1))*100,100);
  return <div style={{height:3,background:C.sandDark,borderRadius:99,overflow:'hidden'}}>
    <div style={{height:'100%',width:`${pct}%`,borderRadius:99,
      background:spent>target?C.red:color,transition:'width 0.4s ease'}}/></div>;
}
function Card({children,style={}}) {
  return <div style={{background:C.white,borderRadius:16,padding:'16px 18px',marginBottom:12,
    boxShadow:'0 1px 4px rgba(0,0,0,0.05),0 0 0 1px rgba(0,0,0,0.04)',...style}}>{children}</div>;
}
function SL({children}) {
  return <p style={{fontSize:11,fontWeight:600,color:C.inkSoft,textTransform:'uppercase',
    letterSpacing:'0.1em',margin:'0 0 8px',fontFamily:SANS}}>{children}</p>;
}
function Divider() { return <div style={{height:1,background:C.sandMid,margin:'2px 0'}}/>; }
function Toast({msg}) {
  return (
    <div style={{position:'fixed',bottom:90,left:0,right:0,zIndex:999,
      display:'flex',justifyContent:'center',pointerEvents:'none',animation:'fadeUp 0.2s ease'}}>
      <div style={{background:C.ink,color:'#fff',padding:'10px 22px',borderRadius:99,
        fontSize:13,fontWeight:500,whiteSpace:'nowrap',
        boxShadow:'0 4px 16px rgba(0,0,0,0.2)',fontFamily:SANS}}>{msg}</div>
    </div>
  );
}
function Spinner({size=16}) {
  return <div style={{width:size,height:size,border:`2px solid ${C.sandDark}`,
    borderTopColor:C.green,borderRadius:'50%',animation:'spin 0.7s linear infinite',
    display:'inline-block',flexShrink:0}}/>;
}

// ─── Processing Modal ─────────────────────────────────────────────────────────
// Shows during CSV upload so users know exactly what's happening and don't close the window
export function ProcessingModal({stage, fileName, rowCount, aiCount}) {
  const stages = {
    reading: {
      title: 'Reading your statement',
      msg:   `Opening ${fileName || 'your file'}…`,
      sub:   'This should only take a moment.',
    },
    parsing: {
      title: 'Parsing transactions',
      msg:   `Scanning rows and mapping columns…`,
      sub:   'Identifying dates, amounts, and merchant names.',
    },
    categorising: {
      title: `Categorising ${rowCount || ''} transactions`,
      msg:   'Matching merchants to your budget categories…',
      sub:   'Using 7 months of your spending history as a guide.',
    },
    ai: {
      title: 'Asking Claude to help',
      msg:   `${aiCount || 'Some'} merchants weren't recognised automatically.`,
      sub:   'Claude is categorising them now — this takes 5–15 seconds.',
    },
  };
  const s = stages[stage] || stages.reading;
  return (
    <div style={{position:'fixed',inset:0,zIndex:800,background:'rgba(26,26,24,0.75)',
      display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{background:C.white,borderRadius:20,padding:'32px 28px',maxWidth:340,
        width:'100%',textAlign:'center',boxShadow:'0 24px 48px rgba(0,0,0,0.25)'}}>
        <div style={{marginBottom:20}}>
          <Spinner size={40}/>
        </div>
        <h2 style={{fontFamily:SERIF,fontSize:24,fontWeight:600,color:C.ink,margin:'0 0 8px'}}>
          {s.title}
        </h2>
        <p style={{fontSize:14,color:C.inkMid,margin:'0 0 6px',fontFamily:SANS}}>{s.msg}</p>
        <p style={{fontSize:12,color:C.inkSoft,margin:'0 0 20px',fontFamily:SANS,lineHeight:1.6}}>
          {s.sub}
        </p>
        <div style={{background:C.redLight,border:`1px solid ${C.red}22`,borderRadius:10,
          padding:'10px 14px'}}>
          <p style={{margin:0,fontSize:12,fontWeight:600,color:C.red,fontFamily:SANS}}>
            ⚠ Do not close or refresh this page
          </p>
          <p style={{margin:'4px 0 0',fontSize:11,color:C.red+'99',fontFamily:SANS}}>
            Your data is being processed in the background.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Auth Screen (Sign Up / Sign In) ─────────────────────────────────────────
// ─── DISCLAIMER MODAL ─────────────────────────────────────────────────────────
function DisclaimerModal({onAcknowledge}) {
  return (
    <div style={{
      position:'fixed', inset:0, zIndex:999,
      display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center',
      background:'rgba(26,26,24,0.7)', padding:20
    }}>
      <div style={{
        background:C.white, borderRadius:16, padding:32,
        maxWidth:400, textAlign:'center', animation:'slideUp 0.3s ease'
      }}>
        <div style={{fontSize:48, marginBottom:16}}>🔒</div>
        
        <h1 style={{
          fontFamily:SERIF, fontSize:24, fontWeight:600, margin:'0 0 16px', color:C.ink
        }}>
          Your Privacy Matters
        </h1>
        
        <div style={{
          background:C.sand, borderRadius:12, padding:16, marginBottom:20,
          textAlign:'left'
        }}>
          <p style={{
            margin:'0 0 12px', fontSize:14, color:C.ink, lineHeight:1.8, fontFamily:SANS
          }}>
            <strong>We do not:</strong>
          </p>
          <ul style={{
            margin:0, paddingLeft:20, fontSize:14, color:C.inkMid, fontFamily:SANS, lineHeight:1.8
          }}>
            <li>Use, take, or store your data</li>
            <li>Track you or your activity</li>
            <li>Collect any personal information</li>
            <li>Share data with third parties</li>
          </ul>
          
          <p style={{
            margin:'12px 0 0', fontSize:14, color:C.ink, fontFamily:SANS, lineHeight:1.8
          }}>
            <strong>This is a purely educational tool.</strong>
          </p>
        </div>
        
        <p style={{
          margin:'0 0 20px', fontSize:13, color:C.inkMid, fontFamily:SANS, lineHeight:1.6
        }}>
          Have suggestions or found a bug? We'd love to hear from you!
        </p>
        
        <a href="mailto:yerbury@gmail.com" style={{
          display:'inline-block', marginBottom:16, fontSize:13, fontWeight:600,
          color:C.green, textDecoration:'none', fontFamily:SANS, padding:'8px 0'
        }}>
          ✉️ Send feedback: yerbury@gmail.com
        </a>
        
        <button onClick={onAcknowledge} style={{
          width:'100%', border:'none', background:C.green, color:'#fff',
          padding:'14px 20px', borderRadius:12, fontSize:14, fontWeight:600,
          cursor:'pointer', fontFamily:SANS, transition:'all 0.2s'
        }}>
          I understand • Let's go
        </button>
      </div>
    </div>
  );
}

export function AuthScreen({onAuth}) {
  const [mode,     setMode]    = useState('signup'); // 'signup' | 'signin'
  const [name,     setName]    = useState('');
  const [email,    setEmail]   = useState('');
  const [password, setPassword]= useState('');
  const [goal,     setGoal]    = useState('');
  const [showPw,   setShowPw]  = useState(false);
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState(null);
  const [done,     setDone]    = useState(false); // after signup: show "invite partner" screen
  const [disclaimerAcknowledged, setDisclaimerAcknowledged] = useState(false);

  // Check localStorage after mount (browser-only)
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      setDisclaimerAcknowledged(!!localStorage.getItem('budget_disclaimer_v1'));
    }
  }, []);

  async function handleSignUp(e) {
    e.preventDefault();
    if (!name.trim()||!email.trim()||!password) return;
    setLoading(true); setError(null);
    try {
      await signUp(email.trim(), password, {
        name:  name.trim(),
        role:  name.toLowerCase().includes('jordan') ? 'jordan' :
               name.toLowerCase().includes('ness')   ? 'ness'   : 'other',
        goal:  goal.trim(),
        color: nameColor(name.trim()),
      });
      setDone(true);
    } catch(err) { setError(err.message); }
    setLoading(false);
  }

  async function handleSignIn(e) {
    e.preventDefault();
    if (!email.trim()||!password) return;
    setLoading(true); setError(null);
    try { await signIn(email.trim(), password); }
    catch(err) { setError(err.message); }
    setLoading(false);
  }

  // After first signup: tell them to invite their partner
  if (done) return (
    <div style={{minHeight:'100dvh',display:'flex',flexDirection:'column',
      alignItems:'center',justifyContent:'center',padding:36,background:C.sand}}>
      <div style={{fontSize:56,marginBottom:12}}>🎉</div>
      <h1 style={{fontFamily:SERIF,fontSize:30,fontWeight:600,margin:'0 0 8px',color:C.ink,letterSpacing:'-0.02em'}}>
        Welcome, {name.split(' ')[0]}!
      </h1>
      <p style={{fontSize:15,color:C.inkMid,margin:'0 0 32px',textAlign:'center',lineHeight:1.7,maxWidth:320}}>
        Your account is set up. Now invite your partner to create their own account so you can track spending together.
      </p>
      <Card style={{width:'100%',maxWidth:340,marginBottom:16}}>
        <p style={{margin:'0 0 8px',fontSize:13,fontWeight:600,color:C.ink,fontFamily:SANS}}>
          Share this with your partner
        </p>
        <div style={{background:C.sand,borderRadius:10,padding:'10px 14px',marginBottom:12,
          fontFamily:'monospace',fontSize:13,color:C.inkMid,wordBreak:'break-all'}}>
          {window.location.origin}
        </div>
        <p style={{margin:0,fontSize:12,color:C.inkSoft,fontFamily:SANS,lineHeight:1.6}}>
          They should open that link and click <b>Create account</b> to sign up with their own name and email.
        </p>
      </Card>
      <button onClick={()=>onAuth()} style={{border:'none',padding:'14px 32px',borderRadius:12,
        background:C.green,color:'#fff',fontSize:15,fontWeight:600,cursor:'pointer',fontFamily:SANS}}>
        Open my budget →
      </button>
    </div>
  );

  return (
    <div style={{minHeight:'100dvh',display:'flex',flexDirection:'column',
      alignItems:'center',justifyContent:'center',padding:28,background:C.sand}}>
      <B42Logo size={60}/>
      <h1 style={{fontFamily:SERIF,fontSize:32,fontWeight:600,letterSpacing:'-0.02em',
        margin:'14px 0 4px',color:C.ink}}>Budget For Two</h1>
      <p style={{fontSize:12,color:C.green,fontWeight:600,margin:'0 0 28px',
        letterSpacing:'0.1em',textTransform:'uppercase'}}>Shared budgeting, made simple</p>

      {/* Mode tabs */}
      <div style={{display:'flex',background:C.sandMid,borderRadius:12,padding:3,
        marginBottom:20,width:'100%',maxWidth:340}}>
        {[['signup','Create account'],['signin','Sign in']].map(([k,l])=>(
          <button key={k} onClick={()=>setMode(k)} style={{flex:1,border:'none',borderRadius:9,
            padding:'9px 0',fontSize:13,fontWeight:600,cursor:'pointer',
            background:mode===k?C.white:'transparent',
            color:mode===k?C.ink:C.inkSoft,
            boxShadow:mode===k?'0 1px 3px rgba(0,0,0,0.1)':'none',
            fontFamily:SANS}}>{l}</button>
        ))}
      </div>

      <form onSubmit={mode==='signup'?handleSignUp:handleSignIn}
        style={{width:'100%',maxWidth:340}}>

        {mode==='signup' && (
          <>
            <p style={{margin:'0 0 10px',fontSize:13,color:C.inkSoft,fontFamily:SANS,
              textAlign:'center',lineHeight:1.6}}>
              Takes 2 minutes. Once both of you are set up,<br/>your budget runs itself.
            </p>
            <input value={name} onChange={e=>setName(e.target.value)}
              placeholder="Your name"
              style={{width:'100%',border:`1px solid ${C.sandDark}`,borderRadius:10,
                padding:'13px 14px',fontSize:15,color:C.ink,background:C.white,
                marginBottom:10,outline:'none',fontFamily:SANS,boxSizing:'border-box'}}/>
          </>
        )}

        <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
          placeholder="Email address" required
          style={{width:'100%',border:`1px solid ${C.sandDark}`,borderRadius:10,
            padding:'13px 14px',fontSize:15,color:C.ink,background:C.white,
            marginBottom:10,outline:'none',fontFamily:SANS,boxSizing:'border-box'}}/>

        <div style={{position:'relative',marginBottom:mode==='signup'?10:16}}>
          <input type={showPw?'text':'password'} value={password}
            onChange={e=>setPassword(e.target.value)}
            placeholder="Password" required
            style={{width:'100%',border:`1px solid ${C.sandDark}`,borderRadius:10,
              padding:'13px 44px 13px 14px',fontSize:15,color:C.ink,background:C.white,
              outline:'none',fontFamily:SANS,boxSizing:'border-box'}}/>
          <button type="button" onClick={()=>setShowPw(p=>!p)}
            style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',
              border:'none',background:'none',cursor:'pointer',color:C.inkSoft}}>
            {showPw?<EyeOff size={18}/>:<Eye size={18}/>}
          </button>
        </div>

        {mode==='signup' && (
          <div style={{marginBottom:16}}>
            <label style={{display:'block',fontSize:12,color:C.inkSoft,fontFamily:SANS,marginBottom:6}}>
              What is one financial goal you want to achieve this year? (optional)
            </label>
            <input value={goal} onChange={e=>setGoal(e.target.value)}
              placeholder="e.g. Pay off CTFS card by December"
              style={{width:'100%',border:`1px solid ${C.sandDark}`,borderRadius:10,
                padding:'13px 14px',fontSize:14,color:C.ink,background:C.white,
                outline:'none',fontFamily:SANS,boxSizing:'border-box'}}/>
          </div>
        )}

        {error && (
          <div style={{background:C.redLight,border:`1px solid ${C.red}33`,borderRadius:10,
            padding:'10px 14px',marginBottom:12,display:'flex',gap:8,alignItems:'center'}}>
            <AlertCircle size={14} color={C.red}/>
            <p style={{margin:0,fontSize:13,color:C.red,fontFamily:SANS}}>{error}</p>
          </div>
        )}

        <button type="submit" disabled={loading}
          style={{width:'100%',border:'none',padding:'15px',borderRadius:12,
            background:C.green,color:'#fff',fontSize:15,fontWeight:600,cursor:'pointer',
            fontFamily:SANS,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
          {loading?<><Spinner/>Processing…</>:mode==='signup'?'Create my account →':'Sign in →'}
        </button>
      </form>

      {mode==='signup' && (
        <p style={{fontSize:11,color:C.inkSoft,marginTop:20,textAlign:'center',
          maxWidth:280,lineHeight:1.7,fontFamily:SANS}}>
          Your data is stored securely in Supabase.<br/>
          Both partners create separate accounts that share the same budget.
        </p>
      )}
      
      {!disclaimerAcknowledged && (
        <DisclaimerModal onAcknowledge={() => {
          localStorage.setItem('budget_disclaimer_v1', 'true');
          setDisclaimerAcknowledged(true);
        }} />
      )}
    </div>
  );
}

// ─── Add Category Modal ───────────────────────────────────────────────────────
// ─── EDIT TRANSACTION MODAL ───────────────────────────────────────────────────
// The one place a transaction's date, amount, and category can all be changed
// together. Changing the date moves it to a different month's view — Bills
// tab can't do this (it edits a recurring pattern, not one transaction), so
// this is the actual fix for "this charge is filed under the wrong month."
export function EditTransactionModal({tx, allCats, onSave, onClose}) {
  const [date, setDate] = useState(tx.date || today());
  const [amount, setAmount] = useState(tx.amount != null ? String(tx.amount) : '');
  const [category, setCategory] = useState(tx.category || tx.cat || 'other');
  const [note, setNote] = useState(tx.note || tx.description || '');
  const [saving, setSaving] = useState(false);

  // Income is never reachable here on purpose — it's only ever set by the
  // statement importer's credit-detection, or the dedicated income-confirm
  // flows on Home. Recategorising a spending transaction can never turn it
  // into income by accident.
  const pickableCats = allCats.filter(c => !ALWAYS_EXCLUDED_CATS.has(c.id) || c.id === 'cc_payment' || c.id === 'transfer');

  const inputStyle = {
    width:'100%', padding:'11px 12px', border:`1px solid ${C.sandDark}`, borderRadius:10,
    background:C.sand, color:C.ink, fontFamily:SANS, fontSize:15, outline:'none', boxSizing:'border-box'
  };

  async function save() {
    const amt = parseFloat(amount);
    if (!date || isNaN(amt) || amt <= 0) return;
    setSaving(true);
    const d = new Date(date + 'T00:00:00');
    await onSave({
      date, amount: amt, category, note: note.trim(),
      year: d.getFullYear(), month: d.getMonth(),
    });
    setSaving(false);
    onClose();
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:520,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
      <div onClick={onClose} style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.4)'}}/>
      <div style={{position:'relative',background:C.white,borderRadius:'20px 20px 0 0',
        padding:'24px 20px 40px',animation:'slideUp 0.25s ease',maxHeight:'85dvh',overflowY:'auto'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:20}}>
          <h2 style={{flex:1,fontFamily:SERIF,fontSize:22,fontWeight:600,color:C.ink}}>Edit transaction</h2>
          <button onClick={onClose} style={{border:'none',background:'none',padding:4,cursor:'pointer'}}>
            <X size={20} color={C.inkSoft}/>
          </button>
        </div>

        <p style={{margin:'0 0 16px', fontSize:12, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6}}>
          Changing the date moves this to that month's view — this is the way to fix
          a charge that's sitting under the wrong month.
        </p>

        <SL>Date</SL>
        <input type="date" value={date} onChange={e=>setDate(e.target.value)}
          style={{...inputStyle, marginBottom:16}}/>

        <SL>Amount</SL>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
          <span style={{fontSize:18,color:C.inkSoft}}>$</span>
          <input type="number" value={amount} onChange={e=>setAmount(e.target.value)}
            style={{...inputStyle, flex:1}}/>
        </div>

        <SL>Category</SL>
        <select value={category} onChange={e=>setCategory(e.target.value)}
          style={{...inputStyle, marginBottom:16, cursor:'pointer'}}>
          {pickableCats.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
        </select>

        <SL>Note</SL>
        <input type="text" value={note} onChange={e=>setNote(e.target.value)}
          placeholder="What was this for?"
          style={{...inputStyle, marginBottom:24}}/>

        <button onClick={save} disabled={saving || !amount}
          style={{border:'none',width:'100%',padding:'15px',borderRadius:12,
            background:(saving||!amount)?C.sandDark:C.green,color:'#fff',
            fontSize:16,fontWeight:600,cursor:(saving||!amount)?'default':'pointer',fontFamily:SANS}}>
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

export function AddCatModal({onSave,onClose}) {
  const [label, setLabel] = useState('');
  const [target,setTarget]= useState(100);
  const [icon,  setIcon]  = useState('Tag');
  const [color, setColor] = useState(COLOR_SWATCHES[0]);
  return (
    <div style={{position:'fixed',inset:0,zIndex:500,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
      <div onClick={onClose} style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.4)'}}/>
      <div style={{position:'relative',background:C.white,borderRadius:'20px 20px 0 0',
        padding:'24px 20px 40px',animation:'slideUp 0.25s ease',maxHeight:'85dvh',overflowY:'auto'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:20}}>
          <h2 style={{flex:1,fontFamily:SERIF,fontSize:22,fontWeight:600,color:C.ink}}>New category</h2>
          <button onClick={onClose} style={{border:'none',background:'none',padding:4,cursor:'pointer'}}>
            <X size={20} color={C.inkSoft}/>
          </button>
        </div>
        <SL>Name</SL>
        <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. Pet supplies"
          style={{width:'100%',border:`1px solid ${C.sandDark}`,borderRadius:10,padding:'12px 14px',
            fontSize:16,color:C.ink,background:C.sand,marginBottom:16,outline:'none',
            fontFamily:SANS,boxSizing:'border-box'}}/>
        <SL>Monthly target</SL>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
          <span style={{fontSize:18,color:C.inkSoft}}>$</span>
          <input type="number" value={target} onChange={e=>setTarget(parseInt(e.target.value)||0)}
            style={{flex:1,border:`1px solid ${C.sandDark}`,borderRadius:10,padding:'12px 14px',
              fontSize:16,color:C.ink,background:C.sand,outline:'none',fontFamily:SANS}}/>
        </div>
        <SL>Icon</SL>
        <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:8,marginBottom:16}}>
          {PICKABLE_ICONS.map(k=>(
            <button key={k} onClick={()=>setIcon(k)} style={{border:`2px solid ${icon===k?color:C.sandDark}`,
              borderRadius:10,padding:'8px 0',display:'flex',alignItems:'center',justifyContent:'center',
              background:icon===k?color+'18':C.white,cursor:'pointer'}}>
              <CatIcon name={k} size={16} color={icon===k?color:C.inkSoft}/>
            </button>
          ))}
        </div>
        <SL>Colour</SL>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:24}}>
          {COLOR_SWATCHES.map(sw=>(
            <button key={sw} onClick={()=>setColor(sw)} style={{width:30,height:30,borderRadius:'50%',
              background:sw,border:`3px solid ${color===sw?C.ink:'transparent'}`,cursor:'pointer'}}/>
          ))}
        </div>
        <button onClick={()=>{if(label.trim())onSave({id:'custom_'+uid(),label:label.trim(),target,icon,color,custom:true});}}
          disabled={!label.trim()}
          style={{border:'none',width:'100%',padding:'15px',borderRadius:12,
            background:label.trim()?C.green:C.sandDark,color:label.trim()?C.white:C.inkSoft,
            fontSize:16,fontWeight:600,cursor:label.trim()?'pointer':'default',fontFamily:SANS}}>
          Add category
        </button>
      </div>
    </div>
  );
}


// ─── ReceiptScanModal ───────────────────────────────────────────────────────
// Photo → Storage → Claude reads it → user confirms → becomes a transaction.
// Three states in one modal: pick a photo, wait while it's read, then review
// and edit what Claude found before it becomes real spending.
export function ReceiptScanModal({allCats, profile, partnerName, onScan, onConfirm, onClose}) {
  const myFirst = firstName(profile?.name) || 'me';
  const partnerFirst = firstName(partnerName) || 'partner';
  const [file, setFile]       = useState(null);
  const [preview, setPreview] = useState(null);
  const [stage, setStage]     = useState('pick'); // 'pick' | 'reading' | 'review' | 'error'
  const [error, setError]     = useState('');
  const [receiptId, setReceiptId] = useState(null);
  const [fields, setFields]   = useState(null); // {merchant,date,amount,category,confidence,itemsSummary}
  const [who, setWho]         = useState(myFirst); // whose spending this is — either partner can log for the other
  const [saving, setSaving]   = useState(false);
  const inputRef = useRef(null);

  async function handleFile(f) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStage('reading');
    setError('');
    try {
      const result = await onScan(f);
      setReceiptId(result.id);
      setFields({
        merchant: result.merchant, date: result.date, amount: result.amount,
        category: result.category, confidence: result.confidence,
        itemsSummary: result.itemsSummary,
      });
      setStage('review');
    } catch (err) {
      setError(err.message || 'Something went wrong reading that receipt.');
      setStage('error');
    }
  }

  async function save() {
    if (!fields || saving) return;
    setSaving(true);
    try {
      const attributedTo = resolveWho(who, profile?.name, partnerName, myFirst);
      await onConfirm(receiptId, { ...fields, who: attributedTo });
      onClose();
    } catch {
      setError('Could not save that transaction — try again.');
      setStage('error');
      setSaving(false);
    }
  }

  const inputStyle = {
    width:'100%', padding:'11px 12px', border:`1px solid ${C.sandDark}`, borderRadius:10,
    background:C.sand, color:C.ink, fontFamily:SANS, fontSize:15, outline:'none', boxSizing:'border-box'
  };

  return (
    <div style={{position:'fixed',inset:0,zIndex:500,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
      <div onClick={stage==='reading'?undefined:onClose} style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.4)'}}/>
      <div style={{position:'relative',background:C.white,borderRadius:'20px 20px 0 0',
        padding:'24px 20px 40px',animation:'slideUp 0.25s ease',maxHeight:'88dvh',overflowY:'auto'}}>

        <div style={{display:'flex',alignItems:'center',marginBottom:20}}>
          <h2 style={{flex:1,fontFamily:SERIF,fontSize:22,fontWeight:600,color:C.ink}}>Scan a receipt</h2>
          {stage!=='reading' && (
            <button onClick={onClose} style={{border:'none',background:'none',padding:4,cursor:'pointer'}}>
              <X size={20} color={C.inkSoft}/>
            </button>
          )}
        </div>

        {stage==='pick' && (
          <>
            <p style={{margin:'0 0 20px',fontSize:13,color:C.inkSoft,fontFamily:SANS,lineHeight:1.6}}>
              Take a photo of a paper receipt, or choose one from your camera roll.
              Claude reads the merchant, total, and date, and suggests a category —
              you confirm before anything's added.
            </p>
            <input ref={inputRef} type="file" accept="image/*" capture="environment"
              style={{display:'none'}} onChange={e=>handleFile(e.target.files?.[0])}/>
            <button onClick={()=>inputRef.current?.click()} style={{
              width:'100%', border:`1.5px dashed ${C.sandDark}`, borderRadius:14, padding:'28px 16px',
              background:C.sand, cursor:'pointer', display:'flex', flexDirection:'column',
              alignItems:'center', gap:8, fontFamily:SANS
            }}>
              <div style={{width:48,height:48,borderRadius:99,background:C.green+'18',
                display:'flex',alignItems:'center',justifyContent:'center'}}>
                <Camera size={22} color={C.green}/>
              </div>
              <span style={{fontSize:14,fontWeight:600,color:C.ink}}>Take or choose a photo</span>
              <span style={{fontSize:11,color:C.inkSoft}}>JPG, PNG, up to 15MB</span>
            </button>
          </>
        )}

        {stage==='reading' && (
          <div style={{textAlign:'center', padding:'20px 0'}}>
            {preview && (
              <img src={preview} alt="Receipt" style={{maxWidth:'100%', maxHeight:220, borderRadius:12,
                marginBottom:20, boxShadow:'0 4px 16px rgba(0,0,0,0.15)'}}/>
            )}
            <Spinner size={22}/>
            <p style={{margin:'14px 0 0', fontSize:14, color:C.inkMid, fontFamily:SANS, fontWeight:600}}>
              Reading your receipt...
            </p>
            <p style={{margin:'4px 0 0', fontSize:12, color:C.inkSoft, fontFamily:SANS}}>
              Uploading and analyzing — a few seconds
            </p>
          </div>
        )}

        {stage==='error' && (
          <div>
            {preview && (
              <img src={preview} alt="Receipt" style={{maxWidth:'100%', maxHeight:180, borderRadius:12,
                marginBottom:16, display:'block', marginLeft:'auto', marginRight:'auto'}}/>
            )}
            <div style={{background:C.redLight, border:`1px solid ${C.red}33`, borderRadius:12,
              padding:'12px 14px', marginBottom:16, display:'flex', gap:10, alignItems:'flex-start'}}>
              <AlertCircle size={17} color={C.red} style={{flexShrink:0, marginTop:1}}/>
              <p style={{margin:0, fontSize:12, color:'#9b2c2c', fontFamily:SANS, lineHeight:1.6}}>{error}</p>
            </div>
            <div style={{display:'flex', gap:8}}>
              <button onClick={onClose} style={{flex:1, border:`1px solid ${C.sandDark}`, background:'white',
                color:C.ink, padding:'12px', borderRadius:10, fontWeight:600, fontSize:14, fontFamily:SANS, cursor:'pointer'}}>
                Cancel
              </button>
              <button onClick={()=>{setStage('pick'); setFile(null); setPreview(null); setError('');}} style={{
                flex:1, border:'none', background:C.green, color:'white', padding:'12px', borderRadius:10,
                fontWeight:600, fontSize:14, fontFamily:SANS, cursor:'pointer'}}>
                Try another photo
              </button>
            </div>
          </div>
        )}

        {stage==='review' && fields && (
          <div>
            <div style={{display:'flex', gap:12, marginBottom:16}}>
              {preview && (
                <img src={preview} alt="Receipt" style={{width:80, height:80, objectFit:'cover',
                  borderRadius:10, flexShrink:0, boxShadow:'0 2px 8px rgba(0,0,0,0.12)'}}/>
              )}
              <div style={{flex:1, minWidth:0}}>
                <p style={{margin:'0 0 4px', fontSize:11, color:C.inkSoft, fontFamily:SANS,
                  textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600}}>
                  Claude read this as{fields.confidence==='low' ? ' (low confidence — check carefully)' : ''}
                </p>
                {fields.itemsSummary && (
                  <p style={{margin:0, fontSize:12, color:C.inkMid, fontFamily:SANS, fontStyle:'italic',
                    lineHeight:1.4}}>{fields.itemsSummary}</p>
                )}
              </div>
            </div>

            <SL>Merchant</SL>
            <input value={fields.merchant} onChange={e=>setFields({...fields, merchant:e.target.value})}
              style={{...inputStyle, marginBottom:14}}/>

            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14}}>
              <div>
                <SL>Amount</SL>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute', left:12, top:'50%', transform:'translateY(-50%)',
                    fontSize:15, color:C.inkSoft}}>$</span>
                  <input type="number" value={fields.amount}
                    onChange={e=>setFields({...fields, amount:parseFloat(e.target.value)||0})}
                    style={{...inputStyle, paddingLeft:24}}/>
                </div>
              </div>
              <div>
                <SL>Date</SL>
                <input type="date" value={fields.date}
                  onChange={e=>setFields({...fields, date:e.target.value})}
                  style={inputStyle}/>
              </div>
            </div>

            <SL>Category</SL>
            <select value={fields.category} onChange={e=>setFields({...fields, category:e.target.value})}
              style={{...inputStyle, marginBottom:16, cursor:'pointer'}}>
              {allCats.filter(c=>!c.excluded).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
            </select>

            <SL>Whose spending is this?</SL>
            <div style={{display:'flex', gap:8, marginBottom:22}}>
              <button onClick={()=>setWho(myFirst)} style={{
                flex:1, padding:'9px 12px', border:`1.5px solid ${who===myFirst?C.blue:C.sandDark}`,
                borderRadius:10, background:who===myFirst?C.blue+'15':'white',
                color:who===myFirst?C.blue:C.ink, fontSize:13, fontWeight:600, fontFamily:SANS, cursor:'pointer'}}>
                {capitalize(myFirst)}
              </button>
              <button onClick={()=>setWho(partnerFirst)} style={{
                flex:1, padding:'9px 12px', border:`1.5px solid ${who===partnerFirst?C.blue:C.sandDark}`,
                borderRadius:10, background:who===partnerFirst?C.blue+'15':'white',
                color:who===partnerFirst?C.blue:C.ink, fontSize:13, fontWeight:600, fontFamily:SANS, cursor:'pointer'}}>
                {capitalize(partnerFirst)}
              </button>
            </div>

            <div style={{display:'flex', gap:8}}>
              <button onClick={onClose} style={{flex:1, border:`1px solid ${C.sandDark}`, background:'white',
                color:C.ink, padding:'13px', borderRadius:10, fontWeight:600, fontSize:14, fontFamily:SANS, cursor:'pointer'}}>
                Discard
              </button>
              <button onClick={save} disabled={saving || !fields.amount} style={{
                flex:2, border:'none', background:(saving||!fields.amount)?C.sandDark:C.green, color:'white',
                padding:'13px', borderRadius:10, fontWeight:600, fontSize:14, fontFamily:SANS,
                cursor:(saving||!fields.amount)?'default':'pointer'}}>
                {saving ? 'Adding...' : `Add ${fmt(fields.amount)} to Spending`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// Shows all transactions still in "Other" so the user can re-categorise them.
// Each row has: description, date, amount, category dropdown, note field, AI button.
export function OtherReviewModal({ items, allCats, onSave, onClose, onDeleteRow }) {
  // Local edits: { id: { category, note } }
  const [edits,   setEdits]   = useState(() =>
    Object.fromEntries(items.map(t => [t.id, { category: t.category || 'other', note: t.note || '' }]))
  );
  const [aiStatus, setAiStatus] = useState({}); // { id: 'loading' | { category, reason } | 'error' }
  const [saving,   setSaving]   = useState(false);

  function edit(id, patch) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function askAI(tx) {
    if (!AI_AVAILABLE) return;
    setAiStatus(prev => ({ ...prev, [tx.id]: 'loading' }));
    const catIds = allCats.map(c => c.id);
    const result = await suggestCategory(tx.description, tx.amount, catIds);
    if (result?.category) {
      setAiStatus(prev => ({ ...prev, [tx.id]: result }));
    } else {
      setAiStatus(prev => ({ ...prev, [tx.id]: 'error' }));
    }
  }

  function acceptAI(id) {
    const sug = aiStatus[id];
    if (sug && sug !== 'loading' && sug !== 'error') {
      edit(id, { category: sug.category });
    }
  }

  async function saveAll() {
    setSaving(true);
    try {
      await Promise.all(
        items.map(tx =>
          updateBankImport(tx.id, {
            category: edits[tx.id]?.category || tx.category,
            note:     edits[tx.id]?.note     || tx.note || '',
          })
        )
      );
      onSave();
    } catch (err) {
      console.error('Save failed:', err);
    }
    setSaving(false);
  }

  const changed = items.filter(tx =>
    edits[tx.id]?.category !== (tx.category || 'other') ||
    (edits[tx.id]?.note || '') !== (tx.note || '')
  ).length;

  return (
    <div style={{ position:'fixed', inset:0, zIndex:600,
      display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      {/* Backdrop */}
      <div onClick={onClose}
        style={{ position:'absolute', inset:0, background:'rgba(26,26,24,0.6)' }}/>

      {/* Sheet */}
      <div style={{ position:'relative', background:C.sand, borderRadius:'20px 20px 0 0',
        maxHeight:'92dvh', display:'flex', flexDirection:'column',
        animation:'slideUp 0.25s ease', boxShadow:'0 -8px 32px rgba(0,0,0,0.2)' }}>

        {/* Header */}
        <div style={{ padding:'20px 20px 14px', borderBottom:`1px solid ${C.sandMid}`,
          flexShrink:0, background:C.white, borderRadius:'20px 20px 0 0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:6 }}>
            <div style={{ flex:1 }}>
              <h2 style={{ margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
                Review uncategorised transactions
              </h2>
              <p style={{ margin:'4px 0 0', fontSize:13, color:C.inkSoft, fontFamily:SANS }}>
                {items.length} {items.length === 1 ? 'item' : 'items'} landed in "Other".
                Assign each to the right category and add a note so you know what it was.
              </p>
            </div>
            <button onClick={onClose}
              style={{ border:'none', background:'none', padding:6, cursor:'pointer', flexShrink:0 }}>
              <X size={22} color={C.inkSoft}/>
            </button>
          </div>
          {AI_AVAILABLE && (
            <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd', borderRadius:10,
              padding:'8px 12px', display:'flex', gap:8, alignItems:'center' }}>
              <Sparkles size={13} color={C.purple}/>
              <p style={{ margin:0, fontSize:12, color:'#5b21b6', fontFamily:SANS }}>
                Tap <b>Ask AI</b> on any row for an instant category suggestion.
              </p>
            </div>
          )}
        </div>

        {/* Scrollable list */}
        <div style={{ overflowY:'auto', flex:1, padding:'12px 16px' }}>
          {items.map((tx, i) => {
            const catVal  = edits[tx.id]?.category || 'other';
            const noteVal = edits[tx.id]?.note || '';
            const cat     = allCats.find(c => c.id === catVal) || { color:C.inkSoft, icon:'Package' };
            const ai      = aiStatus[tx.id];
            const isOther = catVal === 'other';

            return (
              <div key={tx.id} style={{ background:C.white, borderRadius:14,
                padding:'14px 16px', marginBottom:10,
                boxShadow:'0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.04)',
                border: isOther ? `1.5px solid ${C.amber}55` : `1.5px solid ${C.green}33` }}>

                {/* Top row: description + amount */}
                <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:10 }}>
                  <div style={{ width:36, height:36, borderRadius:10, background:cat.color+'18',
                    display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <CatIcon name={cat.icon} size={18} color={cat.color}/>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:0, fontSize:14, fontWeight:600, color:C.ink,
                      fontFamily:SANS, lineHeight:1.3 }}>{tx.description}</p>
                    <p style={{ margin:'3px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS }}>
                      {tx.date} · {instLabel(tx.source)}
                    </p>
                  </div>
                  <p style={{ margin:0, fontFamily:SERIF, fontSize:18, fontWeight:700,
                    color:C.ink, flexShrink:0 }}>{fmt(tx.amount)}</p>
                </div>

                {/* Category selector */}
                <div style={{ marginBottom:8 }}>
                  <label style={{ fontSize:11, color:C.inkSoft, textTransform:'uppercase',
                    letterSpacing:'0.08em', fontFamily:SANS, display:'block', marginBottom:4 }}>
                    Category {isOther && <span style={{ color:C.amber }}>— needs review</span>}
                  </label>
                  <select value={catVal}
                    onChange={e => {
                      if (e.target.value === '__delete') { onDeleteRow?.(tx); return; }
                      edit(tx.id, { category: e.target.value });
                    }}
                    style={{ width:'100%', border:`1.5px solid ${isOther?C.amber:cat.color}`,
                      borderRadius:9, padding:'8px 10px', fontSize:13, fontWeight:600,
                      color:isOther?C.amber:cat.color, background:C.white,
                      fontFamily:SANS, cursor:'pointer', outline:'none' }}>
                    {allCats.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                    <option disabled>──────────</option>
                    <option value="__delete">Delete — this is a duplicate</option>
                  </select>
                </div>

                {/* AI suggestion pill */}
                {AI_AVAILABLE && (
                  <div style={{ marginBottom:8 }}>
                    {!ai && (
                      <button onClick={() => askAI(tx)}
                        style={{ border:`1px solid ${C.purple}`, borderRadius:8, padding:'5px 12px',
                          background:'#f5f3ff', color:C.purple, fontSize:12, fontWeight:600,
                          cursor:'pointer', fontFamily:SANS,
                          display:'flex', alignItems:'center', gap:5 }}>
                        <Sparkles size={12} color={C.purple}/>
                        Ask AI to suggest a category
                      </button>
                    )}
                    {ai === 'loading' && (
                      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0' }}>
                        <Spinner size={13}/>
                        <span style={{ fontSize:12, color:C.inkSoft, fontFamily:SANS }}>
                          Claude is thinking…
                        </span>
                      </div>
                    )}
                    {ai === 'error' && (
                      <p style={{ margin:0, fontSize:12, color:C.red, fontFamily:SANS }}>
                        AI couldn't categorise this one. Try picking manually.
                      </p>
                    )}
                    {ai && ai !== 'loading' && ai !== 'error' && (
                      <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd',
                        borderRadius:9, padding:'8px 12px' }}>
                        <p style={{ margin:'0 0 4px', fontSize:12, color:'#5b21b6',
                          fontFamily:SANS, fontWeight:600 }}>
                          AI suggests:&nbsp;
                          <span style={{ color:allCats.find(c=>c.id===ai.category)?.color||C.ink }}>
                            {allCats.find(c=>c.id===ai.category)?.label || ai.category}
                          </span>
                        </p>
                        <p style={{ margin:'0 0 8px', fontSize:11, color:'#7c3aed', fontFamily:SANS }}>
                          {ai.reason}
                        </p>
                        <div style={{ display:'flex', gap:6 }}>
                          <button onClick={() => acceptAI(tx.id)}
                            style={{ border:'none', borderRadius:7, padding:'5px 12px',
                              background:C.green, color:'#fff', fontSize:12,
                              fontWeight:600, cursor:'pointer', fontFamily:SANS }}>
                            Accept
                          </button>
                          <button onClick={() => setAiStatus(prev => ({ ...prev, [tx.id]: null }))}
                            style={{ border:`1px solid ${C.sandDark}`, borderRadius:7,
                              padding:'5px 10px', background:'#fff', fontSize:12,
                              color:C.inkSoft, cursor:'pointer', fontFamily:SANS }}>
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Note field */}
                <div>
                  <label style={{ fontSize:11, color:C.inkSoft, textTransform:'uppercase',
                    letterSpacing:'0.08em', fontFamily:SANS, display:'block', marginBottom:4 }}>
                    Your note (what was this?)
                  </label>
                  <input
                    type="text"
                    value={noteVal}
                    onChange={e => edit(tx.id, { note: e.target.value })}
                    placeholder={`e.g. "Groceries at No Frills" or "Birthday dinner"`}
                    style={{ width:'100%', border:`1px solid ${C.sandDark}`, borderRadius:9,
                      padding:'8px 12px', fontSize:13, color:C.ink, background:C.sand,
                      fontFamily:SANS, outline:'none', boxSizing:'border-box',
                      caretColor:C.green }}
                  />
                </div>
              </div>
            );
          })}
          <div style={{ height:20 }}/>
        </div>

        {/* Save footer */}
        <div style={{ padding:'12px 16px 24px', borderTop:`1px solid ${C.sandMid}`,
          background:C.white, flexShrink:0 }}>
          <button onClick={saveAll} disabled={saving}
            style={{ width:'100%', border:'none', padding:'15px', borderRadius:14,
              background:C.green, color:'#fff', fontSize:15, fontWeight:700,
              cursor:'pointer', fontFamily:SANS,
              display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            {saving ? <><Spinner/>Saving…</> :
              changed > 0
                ? `Save ${changed} change${changed > 1 ? 's' : ''}`
                : 'Done — close'}
          </button>
          <p style={{ margin:'8px 0 0', fontSize:11, color:C.inkSoft,
            textAlign:'center', fontFamily:SANS }}>
            Items you leave as "Other" can be reviewed again from the Home tab.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── HOME TAB ─────────────────────────────────────────────────────────────────
// ─── PREDICTED INCOME EDITOR (inline, expands under the hero) ────────────────
// ─── ADVICE BUBBLE ────────────────────────────────────────────────────────────
// "Should we spend this, or hold off?" — on demand, not automatic, so it never
// costs an API call or feels naggy just for loading the page.
function AdviceBubble({snapshot}) {
  const [state, setState] = useState('idle'); // 'idle' | 'loading' | 'shown' | 'error'
  const [advice, setAdvice] = useState(null);
  const [source, setSource] = useState(null);

  async function ask() {
    setState('loading');
    try {
      const result = await getBudgetAdvice(snapshot);
      setAdvice(result.advice);
      setSource(result.source);
      setState('shown');
    } catch {
      setState('error');
    }
  }

  if (state === 'idle') {
    return (
      <button onClick={ask} style={{
        width:'100%', display:'flex', alignItems:'center', gap:10, border:`1px dashed ${C.purple}55`,
        background:C.purple+'0a', borderRadius:12, padding:'12px 14px', marginBottom:12, cursor:'pointer'
      }}>
        <span style={{fontSize:18, animation:'gentleBob 2.2s ease-in-out infinite'}}>💭</span>
        <div style={{flex:1, textAlign:'left'}}>
          <p style={{margin:0, fontSize:12, fontWeight:700, color:C.purple, fontFamily:SANS}}>
            Spend it, save it, or hold off?
          </p>
          <p style={{margin:'1px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS}}>
            Get a quick read on what to do with what's available
          </p>
        </div>
      </button>
    );
  }

  if (state === 'loading') {
    return (
      <div style={{width:'100%', display:'flex', alignItems:'center', gap:10, border:`1px solid ${C.purple}33`,
        background:C.purple+'0a', borderRadius:12, padding:'12px 14px', marginBottom:12}}>
        <Spinner size={16}/>
        <p style={{margin:0, fontSize:12, color:C.inkSoft, fontFamily:SANS}}>Thinking it through...</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={{width:'100%', border:`1px solid ${C.red}33`, background:C.redLight, borderRadius:12,
        padding:'12px 14px', marginBottom:12}}>
        <p style={{margin:0, fontSize:12, color:'#9b2c2c', fontFamily:SANS}}>
          Couldn't get advice right now.{' '}
          <button onClick={ask} style={{border:'none', background:'none', padding:0, color:C.red,
            fontWeight:700, cursor:'pointer', fontFamily:SANS, fontSize:12, textDecoration:'underline'}}>
            Try again
          </button>
        </p>
      </div>
    );
  }

  return (
    <div style={{
      width:'100%', border:`1px solid ${C.purple}44`, background:C.purple+'0d', borderRadius:14,
      padding:'14px 16px', marginBottom:12, animation:'popIn 0.35s cubic-bezier(0.34,1.56,0.64,1)'
    }}>
      <div style={{display:'flex', alignItems:'flex-start', gap:10}}>
        <span style={{fontSize:18, flexShrink:0}}>💭</span>
        <div style={{flex:1}}>
          <p style={{margin:0, fontSize:13, color:C.ink, fontFamily:SANS, lineHeight:1.5}}>
            {advice}
          </p>
          <div style={{display:'flex', alignItems:'center', gap:10, marginTop:8}}>
            <button onClick={ask} style={{border:'none', background:'none', padding:0, color:C.purple,
              fontWeight:700, cursor:'pointer', fontFamily:SANS, fontSize:11}}>
              Ask again
            </button>
            <button onClick={()=>setState('idle')} style={{border:'none', background:'none', padding:0, color:C.inkSoft,
              cursor:'pointer', fontFamily:SANS, fontSize:11}}>
              Dismiss
            </button>
            {source === 'rules' && (
              <span style={{fontSize:10, color:C.inkSoft, fontFamily:SANS, marginLeft:'auto'}}>
                (offline estimate)
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PredictedIncomeEditor({expectedIncome, setExpectedIncome, year, month, showToast, onAddTxn, profile, C, SERIF, SANS}) {
  const [editingId, setEditingId] = useState(null); // id of entry being edited, or 'new'
  const [fDate, setFDate] = useState(defaultDateForMonth(year, month));
  const [fAmount, setFAmount] = useState('');
  const [fSource, setFSource] = useState('');
  const [fAccount, setFAccount] = useState('');

  const [confirmingId, setConfirmingId] = useState(null); // entry being marked received
  const [cAmount, setCAmount] = useState('');
  const [cDate, setCDate] = useState(today());
  const [confirming, setConfirming] = useState(false);

  const monthEntries = (expectedIncome || []).filter(inc => {
    const d = parseLocalDate(inc.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const otherMonthsCount = (expectedIncome || []).length - monthEntries.length;

  function startNew() {
    setEditingId('new');
    setFDate(defaultDateForMonth(year, month)); setFAmount(''); setFSource(''); setFAccount('');
  }
  function startEdit(entry) {
    setEditingId(entry.id);
    setFDate(entry.date || defaultDateForMonth(year, month));
    setFAmount(entry.amount != null ? String(entry.amount) : '');
    setFSource(entry.description || '');
    setFAccount(entry.account || '');
  }
  function cancel() { setEditingId(null); }

  function startConfirm(entry) {
    setConfirmingId(entry.id);
    setCAmount(entry.amount != null ? String(entry.amount) : '');
    setCDate(today());
  }
  function cancelConfirm() { setConfirmingId(null); }

  async function confirmReceived(entry) {
    const amt = parseFloat(cAmount);
    if (isNaN(amt) || amt <= 0) { showToast('Enter the amount that actually arrived'); return; }
    setConfirming(true);
    try {
      await onAddTxn({
        cat: 'income', amount: amt, date: cDate,
        note: entry.description || 'Income', merchant: entry.description || '',
        who: profile?.name || 'unknown', person: firstName(profile?.name) || 'jordan',
      });
      const updated = (expectedIncome || []).filter(e => e.id !== entry.id);
      setExpectedIncome(updated);
      localStorage.setItem(EXPECTED_INCOME_KEY, JSON.stringify(updated));
      showToast(`Confirmed ${fmt(amt)} received — added to Actual Income`);
      setConfirmingId(null);
    } catch {
      showToast('Could not confirm that income — try again');
    } finally {
      setConfirming(false);
    }
  }

  function save() {
    const amt = parseFloat(fAmount);
    if (!fDate || isNaN(amt) || amt <= 0) { showToast('Enter a date and amount'); return; }
    const entry = {
      id: editingId === 'new' ? ('income-' + Date.now()) : editingId,
      date: fDate,
      amount: amt,
      description: fSource.trim(),
      account: fAccount.trim(),
      person: 'both',
    };
    const list = expectedIncome || [];
    const updated = editingId === 'new'
      ? [...list, entry]
      : list.map(e => e.id === editingId ? {...e, ...entry} : e);
    updated.sort((a,b)=>new Date(a.date)-new Date(b.date));
    setExpectedIncome(updated);
    localStorage.setItem(EXPECTED_INCOME_KEY, JSON.stringify(updated));
    showToast(editingId === 'new' ? 'Income entry added' : 'Income entry updated');
    setEditingId(null);
  }

  function remove(id) {
    const updated = (expectedIncome || []).filter(e => e.id !== id);
    setExpectedIncome(updated);
    localStorage.setItem(EXPECTED_INCOME_KEY, JSON.stringify(updated));
    showToast('Income entry deleted');
  }

  const sum = monthEntries.reduce((a,i)=>a+(i.amount||0),0);
  const inputStyle = {
    width:'100%', padding:'8px 10px', border:`1px solid ${C.sandDark}`, borderRadius:8,
    background:C.white, color:C.ink, fontFamily:SANS, fontSize:13, outline:'none', boxSizing:'border-box'
  };

  return (
    <Card style={{padding:'14px 16px', marginTop:8, marginBottom:12, background:C.blue+'08', border:`1px solid ${C.blue}22`}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10}}>
        <p style={{margin:0, fontSize:12, fontWeight:600, color:C.ink, fontFamily:SANS}}>
          Predicted income sources — this month
        </p>
        <p style={{margin:0, fontFamily:SERIF, fontSize:15, fontWeight:600, color:C.blue}}>
          {fmt(sum)}
        </p>
      </div>

      {monthEntries.length > 0 && (
        <div style={{marginBottom:10}}>
          {monthEntries.map(inc => (
            <div key={inc.id}>
              <div style={{
                display:'flex', alignItems:'center', gap:8, padding:'8px 0',
                borderBottom: confirmingId===inc.id ? 'none' : `1px solid ${C.blue}18`, fontSize:12}}>
                <div style={{flex:1, minWidth:0}}>
                  <p style={{margin:0, fontWeight:600, color:C.ink, fontFamily:SANS,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                    {inc.description || 'Income'}
                  </p>
                  <p style={{margin:0, fontSize:10, color:C.inkSoft, fontFamily:SANS}}>
                    {parseLocalDate(inc.date).toLocaleDateString('en-CA')}
                    {inc.account && ` • ${inc.account}`}
                  </p>
                </div>
                <p style={{margin:0, fontFamily:SERIF, fontSize:14, fontWeight:600, color:C.green, whiteSpace:'nowrap'}}>
                  +{fmt(inc.amount)}
                </p>
                <button onClick={()=>{setEditingId(null); startConfirm(inc);}}
                  title="Confirm received — arrived today"
                  style={{padding:'5px 8px', border:'none',
                  background:C.green+'20', color:C.green, borderRadius:6, cursor:'pointer', fontSize:11}}>
                  ✓
                </button>
                <button onClick={()=>startEdit(inc)} style={{padding:'5px 8px', border:'none',
                  background:C.sand, color:C.ink, borderRadius:6, cursor:'pointer', fontSize:11}}>
                  ✏️
                </button>
                <button onClick={()=>remove(inc.id)} style={{padding:'5px 8px', border:'none',
                  background:C.red+'20', color:C.red, borderRadius:6, cursor:'pointer', fontSize:11}}>
                  🗑️
                </button>
              </div>

              {confirmingId === inc.id && (
                <div style={{background:C.green+'0d', border:`1px solid ${C.green}33`, borderRadius:10,
                  padding:10, marginBottom:8}}>
                  <p style={{margin:'0 0 8px', fontSize:11, color:C.ink, fontFamily:SANS, fontWeight:600}}>
                    Confirm {inc.description || 'this income'} arrived
                  </p>
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8}}>
                    <div>
                      <label style={{fontSize:10, color:C.inkSoft, fontFamily:SANS, display:'block', marginBottom:2}}>
                        Amount received
                      </label>
                      <input type="number" value={cAmount} onChange={e=>setCAmount(e.target.value)} style={inputStyle}/>
                    </div>
                    <div>
                      <label style={{fontSize:10, color:C.inkSoft, fontFamily:SANS, display:'block', marginBottom:2}}>
                        Date arrived
                      </label>
                      <input type="date" value={cDate} onChange={e=>setCDate(e.target.value)} style={inputStyle}/>
                    </div>
                  </div>
                  <div style={{display:'flex', gap:8}}>
                    <button onClick={cancelConfirm} style={{flex:1, border:`1px solid ${C.sandDark}`, background:'white',
                      color:C.ink, padding:'8px', borderRadius:8, fontWeight:600, fontSize:12, fontFamily:SANS, cursor:'pointer'}}>
                      Cancel
                    </button>
                    <button onClick={()=>confirmReceived(inc)} disabled={confirming} style={{flex:1, border:'none', background:C.green,
                      color:'white', padding:'8px', borderRadius:8, fontWeight:600, fontSize:12, fontFamily:SANS,
                      cursor:confirming?'default':'pointer', opacity:confirming?0.6:1}}>
                      {confirming ? 'Confirming...' : '✓ Confirm received'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editingId ? (
        <div style={{background:C.white, borderRadius:10, padding:12}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8}}>
            <div>
              <label style={{fontSize:10, color:C.inkSoft, fontFamily:SANS, display:'block', marginBottom:2}}>
                Expected date
              </label>
              <input type="date" value={fDate} onChange={e=>setFDate(e.target.value)} style={inputStyle}/>
            </div>
            <div>
              <label style={{fontSize:10, color:C.inkSoft, fontFamily:SANS, display:'block', marginBottom:2}}>
                Expected amount
              </label>
              <input type="number" placeholder="0.00" value={fAmount} onChange={e=>setFAmount(e.target.value)} style={inputStyle}/>
            </div>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
            <div>
              <label style={{fontSize:10, color:C.inkSoft, fontFamily:SANS, display:'block', marginBottom:2}}>
                Source of income
              </label>
              <input type="text" placeholder="e.g. NORR paycheck" value={fSource} onChange={e=>setFSource(e.target.value)} style={inputStyle}/>
            </div>
            <div>
              <label style={{fontSize:10, color:C.inkSoft, fontFamily:SANS, display:'block', marginBottom:2}}>
                Deposit account
              </label>
              <input type="text" placeholder="e.g. Joint chequing" value={fAccount} onChange={e=>setFAccount(e.target.value)} style={inputStyle}/>
            </div>
          </div>
          <div style={{display:'flex', gap:8}}>
            <button onClick={cancel} style={{flex:1, border:`1px solid ${C.sandDark}`, background:'white',
              color:C.ink, padding:'8px', borderRadius:8, fontWeight:600, fontSize:12, fontFamily:SANS, cursor:'pointer'}}>
              Cancel
            </button>
            <button onClick={save} style={{flex:1, border:'none', background:C.blue,
              color:'white', padding:'8px', borderRadius:8, fontWeight:600, fontSize:12, fontFamily:SANS, cursor:'pointer'}}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <button onClick={startNew} style={{
          width:'100%', padding:'10px', border:`1px dashed ${C.blue}55`, borderRadius:8,
          background:'none', color:C.blue, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:SANS}}>
          + Add expected income
        </button>
      )}

      {otherMonthsCount > 0 && (
        <p style={{margin:'10px 0 0', fontSize:10, color:C.inkSoft, fontFamily:SANS, textAlign:'center'}}>
          {otherMonthsCount} more entr{otherMonthsCount===1?'y':'ies'} in other months
        </p>
      )}
    </Card>
  );
}

// ─── GOAL ROW (inline-editable, used inside the accordion) ───────────────────
function GoalRow({goal, accent, onUpdate, onDeposit}) {
  const [label, setLabel] = useState(goal.label);
  const [description, setDescription] = useState(goal.description || '');
  const [monthly, setMonthly] = useState(goal.monthlyContribution ? String(goal.monthlyContribution) : '');
  const [target, setTarget] = useState(goal.target ? String(goal.target) : '');

  // Keep in sync if the goal changes from elsewhere (e.g. a deposit changes currentBalance,
  // or another field is edited and the parent re-renders with fresh data).
  useEffect(() => { setLabel(goal.label); }, [goal.label]);
  useEffect(() => { setDescription(goal.description || ''); }, [goal.description]);
  useEffect(() => { setMonthly(goal.monthlyContribution ? String(goal.monthlyContribution) : ''); }, [goal.monthlyContribution]);
  useEffect(() => { setTarget(goal.target ? String(goal.target) : ''); }, [goal.target]);

  const currentBalance = goal.currentBalance || 0;
  const goalMonthly = goal.monthlyContribution || 0;
  const autoTarget = goalMonthly * 12;
  const effectiveTarget = goal.target || autoTarget;
  const progress = effectiveTarget > 0 ? (currentBalance / effectiveTarget) * 100 : 0;
  const isComplete = currentBalance >= effectiveTarget && effectiveTarget > 0;
  const barColor = progress >= 100 ? C.green : accent;

  const fieldStyle = {
    width:'100%', padding:'8px 9px', border:`1px solid ${C.sandDark}`, borderRadius:8,
    background:C.white, color:C.ink, fontFamily:SERIF, fontSize:13, outline:'none', boxSizing:'border-box'
  };

  return (
    <div style={{
      margin: '12px 0 0', padding: '14px', borderRadius: 12,
      background: isComplete ? C.green+'0d' : C.sand,
      border: `1px solid ${isComplete ? C.green+'33' : 'transparent'}`
    }}>
      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
        <span style={{width:6, height:6, borderRadius:99, background:accent, flexShrink:0}}/>
        <input value={label} onChange={e=>setLabel(e.target.value)}
          onBlur={()=>{ if(label.trim() && label.trim()!==goal.label) onUpdate('label', label.trim()); else setLabel(goal.label); }}
          style={{flex:1, fontSize:14, fontWeight:700, color:C.ink, fontFamily:SANS,
            border:'none', borderBottom:'1px solid transparent', background:'none',
            padding:'2px 0 4px', outline:'none'}}
          onFocus={e=>{e.target.style.borderBottomColor=C.sandDark;}}
          onBlurCapture={e=>{e.target.style.borderBottomColor='transparent';}}/>
        {isComplete && <span style={{fontSize:15}}>✓</span>}
      </div>

      <input value={description} onChange={e=>setDescription(e.target.value)}
        onBlur={()=>{ if(description.trim()!==(goal.description||'')) onUpdate('description', description.trim()); }}
        placeholder="What's this goal for? (optional)"
        style={{width:'100%', fontSize:12, color:C.inkSoft, fontFamily:SANS, fontStyle:'italic',
          border:'none', background:'none', padding:'0 0 12px', outline:'none', boxSizing:'border-box'}}/>

      <div style={{display:'flex', alignItems:'baseline', gap:5, marginBottom:6}}>
        <p style={{margin:0, fontFamily:SERIF, fontSize:20, fontWeight:600, color:barColor}}>
          ${currentBalance.toFixed(0)}
        </p>
        {effectiveTarget > 0 && (
          <p style={{margin:0, fontSize:12, color:C.inkSoft, fontFamily:SANS}}>
            of ${effectiveTarget.toFixed(0)}
          </p>
        )}
      </div>

      {effectiveTarget > 0 && (
        <div style={{width:'100%', height:7, background:C.white, borderRadius:4, overflow:'hidden', marginBottom:12,
          boxShadow:'inset 0 0 0 1px rgba(0,0,0,0.04)'}}>
          <div style={{width:`${Math.min(progress,100)}%`, height:'100%',
            background: barColor, transition:'width 0.3s ease'}}/>
        </div>
      )}

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12}}>
        <div>
          <label style={{fontSize:10, color:C.inkSoft, fontFamily:SANS, display:'block', marginBottom:3}}>
            Monthly contribution
          </label>
          <div style={{position:'relative'}}>
            <span style={{position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', fontSize:13, color:C.inkSoft, fontFamily:SERIF}}>$</span>
            <input type="number" value={monthly} onChange={e=>setMonthly(e.target.value)}
              onBlur={()=>{ const v=parseFloat(monthly)||0; if(v!==goalMonthly) onUpdate('monthlyContribution', v); }}
              placeholder="0" style={{...fieldStyle, paddingLeft:18}}/>
          </div>
        </div>
        <div>
          <label style={{fontSize:10, color:C.inkSoft, fontFamily:SANS, display:'block', marginBottom:3}}>
            Target {autoTarget > 0 && !goal.target ? `(auto: $${autoTarget.toFixed(0)})` : '(optional)'}
          </label>
          <div style={{position:'relative'}}>
            <span style={{position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', fontSize:13, color:C.inkSoft, fontFamily:SERIF}}>$</span>
            <input type="number" value={target} onChange={e=>setTarget(e.target.value)}
              onBlur={()=>{ const v=parseFloat(target)||0; if(v!==(goal.target||0)) onUpdate('target', v); }}
              placeholder="auto" style={{...fieldStyle, paddingLeft:18}}/>
          </div>
        </div>
      </div>

      <button onClick={onDeposit} style={{
        width:'100%', padding:'9px 12px', border:'none', background:accent+'18', color:accent,
        borderRadius:9, cursor:'pointer', fontSize:12, fontWeight:700, fontFamily:SANS, transition:'all 0.12s'
      }}
        onMouseEnter={e=>{e.target.style.background=accent+'28';}}
        onMouseLeave={e=>{e.target.style.background=accent+'18';}}>
        + Add Deposit
      </button>
    </div>
  );
}

export function HomeTab({txns,bankImports,ccTarget,allCats,catTargets,view,setView,
                  year,month,history,billRules,billPayments,allBillPayments,expectedIncome,setExpectedIncome,onAddTxn,
                  billActiveKeys,billConfiguredMonths,
                  showToast,profile,partnerName,goals,onSaveGoals,depositingGoalId,setDepositingGoalId,
                  onEditTxnSave,onDeleteTxn,setTab}) {
  const myName = profile?.name || 'You';
  const [showPredictedIncomePanel, setShowPredictedIncomePanel] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState(null); // 'jordan' | 'mariel' | 'couple' | null
  const [showAddActualIncome, setShowAddActualIncome] = useState(false);
  const [aiAmount, setAiAmount] = useState('');
  const [aiDate, setAiDate] = useState(() => today());
  const [aiSource, setAiSource] = useState('');
  const [aiWho, setAiWho] = useState('mine'); // 'mine' | 'partner' — whose income this is
  const [savingActualIncome, setSavingActualIncome] = useState(false);
  const [showIncomeDetail, setShowIncomeDetail] = useState(false);
  const [editingIncomeTxn, setEditingIncomeTxn] = useState(null);
  const me=firstName(profile?.name);
  const everything=[...txns,...bankImports];

  async function saveActualIncome() {
    const amt = parseFloat(aiAmount);
    if (isNaN(amt) || amt <= 0) { showToast('Enter an amount'); return; }
    setSavingActualIncome(true);
    try {
      const attributedTo = resolveWho(aiWho, profile?.name, partnerName, 'mine');
      await onAddTxn({
        cat: 'income', amount: amt, date: aiDate,
        note: aiSource.trim() || 'Income', merchant: aiSource.trim(),
        who: attributedTo, person: firstName(attributedTo) || 'jordan',
      });
      showToast(`Added ${fmt(amt)} to Actual Income`);
      setShowAddActualIncome(false);
    } catch {
      showToast('Could not add that income — try again');
    } finally {
      setSavingActualIncome(false);
    }
  }
  const everythingThisMonth=everything;   // both people, before the view filter

  // Recurring charges are worked out from your own history rather than kept in
  // a hardcoded list. Uses the exact same buildSchedule the Bills tab uses, so
  // the two tabs never disagree about what's due, paid, or overdue.
  const recurring = applyBillRules(detectRecurring(history || []), billRules || [], billActiveKeys || new Map(), billConfiguredMonths || new Set(), year, month)
    .filter(b => b.confidence === 'high');
  const sched = buildSchedule(recurring, everythingThisMonth, year, month, new Date(), billPayments || []);
  const dueTotal = sched.outstandingTotal;
  const dueBills = sched.outstanding;

  // Bills from a past month that were never paid don't just disappear — they're
  // still owed, so they count toward what's still to pay too.
  const carriedOver = getCarriedOverBills(recurring, history || [], allBillPayments || [], year, month);
  const carriedOverTotal = carriedOver.reduce((a,b)=>a+b.amount,0);

  // Same logic for the card payment: only pledge it if it hasn't gone out yet
  // Which numbers show depends on the view: just yours, just your partner's,
  // or the whole household together.
  const allTx = filterByView(everything, view, me, firstName(partnerName));

  const excludedIds=new Set([...ALWAYS_EXCLUDED_CATS, ...allCats.filter(c=>c.excluded).map(c=>c.id)]);

  // Income is no longer typed in — it is read off the statements
  const incomeRows=allTx.filter(t=>(t.category||t.cat)==='income');
  const totalIncome=incomeRows.reduce((a,t)=>a+t.amount,0);

  // Who contributed what, derived rather than declared
  const incomeByPerson={};
  incomeRows.forEach(t=>{
    const k=firstName(t.who)||'unattributed';
    incomeByPerson[k]=(incomeByPerson[k]||0)+t.amount;
  });

  const txByCat={};
  allTx.forEach(t=>{const k=t.category||t.cat;if(k&&k!=='_skip')txByCat[k]=(txByCat[k]||0)+t.amount;});
  // Money moved between accounts is tracked but never counted as spending
  const totalSpent=Object.entries(txByCat)
    .filter(([k])=>!excludedIds.has(k))
    .reduce((a,[,v])=>a+v,0);

  // Split that same total into two honest buckets: money that went to a
  // recognized bill's category, and everything else (discretionary). The two
  // always add up to totalSpent exactly — this is a relabeling of the same
  // transactions, not a second, separate pool of money.
  const billCategoryIds = new Set(recurring.map(b => b.category));
  let billsPaidThisMonth = 0, discretionarySpent = 0;
  Object.entries(txByCat).forEach(([catId, amt]) => {
    if (excludedIds.has(catId)) return;
    if (billCategoryIds.has(catId)) billsPaidThisMonth += amt;
    else discretionarySpent += amt;
  });

  // Predicted income comes from what you've entered as expected for THIS month,
  // not from transactions, and not from entries you predicted for other months
  const predictedIncomeTotal = (expectedIncome||[])
    .filter(i => { const d = parseLocalDate(i.date); return d.getFullYear()===year && d.getMonth()===month; })
    .reduce((a,i)=>a+(i.amount||0),0);

  // AVAILABLE MONEY = Actual Income − Money Spent This Month − Bills Paid This
  // Month. The two subtracted terms are the exact same totalSpent split into
  // two buckets above, so this equals totalIncome − totalSpent — no double
  // counting, just presented as the two lines you actually asked to see.
  const availableMoney = totalIncome - discretionarySpent - billsPaidThisMonth;

  // A lightweight budget figure just for the advice snapshot below — the
  // editable override with its own UI lives on the Spending tab now.
  const adviceCategoryBudget = allCats
    .filter(c=>!excludedIds.has(c.id))
    .reduce((a,c)=>a+(catTargets[c.id] ?? c.target ?? 0), 0);
  const goalsMonthlyTotal = (goals||[]).reduce((a,g)=>a+(g.monthlyContribution||0),0);
  const adviceSnapshot = {
    availableMoney, actualIncome: totalIncome, predictedIncomeTotal,
    spentSoFar: totalSpent, billsNotChargedYet: dueTotal + carriedOverTotal,
    budgetedForSpending: adviceCategoryBudget, goalsMonthlyTotal,
  };

  // Every edit here writes straight to state + localStorage + Supabase in one
  // shot — no separate "batch edit then save" step, so nothing can be lost
  // in between, and it's backed up server-side so it survives a cleared
  // browser or a different device.
  function updateGoalField(goalId, field, value) {
    const updated = goals.map(g => g.id === goalId ? {...g, [field]: value} : g);
    onSaveGoals(updated);
    showToast('Goal updated');
  }

  return (
    <div style={{padding:'16px 16px 0'}}>
      {/* Dashboard — the critical numbers, front and center */}
      <ViewToggle view={view} setView={setView} myLabel={me} partnerLabel={firstName(partnerName)}/>

      {/* Hero — recolors with the view, so whose numbers you're looking at is obvious at a glance */}
      <Card style={{background:VIEW_COLOR[view] || C.green,padding:'20px 20px'}}>
        <p style={{fontSize:11,color:'rgba(255,255,255,0.7)',textTransform:'uppercase',
          letterSpacing:'0.1em',margin:'0 0 4px',fontFamily:SANS}}>
          Available Money · {view==='mine' ? capitalize(myName) : view==='partner' ? capitalize(partnerName) : 'Combined'}
        </p>
        <p style={{fontFamily:SERIF,fontSize:44,fontWeight:600,color:'#fff',margin:'0 0 16px',
          letterSpacing:'-0.02em',lineHeight:1}}>
          {availableMoney>=0?fmt(availableMoney):'–'+fmt(Math.abs(availableMoney))}
        </p>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
          <div>
            <p style={{margin:0,fontSize:11,color:'rgba(255,255,255,0.65)',
              textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:SANS}}>Actual Income</p>
            <p style={{margin:0,fontFamily:SERIF,fontSize:18,fontWeight:600,
              color:'rgba(255,255,255,0.95)'}}>{fmt(totalIncome)}</p>
          </div>

          <div>
            <p style={{margin:0,fontSize:11,color:'rgba(255,255,255,0.65)',
              textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:SANS}}>Spent This Month</p>
            <p style={{margin:0,fontFamily:SERIF,fontSize:18,fontWeight:600,
              color:'rgba(255,255,255,0.95)'}}>{fmt(discretionarySpent)}</p>
          </div>

          <div>
            <p style={{margin:0,fontSize:11,color:'rgba(255,255,255,0.65)',
              textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:SANS}}>Bills Paid This Month</p>
            <p style={{margin:0,fontFamily:SERIF,fontSize:18,fontWeight:600,
              color:'rgba(255,255,255,0.95)'}}>{fmt(billsPaidThisMonth)}</p>
          </div>
        </div>

        {(dueTotal + carriedOverTotal) > 0 && (
          <p style={{margin:'14px 0 0', fontSize:11, color:'rgba(255,255,255,0.75)',
            fontFamily:SANS, borderTop:'1px solid rgba(255,255,255,0.2)', paddingTop:10}}>
            {fmt(dueTotal + carriedOverTotal)} more in bills not charged yet — see{' '}
            <button onClick={()=>setTab?.('bills')} style={{border:'none', background:'none', padding:0,
              color:'#fff', fontWeight:700, cursor:'pointer', fontFamily:SANS, fontSize:11, textDecoration:'underline'}}>
              Bills
            </button>. Not subtracted above — nothing's left the account yet.
          </p>
        )}
      </Card>

      <AdviceBubble snapshot={adviceSnapshot}/>

      {/* Actual income this month — same visual weight as Predicted Income in the
          hero above, so the two are easy to compare at a glance */}
      <Card style={{padding:'16px 16px', marginTop:12, marginBottom:12,
        background:C.green+'0d', border:`1px solid ${C.green}33`}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: Object.keys(incomeByPerson).length ? 12 : 0}}>
          <div>
            <p style={{margin:0, fontSize:11, color:C.green, fontFamily:SANS, textTransform:'uppercase', fontWeight:700, letterSpacing:'0.08em'}}>
              💰 Actual Income This Month
            </p>
            <p style={{margin:'2px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS}}>
              What's actually landed, read off your statements
            </p>
          </div>
          <p style={{margin:0, fontFamily:SERIF, fontSize:26, fontWeight:600, color:C.green, whiteSpace:'nowrap'}}>
            {fmt(totalIncome)}
          </p>
        </div>
        {Object.keys(incomeByPerson).length === 0 ? (
          <p style={{margin:0, fontSize:12, color:C.inkSoft, fontFamily:SANS, fontStyle:'italic'}}>
            No deposits recorded yet this month — income is read straight off your statements.
          </p>
        ) : (
          <div style={{paddingTop:10, borderTop:`1px solid ${C.green}22`, marginBottom:12}}>
            <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:10}}>
              {Object.entries(incomeByPerson).sort((a,b)=>b[1]-a[1]).map(([person,amt])=>(
                <div key={person} style={{display:'flex', alignItems:'center', gap:10}}>
                  <UserAvatar name={person} size={26}/>
                  <span style={{flex:1, fontSize:13, color:C.ink, fontFamily:SANS, textTransform:'capitalize', fontWeight:600}}>{capitalize(person)}</span>
                  <span style={{fontFamily:SERIF, fontSize:15, fontWeight:600, color:C.ink}}>{fmt(amt)}</span>
                </div>
              ))}
            </div>

            <button onClick={()=>setShowIncomeDetail(v=>!v)} style={{
              display:'flex', alignItems:'center', gap:6, width:'100%', border:'none', background:'none',
              padding:'6px 0', cursor:'pointer', fontFamily:SANS}}>
              <span style={{flex:1, textAlign:'left', fontSize:12, color:C.green, fontWeight:600}}>
                {showIncomeDetail ? 'Hide deposits' : `Show every deposit (${incomeRows.length})`}
              </span>
              <ChevronRight size={13} color={C.green}
                style={{transform:showIncomeDetail?'rotate(90deg)':'none', transition:'transform 0.15s'}}/>
            </button>

            {showIncomeDetail && (
              <div style={{marginTop:6}}>
                {incomeRows.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).map(tx=>(
                  <div key={tx.id} style={{display:'flex', alignItems:'center', gap:8,
                    padding:'8px 0', borderTop:`1px solid ${C.green}18`}}>
                    <div style={{flex:1, minWidth:0}}>
                      <p style={{margin:0, fontSize:12, color:C.ink, fontFamily:SANS, fontWeight:600,
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                        {tx.note || tx.description || 'Deposit'}
                      </p>
                      <p style={{margin:0, fontSize:10, color:C.inkSoft, fontFamily:SANS}}>
                        {tx.date}{tx.source?' · '+instLabel(tx.source):''}{tx.who?' · '+tx.who:''}
                      </p>
                    </div>
                    <p style={{margin:0, fontFamily:SERIF, fontSize:13, fontWeight:600, color:C.green, whiteSpace:'nowrap'}}>
                      +{fmt(tx.amount)}
                    </p>
                    <button onClick={()=>setEditingIncomeTxn(tx)} title="Edit this deposit"
                      style={{padding:'5px 7px', border:'none', background:C.sand, color:C.ink,
                        borderRadius:6, cursor:'pointer', fontSize:11, flexShrink:0}}>
                      ✏️
                    </button>
                    <button onClick={()=>onDeleteTxn?.(tx)} title="Delete — this isn't real income"
                      style={{padding:'5px 7px', border:'none', background:C.red+'20', color:C.red,
                        borderRadius:6, cursor:'pointer', fontSize:11, flexShrink:0}}>
                      🗑️
                    </button>
                  </div>
                ))}
                <p style={{margin:'8px 0 0', fontSize:10, color:C.inkSoft, fontFamily:SANS, lineHeight:1.5}}>
                  If a deposit shouldn't be counted as income — a duplicate, a transfer between
                  your own accounts, a refund — edit its category or delete it here.
                </p>
              </div>
            )}
          </div>
        )}

        {showAddActualIncome ? (
          <div style={{background:C.white, borderRadius:10, padding:12, marginTop: Object.keys(incomeByPerson).length ? 0 : 12}}>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8}}>
              <div>
                <label style={{fontSize:10, color:C.inkSoft, fontFamily:SANS, display:'block', marginBottom:2}}>
                  Amount received
                </label>
                <input type="number" value={aiAmount} onChange={e=>setAiAmount(e.target.value)}
                  placeholder="0.00"
                  style={{width:'100%', padding:'8px 10px', border:`1px solid ${C.sandDark}`, borderRadius:8,
                    background:C.sand, color:C.ink, fontFamily:SANS, fontSize:13, outline:'none', boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{fontSize:10, color:C.inkSoft, fontFamily:SANS, display:'block', marginBottom:2}}>
                  Date received
                </label>
                <input type="date" value={aiDate} onChange={e=>setAiDate(e.target.value)}
                  style={{width:'100%', padding:'8px 10px', border:`1px solid ${C.sandDark}`, borderRadius:8,
                    background:C.sand, color:C.ink, fontFamily:SANS, fontSize:13, outline:'none', boxSizing:'border-box'}}/>
              </div>
            </div>
            <div style={{marginBottom:10}}>
              <label style={{fontSize:10, color:C.inkSoft, fontFamily:SANS, display:'block', marginBottom:2}}>
                Source (optional)
              </label>
              <input type="text" value={aiSource} onChange={e=>setAiSource(e.target.value)}
                placeholder="e.g. NORR paycheck"
                style={{width:'100%', padding:'8px 10px', border:`1px solid ${C.sandDark}`, borderRadius:8,
                  background:C.sand, color:C.ink, fontFamily:SANS, fontSize:13, outline:'none', boxSizing:'border-box'}}/>
            </div>
            <div style={{marginBottom:10}}>
              <label style={{fontSize:10, color:C.inkSoft, fontFamily:SANS, display:'block', marginBottom:4}}>
                Whose income is this?
              </label>
              <div style={{display:'flex', gap:8}}>
                <button onClick={()=>setAiWho('mine')} style={{
                  flex:1, padding:'8px', border:`1.5px solid ${aiWho==='mine'?C.green:C.sandDark}`,
                  borderRadius:8, background:aiWho==='mine'?C.green+'15':'white',
                  color:aiWho==='mine'?C.green:C.ink, fontSize:12, fontWeight:600, fontFamily:SANS, cursor:'pointer'}}>
                  {capitalize(me)}
                </button>
                <button onClick={()=>setAiWho('partner')} style={{
                  flex:1, padding:'8px', border:`1.5px solid ${aiWho==='partner'?C.green:C.sandDark}`,
                  borderRadius:8, background:aiWho==='partner'?C.green+'15':'white',
                  color:aiWho==='partner'?C.green:C.ink, fontSize:12, fontWeight:600, fontFamily:SANS, cursor:'pointer'}}>
                  {capitalize(firstName(partnerName)) || 'Partner'}
                </button>
              </div>
            </div>
            <div style={{display:'flex', gap:8}}>
              <button onClick={()=>setShowAddActualIncome(false)} style={{flex:1, border:`1px solid ${C.sandDark}`, background:'white',
                color:C.ink, padding:'9px', borderRadius:8, fontWeight:600, fontSize:12, fontFamily:SANS, cursor:'pointer'}}>
                Cancel
              </button>
              <button onClick={saveActualIncome} disabled={savingActualIncome} style={{flex:1, border:'none', background:C.green,
                color:'white', padding:'9px', borderRadius:8, fontWeight:600, fontSize:12, fontFamily:SANS,
                cursor:savingActualIncome?'default':'pointer', opacity:savingActualIncome?0.6:1}}>
                {savingActualIncome ? 'Adding...' : 'Add income'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={()=>{setShowAddActualIncome(true); setAiAmount(''); setAiDate(today()); setAiSource(''); setAiWho('mine');}} style={{
            width:'100%', padding:'10px', border:`1px dashed ${C.green}55`, borderRadius:8,
            background:'none', color:C.green, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:SANS}}>
            + Add actual income manually
          </button>
        )}
      </Card>

      {/* Predicted income — planning ahead, separate from what's actually landed above */}
      <button onClick={()=>setShowPredictedIncomePanel(v=>!v)} style={{
        width:'100%', display:'flex', alignItems:'center', gap:10, border:`1px solid ${C.blue}33`,
        background:C.blue+'0a', borderRadius:12, padding:'12px 14px', marginBottom:12, cursor:'pointer'}}>
        <span style={{fontSize:16}}>📅</span>
        <div style={{flex:1, textAlign:'left'}}>
          <p style={{margin:0, fontSize:12, fontWeight:700, color:C.blue, fontFamily:SANS}}>
            Predicted income {predictedIncomeTotal>0 && `— ${fmt(predictedIncomeTotal)} expected`}
          </p>
          <p style={{margin:'1px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS}}>
            Plan ahead, then confirm it here once it lands
          </p>
        </div>
        <ChevronRight size={14} color={C.blue}
          style={{transform:showPredictedIncomePanel?'rotate(90deg)':'none', transition:'transform 0.15s'}}/>
      </button>

      {/* Predicted income editor — expands under the hero */}
      {showPredictedIncomePanel && (
        <PredictedIncomeEditor
          expectedIncome={expectedIncome}
          setExpectedIncome={setExpectedIncome}
          year={year} month={month}
          showToast={showToast}
          onAddTxn={onAddTxn} profile={profile}
          C={C} SERIF={SERIF} SANS={SANS}
        />
      )}

      <button onClick={()=>setTab?.('spending')} style={{
        width:'100%', display:'flex', alignItems:'center', gap:10, border:`1px solid ${C.sandDark}55`,
        background:C.sand, borderRadius:12, padding:'12px 14px', marginBottom:20, cursor:'pointer'}}>
        <span style={{fontSize:16}}>🛒</span>
        <div style={{flex:1, textAlign:'left'}}>
          <p style={{margin:0, fontSize:12, fontWeight:700, color:C.ink, fontFamily:SANS}}>
            Category-by-category budget
          </p>
          <p style={{margin:'1px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS}}>
            See what's budgeted and spent in each category, in Spending
          </p>
        </div>
        <ChevronRight size={14} color={C.inkSoft}/>
      </button>

      {/* Financial Goals — grouped per person, each a dropdown */}
      <h3 style={{margin: '0 0 12px', fontFamily: SERIF, fontSize: 20, fontWeight: 600, color: C.ink}}>
        🎯 Financial Goals
      </h3>

      {GOAL_GROUPS.map(({person}) => {
        const groupLabel = personGroupLabel(person, myName, partnerName);
        const groupGoals = goals.filter(g => g.person === person);
        if (groupGoals.length === 0) return null;
        const totalBalance = groupGoals.reduce((a,g)=>a+(g.currentBalance||0),0);
        const totalMonthly = groupGoals.reduce((a,g)=>a+(g.monthlyContribution||0),0);
        const totalTarget = groupGoals.reduce((a,g)=>a+(g.target || (g.monthlyContribution||0)*12),0);
        const groupProgress = totalTarget > 0 ? Math.min((totalBalance/totalTarget)*100, 100) : 0;
        const isOpen = expandedGroup === person;
        const accent = GOAL_GROUP_COLOR[person] || C.blue;
        const icon = person === 'couple' ? '💑' : '👤';

        return (
          <Card key={person} style={{marginBottom: 10, padding: 0, overflow: 'hidden',
            border: `1px solid ${isOpen ? accent+'55' : C.sandMid}`}}>
            <button onClick={()=>setExpandedGroup(isOpen ? null : person)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 16px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left'
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: accent+'18',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16
              }}>
                {icon}
              </div>
              <div style={{flex: 1, minWidth: 0}}>
                <p style={{margin: 0, fontSize: 14, fontWeight: 700, color: C.ink, fontFamily: SANS}}>
                  {groupLabel}
                </p>
                <p style={{margin: '2px 0 0', fontSize: 11, color: C.inkSoft, fontFamily: SANS}}>
                  {fmt(totalBalance)} saved · {fmt(totalMonthly)}/month
                </p>
                {totalTarget > 0 && (
                  <div style={{width: '100%', height: 4, background: C.sandDark+'33', borderRadius: 2,
                    overflow: 'hidden', marginTop: 6, maxWidth: 200}}>
                    <div style={{width: `${groupProgress}%`, height: '100%',
                      background: groupProgress >= 100 ? C.green : accent, transition: 'width 0.3s ease'}}/>
                  </div>
                )}
              </div>
              <ChevronRight size={16} color={C.inkSoft}
                style={{transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0}}/>
            </button>

            {isOpen && (
              <div style={{padding: '0 16px 14px', borderTop: `1px solid ${C.sandMid}`}}>
                {groupGoals.map(goal => (
                  <GoalRow
                    key={goal.id}
                    goal={goal}
                    accent={accent}
                    onUpdate={(field, value) => updateGoalField(goal.id, field, value)}
                    onDeposit={() => setDepositingGoalId(goal.id)}
                  />
                ))}
              </div>
            )}
          </Card>
        );
      })}

      {depositingGoalId && (
        <QuickGoalDepositModal
          goal={goals.find(g => g.id === depositingGoalId) || {}}
          onSave={async (amount, date) => {
            const updated = goals.map(g => 
              g.id === depositingGoalId 
                ? {
                    ...g,
                    currentBalance: (g.currentBalance || 0) + amount,
                    deposits: [...(g.deposits || []), {id: 'dep-' + Date.now(), date: date || today(), amount}]
                  }
                : g
            );
            await onSaveGoals(updated);
            showToast(`Added $${amount.toFixed(2)} to ${goals.find(g => g.id === depositingGoalId)?.label}`);
          }}
          onClose={() => setDepositingGoalId(null)}
          C={C}
          SERIF={SERIF}
          SANS={SANS}
        />
      )}

      {editingIncomeTxn && (
        <EditTransactionModal
          tx={editingIncomeTxn}
          allCats={allCats}
          onSave={async updates => { await onEditTxnSave?.(editingIncomeTxn, updates); }}
          onClose={() => setEditingIncomeTxn(null)}
        />
      )}
    </div>
  );
}


// ─── SPENDING TAB ─────────────────────────────────────────────────────────────
export function SpendingTab({txns,bankImports,allCats,catTargets,suggested,onAcceptSuggested,
                  onAddCat,onDeleteCat,profile,partnerName,onReviewOther,otherCount,
                  onChangeCategory,view,setView,
                  onDeleteRow,duplicateCount,onReviewDuplicates,setQuickAddCat,setTab,
                  setEditingCatTarget,showToast,onScanReceipt,onConfirmReceipt,onEditTxnSave,
                  predictedIncomeTotal}) {
  const [openCat, setOpenCat] = useState(null);   // which category is expanded
  const [busyId,  setBusyId]  = useState(null);   // row currently saving
  const [showAdd, setShowAdd] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [editingTxn, setEditingTxn] = useState(null); // the transaction being date/amount/category-edited
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetOverride, setBudgetOverride] = useState(() => {
    try {
      const v = localStorage.getItem(BUDGET_OVERRIDE_KEY);
      return v !== null ? parseFloat(v) : null;
    } catch { return null; }
  });
  const me=firstName(profile?.name);
  const everything=[...txns,...bankImports];

  // Which numbers show depends on the view: just yours, just your partner's,
  // or the whole household together.
  const allTx = filterByView(everything, view, me, firstName(partnerName));

  const excludedIds=new Set([...ALWAYS_EXCLUDED_CATS, ...allCats.filter(c=>c.excluded).map(c=>c.id)]);

  const txByCat={};
  allTx.forEach(t=>{const k=t.category||t.cat;if(k&&k!=='_skip')txByCat[k]=(txByCat[k]||0)+t.amount;});
  const totalSpent=Object.entries(txByCat)
    .filter(([k])=>!excludedIds.has(k))
    .reduce((a,[,v])=>a+v,0);

  // Spent in the last 7 days — same "is this week tight?" question Bills asks
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate()-7);
  const weekSpent = allTx
    .filter(t => !excludedIds.has(t.category||t.cat) && parseLocalDate(t.date) >= weekAgo)
    .reduce((a,t)=>a+t.amount,0);

  const categoryBudgetSum = allCats
    .filter(c=>!excludedIds.has(c.id))
    .reduce((a,c)=>a+(catTargets[c.id] ?? c.target ?? 0), 0);
  const budgetedForSpending = budgetOverride != null ? budgetOverride : categoryBudgetSum;
  const remainingToSpend = budgetedForSpending - totalSpent;

  // Same merchant, same day, both of you → you were out together
  const { shared:sharedMoments } = findSharedMoments(allTx);
  const together = summariseTogether(sharedMoments);

  // Every transaction belonging to one category, newest first
  const rowsFor=catId=>allTx
    .filter(t=>(t.category||t.cat)===catId)
    .sort((a,b)=>new Date(b.date)-new Date(a.date));

  async function reassign(tx,newCat){
    setBusyId(tx.id);
    await onChangeCategory(tx, newCat);
    setBusyId(null);
  }

  return (
    <div style={{padding:'16px 16px 0'}}>
      {/* Dashboard — mirrors the Bills tab so the two feel like one system */}
      <ViewToggle view={view} setView={setView} myLabel={me} partnerLabel={firstName(partnerName)}/>

      <Card style={{background:VIEW_COLOR[view] || C.green,padding:'20px 20px', marginBottom:12}}>
        <p style={{fontSize:11,color:'rgba(255,255,255,0.7)',textTransform:'uppercase',
          letterSpacing:'0.1em',margin:'0 0 4px',fontFamily:SANS}}>
          Still Available To Spend · {view==='mine' ? capitalize(me) : view==='partner' ? capitalize(firstName(partnerName)) : 'Combined'}
        </p>
        <p style={{fontFamily:SERIF,fontSize:40,fontWeight:600,color:'#fff',margin:'0 0 14px',
          letterSpacing:'-0.02em',lineHeight:1}}>
          {remainingToSpend>=0?fmt(remainingToSpend):'–'+fmt(Math.abs(remainingToSpend))}
        </p>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
          <div>
            <p style={{margin:0,fontSize:10,color:'rgba(255,255,255,0.65)',
              textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:SANS}}>This week</p>
            <p style={{margin:0,fontFamily:SERIF,fontSize:17,fontWeight:600,
              color:'rgba(255,255,255,0.95)'}}>{fmt(weekSpent)}</p>
          </div>
          <div>
            <p style={{margin:0,fontSize:10,color:'rgba(255,255,255,0.65)',
              textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:SANS}}>Spent so far</p>
            <p style={{margin:0,fontFamily:SERIF,fontSize:17,fontWeight:600,
              color:'rgba(255,255,255,0.95)'}}>{fmt(totalSpent)}</p>
          </div>
          <div>
            <p style={{margin:0,fontSize:10,color:'rgba(255,255,255,0.65)',
              textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:SANS}}>Budgeted</p>
            {editingBudget ? (
              <input
                type="number" autoFocus defaultValue={budgetedForSpending.toFixed(2)}
                onBlur={e=>{
                  const v=parseFloat(e.target.value);
                  if(!isNaN(v)){
                    setBudgetOverride(v);
                    localStorage.setItem(BUDGET_OVERRIDE_KEY, String(v));
                    showToast('Spending budget updated');
                  }
                  setEditingBudget(false);
                }}
                onKeyDown={e=>{if(e.key==='Enter')e.target.blur(); if(e.key==='Escape')setEditingBudget(false);}}
                style={{width:80,border:'none',borderRadius:6,padding:'2px 6px',
                  fontSize:16,fontWeight:600,color:C.ink,fontFamily:SERIF,background:'#fff'}}/>
            ) : (
              <button onClick={()=>setEditingBudget(true)} style={{border:'none',background:'none',
                padding:0,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
                <p style={{margin:0,fontFamily:SERIF,fontSize:17,fontWeight:600,
                  color:'rgba(255,255,255,0.95)'}}>{fmt(budgetedForSpending)}</p>
                <span style={{fontSize:10}}>✏️</span>
              </button>
            )}
          </div>
        </div>
        {budgetOverride != null && (
          <button onClick={()=>{
            setBudgetOverride(null);
            localStorage.removeItem(BUDGET_OVERRIDE_KEY);
            showToast('Reset to sum of category targets');
          }} style={{border:'none',background:'none',padding:0,marginTop:10,cursor:'pointer',
            fontSize:10,color:'rgba(255,255,255,0.65)',textDecoration:'underline',fontFamily:SANS}}>
            Reset budget to category totals ({fmt(categoryBudgetSum)})
          </button>
        )}
        {predictedIncomeTotal > 0 && budgetedForSpending > predictedIncomeTotal && (
          <p style={{margin:'12px 0 0', fontSize:11, color:'rgba(255,255,255,0.85)',
            fontFamily:SANS, borderTop:'1px solid rgba(255,255,255,0.2)', paddingTop:10, lineHeight:1.5}}>
            ⚠️ Budgeted ({fmt(budgetedForSpending)}) is more than the {fmt(predictedIncomeTotal)} predicted to
            come in this month — worth trimming a category, or checking more income is really on the way.
          </p>
        )}
      </Card>

      <button onClick={()=>setShowScan(true)} style={{
        width:'100%', border:'none', borderRadius:14, padding:'14px 16px', marginBottom:12,
        background:C.green, cursor:'pointer', display:'flex', alignItems:'center', gap:12,
        boxShadow:'0 2px 8px rgba(26,122,74,0.25)'
      }}>
        <div style={{width:36, height:36, borderRadius:10, background:'rgba(255,255,255,0.2)',
          display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
          <Camera size={18} color="#fff"/>
        </div>
        <div style={{flex:1, textAlign:'left'}}>
          <p style={{margin:0, fontSize:14, fontWeight:700, color:'#fff', fontFamily:SANS}}>
            Scan a receipt
          </p>
          <p style={{margin:'1px 0 0', fontSize:11, color:'rgba(255,255,255,0.8)', fontFamily:SANS}}>
            Snap a photo — Claude reads and categorises it for you
          </p>
        </div>
        <ChevronRight size={16} color="rgba(255,255,255,0.8)"/>
      </button>

      {/* Suggested targets - show inline with categories instead of big block */}
      {Object.keys(suggested||{}).length>0&&(
        <div style={{padding:'0 0 6px 0',marginBottom:8}}>
          <p style={{margin:'0 0 4px',fontSize:11,color:C.inkSoft,fontFamily:SANS,textTransform:'uppercase',
            letterSpacing:'0.08em'}}>💡 Suggested updates available • 
            <button onClick={onAcceptSuggested} style={{border:'none',background:'none',color:C.green,
              cursor:'pointer',fontWeight:600,fontSize:11,marginLeft:4}}>Apply all</button>
          </p>
        </div>
      )}

      {/* Duplicates found in what is already saved */}
      {duplicateCount > 0 && (
        <button onClick={onReviewDuplicates} style={{ width:'100%', border:`1.5px solid ${C.red}`,
          borderRadius:14, padding:'12px 16px', marginBottom:12, background:C.redLight,
          cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:C.red+'22',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <Trash2 size={17} color={C.red}/>
          </div>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, fontSize:13, fontWeight:700, color:C.red, fontFamily:SANS }}>
              {duplicateCount} duplicate{duplicateCount>1?'s':''} in this month
            </p>
            <p style={{ margin:'2px 0 0', fontSize:12, color:'#9b2c2c', fontFamily:SANS }}>
              The same purchase is recorded more than once, so your totals are too high.
            </p>
          </div>
          <ChevronRight size={18} color={C.red}/>
        </button>
      )}

      {/* Other category alert — shown when imported transactions need review */}
      {otherCount > 0 && (
        <button onClick={onReviewOther} style={{ width:'100%', border:`1.5px solid ${C.amber}`,
          borderRadius:14, padding:'12px 16px', marginBottom:12, background:'#fffbeb',
          cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:C.amber+'22',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <AlertCircle size={18} color={C.amber}/>
          </div>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, fontSize:13, fontWeight:700, color:C.amber, fontFamily:SANS }}>
              {otherCount} transaction{otherCount>1?'s':''} need{otherCount===1?'s':''} categorising
            </p>
            <p style={{ margin:'2px 0 0', fontSize:12, color:'#92400e', fontFamily:SANS }}>
              These are in "Other" and may be skewing your budget. Tap to review.
            </p>
          </div>
          <ChevronRight size={18} color={C.amber}/>
        </button>
      )}

      {/* Time spent together — same place, same day, both of you */}
      {together.count>0&&(
        <div style={{background:'#fdf2f8',border:'1px solid #f9a8d4',borderRadius:14,
          padding:'14px 16px',marginBottom:12}}>
          <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:together.list.length?9:0}}>
            <div style={{width:30,height:30,borderRadius:99,background:'#be185d',
              display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <Heart size={15} color="#fff" fill="#fff"/>
            </div>
            <div style={{flex:1}}>
              <p style={{margin:0,fontSize:14,fontWeight:700,color:'#be185d',fontFamily:SANS}}>
                {together.count} {together.count===1?'outing':'outings'} together
              </p>
              <p style={{margin:'2px 0 0',fontSize:12,color:'#9d174d',fontFamily:SANS}}>
                {fmt(together.total)} spent side by side this month
              </p>
            </div>
          </div>
          {together.list.slice(0,4).map((o,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:8,
              padding:'6px 0 0',borderTop:i?'1px solid #f9a8d4':'none',
              marginTop:i?6:0}}>
              <Heart size={10} color="#be185d" fill="#be185d" style={{flexShrink:0}}/>
              <span style={{flex:1,fontSize:12,color:'#831843',fontFamily:SANS,
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {o.merchant}
              </span>
              <span style={{fontSize:10,color:'#be185d',fontFamily:SANS}}>{o.date}</span>
              <span style={{fontFamily:SERIF,fontSize:14,fontWeight:600,color:'#831843'}}>
                {fmt(o.total)}
              </span>
            </div>
          ))}
          {together.list.length>4&&(
            <p style={{margin:'8px 0 0',fontSize:11,color:'#be185d',fontFamily:SANS}}>
              +{together.list.length-4} more
            </p>
          )}
        </div>
      )}

      <div style={{display:'flex', alignItems:'center', gap:10, padding:'11px 14px',
        marginBottom:12, background:C.blue+'0c', border:`1px solid ${C.blue}22`, borderRadius:12}}>
        <CalendarDays size={16} color={C.blue} style={{flexShrink:0}}/>
        <p style={{margin:0, fontSize:11, color:C.inkMid, fontFamily:SANS, lineHeight:1.5, flex:1}}>
          Rent, electricity, and other recurring bills live in{' '}
          <button onClick={()=>setTab('bills')} style={{border:'none', background:'none', padding:0,
            color:C.blue, fontWeight:700, cursor:'pointer', fontFamily:SANS, fontSize:11, textDecoration:'underline'}}>
            Bills
          </button>
          {' '}— once charged, they still count toward what you've spent below, under Home.
        </p>
      </div>

      <SL>Spending this month</SL>
      <Card style={{padding:'8px 0'}}>
        {allCats.map((cat,i)=>{
          const spent=txByCat[cat.id]||0;
          const target=catTargets[cat.id]||cat.target;
          const over=spent>target&&target>0;
          const isOpen=openCat===cat.id;
          const rows=isOpen?rowsFor(cat.id):[];
          return (
            <div key={cat.id}>
              {i>0&&<Divider/>}

              {/* Tap the row to see what makes up the total */}
              <div style={{display:'flex',alignItems:'center',gap:12,padding:'11px 18px',
                background:isOpen?C.sand:'transparent'}}>
                <button
                  onClick={()=>setOpenCat(isOpen?null:cat.id)}
                  style={{display:'flex',alignItems:'center',gap:12,flex:1,minWidth:0,
                    border:'none',background:'transparent',cursor:'pointer',textAlign:'left'}}>
                  <div style={{width:32,height:32,borderRadius:9,background:cat.color+'18',
                    display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <CatIcon name={cat.icon} size={16} color={cat.color}/>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                      <span style={{fontSize:14,color:C.ink,fontFamily:SANS,
                        fontWeight:spent>0?500:400,display:'flex',alignItems:'center',gap:6}}>
                        {cat.label}
                        {cat.excluded&&(
                          <span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:99,
                            background:C.sandMid,color:C.inkSoft,letterSpacing:'0.04em'}}>
                            NOT SPENDING
                          </span>
                        )}
                      </span>
                      <div style={{display:'flex',alignItems:'baseline',gap:4}}>
                        <span style={{fontFamily:SERIF,fontSize:17,fontWeight:600,
                          color:over?C.red:spent>0?C.ink:C.sandDark}}>{fmt(spent)}</span>
                        {target>0&&<div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:0}}>
                          <button 
                            onClick={e=>{e.stopPropagation();setEditingCatTarget(cat.id);}}
                            style={{fontSize:11,color:C.inkSoft,fontFamily:SANS,background:'none',border:'none',
                              cursor:'pointer',padding:'0 4px',borderRadius:4,transition:'all 0.12s'}}
                            onMouseEnter={e=>e.target.style.background=C.sand}
                            onMouseLeave={e=>e.target.style.background='none'}>
                            {fmtK(target)} ✏️
                          </button>
                          {suggested[cat.id]&&<span style={{fontSize:9,color:C.sandDark,fontFamily:SANS,opacity:0.6}}>
                            suggested ${suggested[cat.id]}
                          </span>}
                        </div>}
                        <ChevronRight size={14} color={C.sandDark}
                          style={{transform:isOpen?'rotate(90deg)':'none',
                            transition:'transform 0.15s',marginLeft:2}}/>
                      </div>
                    </div>
                    {target>0&&<Bar spent={spent} target={target} color={cat.color}/>}
                    {over&&<p style={{margin:'3px 0 0',fontSize:10,color:C.red,fontFamily:SANS}}>
                      {fmt(spent-target)} over</p>}
                  </div>
                </button>
                <button
                  onClick={e=>{e.stopPropagation();setQuickAddCat(cat.id);setTab('add');}}
                  onMouseEnter={e=>e.target.style.transform='scale(1.08)'}
                  onMouseLeave={e=>e.target.style.transform='scale(1)'}
                  style={{width:32,height:32,borderRadius:8,border:'none',
                    background:cat.color,color:'#fff',cursor:'pointer',
                    display:'flex',alignItems:'center',justifyContent:'center',
                    flexShrink:0,fontSize:18,fontWeight:300,transition:'all 0.12s'}}
                  title={`Quick add to ${cat.label}`}>
                  +
                </button>
              </div>

              {/* Drill-down: every transaction in this category */}
              {isOpen&&(
                <div style={{background:C.sand,padding:'2px 0 10px'}}>
                  {rows.length===0?(
                    <p style={{margin:0,padding:'10px 18px',fontSize:12,
                      color:C.inkSoft,fontFamily:SANS,fontStyle:'italic'}}>
                      Nothing in this category yet this month.
                    </p>
                  ):rows.map(tx=>(
                    <div key={tx.id} style={{display:'flex',alignItems:'center',gap:8,
                      padding:'8px 18px 8px 30px',opacity:busyId===tx.id?0.45:1}}>
                      <div style={{flex:1,minWidth:0}}>
                        <p style={{margin:0,fontSize:12,color:C.ink,fontFamily:SANS,
                          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                          display:'flex',alignItems:'center',gap:5}}>
                          {sharedMoments.has(tx.id)&&(
                            <Heart size={11} color="#be185d" fill="#be185d"
                              style={{flexShrink:0}}/>
                          )}
                          <span style={{overflow:'hidden',textOverflow:'ellipsis',
                            whiteSpace:'nowrap'}}>
                            {tx.note||tx.description||cat.label}
                          </span>
                        </p>
                        <p style={{margin:'1px 0 0',fontSize:10,fontFamily:SANS,
                          color:sharedMoments.has(tx.id)?'#be185d':C.inkSoft}}>
                          {tx.date}{tx.source?' · '+instLabel(tx.source):''}
                          {tx.who?' · '+tx.who:''}
                          {sharedMoments.has(tx.id)&&
                            ` · together with ${sharedMoments.get(tx.id).partner}`}
                        </p>
                      </div>
                      {tx.who && <UserAvatar name={tx.who} size={18}/>}
                      <p style={{margin:0,fontFamily:SERIF,fontSize:14,fontWeight:600,
                        color:C.ink,minWidth:56,textAlign:'right'}}>{fmt(tx.amount)}</p>
                      {busyId===tx.id
                        ? <Spinner size={13}/>
                        : (<>
                          <button onClick={()=>setEditingTxn(tx)} title="Edit date, amount, or category"
                            style={{border:'none',background:C.sandMid,color:C.inkSoft,borderRadius:6,
                              padding:'4px 6px',cursor:'pointer',fontSize:11,flexShrink:0}}>
                            ✏️
                          </button>
                          <select
                            value={cat.id}
                            onChange={e=>{
                              if(e.target.value==='__delete'){ onDeleteRow?.(tx); return; }
                              if(e.target.value!==cat.id) reassign(tx,e.target.value);
                            }}
                            style={{border:`1px solid ${C.sandDark}`,borderRadius:7,
                              padding:'3px 5px',fontSize:10,fontWeight:600,color:C.inkMid,
                              background:C.white,cursor:'pointer',fontFamily:SANS,maxWidth:104}}>
                            {allCats.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
                            <option disabled>──────────</option>
                            <option value="__delete">Delete — duplicate</option>
                          </select>
                        </>)}
                    </div>
                  ))}
                  {rows.length>0&&(
                    <p style={{margin:'6px 18px 0 30px',fontSize:10,color:C.inkSoft,
                      fontFamily:SANS,lineHeight:1.5}}>
                      Change any dropdown to move that transaction to another category.
                    </p>
                  )}
                  {cat.custom&&(
                    <button
                      onClick={()=>{if(window.confirm(`Remove the "${cat.label}" category?`)){
                        setOpenCat(null); onDeleteCat(cat.id);}}}
                      style={{display:'flex',alignItems:'center',gap:6,margin:'10px 18px 0 30px',
                        border:`1px solid ${C.red}44`,borderRadius:8,padding:'5px 10px',
                        background:C.white,cursor:'pointer',fontFamily:SANS,
                        fontSize:11,fontWeight:600,color:C.red}}>
                      <Trash2 size={12} color={C.red}/> Remove this category
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <Divider/>
        <button onClick={()=>setShowAdd(true)} style={{display:'flex',alignItems:'center',gap:10,
          padding:'12px 18px',width:'100%',border:'none',background:'none',cursor:'pointer'}}>
          <div style={{width:32,height:32,borderRadius:9,background:C.sandMid,
            display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Plus size={16} color={C.inkSoft}/>
          </div>
          <span style={{fontSize:14,color:C.inkSoft,fontFamily:SANS}}>Add category</span>
        </button>
      </Card>

      {showAdd&&<AddCatModal onSave={cat=>{onAddCat(cat);setShowAdd(false);}} onClose={()=>setShowAdd(false)}/>}
      {showScan&&<ReceiptScanModal allCats={allCats} profile={profile} partnerName={partnerName} onScan={onScanReceipt}
        onConfirm={onConfirmReceipt} onClose={()=>setShowScan(false)}/>}
      {editingTxn&&<EditTransactionModal tx={editingTxn} allCats={allCats}
        onSave={async updates=>{
          setBusyId(editingTxn.id);
          await onEditTxnSave(editingTxn, updates);
          setBusyId(null);
        }}
        onClose={()=>setEditingTxn(null)}/>}
    </div>
  );
}

// ─── ADD TAB ──────────────────────────────────────────────────────────────────
export function AddTab({profile,partnerName,allCats,onAdd,quickCat}) {
  const myFirst = firstName(profile?.name) || 'me';
  const partnerFirst = firstName(partnerName) || 'partner';
  const [cat,   setCat]   = useState(quickCat || null);
  const [amount,setAmount]= useState('');
  const [note,  setNote]  = useState('');
  const [date,  setDate]  = useState(today());
  const [person,setPerson]= useState(myFirst); // Who spent: defaults to you
  const [merchant,setMerchant]= useState(''); // Store, venue, etc.
  const [saving,setSaving]= useState(false);
  const ref=useRef(null);
  useEffect(()=>{ref.current?.focus();},[]);
  useEffect(()=>{if(quickCat) setCat(quickCat);},[quickCat]);
  const can=cat&&parseFloat(amount)>0;
  const selCat=allCats.find(c=>c.id===cat);
  async function submit() {
    if(!can||saving)return;
    setSaving(true);
    // The picker lets either partner log something on the other's behalf —
    // "who spent this" was being silently ignored before, always recording
    // whoever happened to be logged in instead of whoever was selected.
    const attributedTo = resolveWho(person, profile?.name, partnerName, myFirst);
    await onAdd({cat,amount:parseFloat(amount),note:note.trim(),date,who:attributedTo,person,merchant:merchant.trim()});
    setCat(null);setAmount('');setNote('');setDate(today());setPerson(myFirst);setMerchant('');
    setSaving(false);ref.current?.focus();
  }
  return (
    <div style={{padding:'16px 16px 0'}}>
      <Card style={{textAlign:'center',padding:'24px 16px'}}>
        <p style={{margin:'0 0 8px',fontSize:11,color:C.inkSoft,textTransform:'uppercase',
          letterSpacing:'0.1em',fontFamily:SANS}}>Amount</p>
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
          <span style={{fontFamily:SERIF,fontSize:36,fontWeight:400,color:C.sandDark,lineHeight:1}}>$</span>
          <input ref={ref} type="number" inputMode="decimal" placeholder="0.00" value={amount}
            onChange={e=>setAmount(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}
            style={{fontFamily:SERIF,fontSize:56,fontWeight:600,color:C.ink,border:'none',
              outline:'none',background:'none',width:200,textAlign:'center',
              letterSpacing:'-0.03em',lineHeight:1}}/>
        </div>
        {can&&<p style={{margin:'8px 0 0',fontSize:13,color:C.inkSoft,fontFamily:SANS}}>
          {selCat?.label} · {fmt(parseFloat(amount))}</p>}
      </Card>
      <SL>Category</SL>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:16}}>
        {allCats.map(c=>(
          <button key={c.id} onClick={()=>setCat(c.id)} style={{
            border:`1.5px solid ${cat===c.id?c.color:C.sandDark}`,borderRadius:12,
            padding:'10px 8px 8px',display:'flex',flexDirection:'column',alignItems:'center',gap:6,
            background:cat===c.id?c.color+'15':C.white,cursor:'pointer',transition:'all 0.12s'}}>
            <CatIcon name={c.icon} size={20} color={cat===c.id?c.color:C.inkSoft}/>
            <span style={{fontSize:11,fontWeight:cat===c.id?600:400,
              color:cat===c.id?c.color:C.inkMid,textAlign:'center',lineHeight:1.2,fontFamily:SANS}}>
              {c.label}</span>
          </button>
        ))}
      </div>
      <Card style={{padding:0}}>
        <div style={{padding:'14px 18px'}}>
          <input type="text" placeholder="Note (optional)" value={note}
            onChange={e=>setNote(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}
            style={{width:'100%',border:'none',outline:'none',fontSize:16,color:C.ink,
              background:'none',fontFamily:SANS,caretColor:C.green}}/>
        </div>
        <Divider/>
        <div style={{padding:'12px 18px'}}>
          <p style={{margin:'0 0 6px',fontSize:11,color:C.inkSoft,textTransform:'uppercase',
            letterSpacing:'0.08em',fontFamily:SANS}}>Merchant (store, venue, etc.)</p>
          <input type="text" placeholder="e.g. Whole Foods, Amazon, Shell Gas" value={merchant}
            onChange={e=>setMerchant(e.target.value)}
            style={{width:'100%',border:'none',outline:'none',fontSize:13,color:C.ink,
              background:C.sand,fontFamily:SANS,padding:'8px 10px',borderRadius:8,caretColor:C.green}}/>
        </div>
        <Divider/>
        <div style={{padding:'12px 18px'}}>
          <p style={{margin:'0 0 6px',fontSize:11,color:C.inkSoft,textTransform:'uppercase',
            letterSpacing:'0.08em',fontFamily:SANS}}>Who spent this?</p>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>setPerson(myFirst)} style={{
              flex:1,padding:'8px 12px',border:`1.5px solid ${person===myFirst?C.blue:C.sandDark}`,
              borderRadius:10,background:person===myFirst?C.blue+'15':'white',
              color:person===myFirst?C.blue:C.ink,fontSize:12,fontWeight:600,fontFamily:SANS,
              cursor:'pointer',transition:'all 0.12s'
            }}>{capitalize(myFirst)}</button>
            <button onClick={()=>setPerson(partnerFirst)} style={{
              flex:1,padding:'8px 12px',border:`1.5px solid ${person===partnerFirst?C.blue:C.sandDark}`,
              borderRadius:10,background:person===partnerFirst?C.blue+'15':'white',
              color:person===partnerFirst?C.blue:C.ink,fontSize:12,fontWeight:600,fontFamily:SANS,
              cursor:'pointer',transition:'all 0.12s'
            }}>{capitalize(partnerFirst)}</button>
          </div>
        </div>
        <Divider/>
        <div style={{padding:'12px 18px',display:'flex',gap:12,alignItems:'center'}}>
          <div style={{flex:1}}>
            <p style={{margin:'0 0 3px',fontSize:11,color:C.inkSoft,textTransform:'uppercase',
              letterSpacing:'0.08em',fontFamily:SANS}}>Date</p>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)}
              style={{border:'none',outline:'none',fontSize:14,color:C.ink,background:'none',fontFamily:SANS}}/>
          </div>
          <div>
            <p style={{margin:'0 0 4px',fontSize:11,color:C.inkSoft,fontFamily:SANS}}>Logged by</p>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <UserAvatar name={profile?.name||'?'} size={28}/>
              <span style={{fontSize:13,fontWeight:600,color:C.inkMid,fontFamily:SANS}}>
                {profile?.name||'You'}
              </span>
            </div>
          </div>
        </div>
      </Card>
      <button onClick={submit} disabled={!can||saving} style={{border:'none',width:'100%',
        padding:'16px',borderRadius:14,fontSize:16,fontWeight:600,cursor:can?'pointer':'default',
        background:can?C.green:C.sandDark,color:can?'#fff':C.inkSoft,fontFamily:SANS,
        display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginBottom:8}}>
        {saving?<><Spinner/>Saving…</>:can?`Add ${fmt(parseFloat(amount))} to ${selCat?.label}`:'Select a category and enter amount'}
      </button>
    </div>
  );
}

// ─── HISTORY TAB ──────────────────────────────────────────────────────────────
export function HistoryTab({txns,bankImports,allCats,profile,partnerName,onDeleteTxn,onDeleteImport,onSaveNote}) {
  const { shared:sharedMoments } = findSharedMoments([...txns,...bankImports]);
  const [filter,   setFilter]   = useState('all');
  const [srcFil,   setSrcFil]   = useState('all');
  const [editNote, setEditNote] = useState(null); // { id, type, value }
  const myFirst = firstName(profile?.name);
  const partnerFirst = firstName(partnerName);
  const all=[
    ...txns.map(t=>({...t,_type:'manual'})),
    ...bankImports.map(t=>({...t,_type:'import'})),
  ]
    .filter(t=>filter==='all'||t.who===filter||(t.who||'').toLowerCase().includes(filter))
    .filter(t=>srcFil==='all'||(srcFil==='manual'&&t._type==='manual')||(srcFil==='import'&&t._type==='import'))
    .sort((a,b)=>new Date(b.date)-new Date(a.date));
  const grouped={};
  all.forEach(t=>{
    const label=new Date(t.date+'T00:00:00').toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric'});
    if(!grouped[label])grouped[label]=[];
    grouped[label].push(t);
  });
  const total=all.reduce((a,t)=>a+t.amount,0);
  return (
    <div style={{padding:'16px 16px 0'}}>
      <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
        {[['all','Everyone'],[myFirst,capitalize(myFirst)||'Me'],[partnerFirst,capitalize(partnerFirst)||'Partner']].map(([k,l])=>(
          <button key={k} onClick={()=>setFilter(k)} style={{border:'none',padding:'6px 14px',
            borderRadius:99,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:SANS,
            background:filter===k?C.ink:'transparent',color:filter===k?'#fff':C.inkSoft,
            outline:filter===k?'none':`1px solid ${C.sandDark}`}}>{l}</button>
        ))}
        {[['all','All'],['manual','Manual'],['import','Imported']].map(([k,l])=>(
          <button key={k} onClick={()=>setSrcFil(k)} style={{border:'none',padding:'6px 14px',
            borderRadius:99,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:SANS,
            background:srcFil===k?C.purple:'transparent',color:srcFil===k?'#fff':C.inkSoft,
            outline:srcFil===k?'none':`1px solid ${C.sandDark}`}}>{l}</button>
        ))}
      </div>
      {all.length>0&&<p style={{textAlign:'right',fontSize:12,color:C.inkSoft,margin:'0 0 8px',fontFamily:SANS}}>
        {all.length} entries · <span style={{fontFamily:SERIF,fontWeight:600,fontSize:14,color:C.ink}}>{fmt(total)}</span>
      </p>}
      {all.length===0?(
        <div style={{textAlign:'center',padding:'60px 0',color:C.inkSoft}}>
          <Package size={40} color={C.sandDark} style={{marginBottom:12}}/>
          <p style={{fontFamily:SERIF,fontSize:20,color:C.inkMid}}>No transactions yet</p>
        </div>
      ):Object.entries(grouped).map(([day,items])=>(
        <div key={day}>
          <p style={{margin:'0 0 6px',fontSize:11,color:C.inkSoft,fontWeight:600,
            textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:SANS}}>{day}</p>
          <Card style={{padding:'4px 0',marginBottom:10}}>
            {items.map((tx,i)=>{
              const catId=tx.cat||tx.category;
              const c=allCats.find(x=>x.id===catId)||{icon:'Package',color:C.inkSoft,label:'Other'};
              return (
                <div key={tx.id}>
                  {i>0&&<Divider/>}
                  <div style={{display:'flex',alignItems:'center',gap:10,padding:'11px 16px'}}>
                    <div style={{width:34,height:34,borderRadius:10,background:c.color+'18',
                      display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <CatIcon name={c.icon} size={16} color={c.color}/>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <p style={{margin:0,fontSize:14,fontWeight:500,color:C.ink,fontFamily:SANS,
                        display:'flex',alignItems:'center',gap:5,minWidth:0}}>
                        {sharedMoments.has(tx.id)&&(
                          <Heart size={12} color="#be185d" fill="#be185d" style={{flexShrink:0}}/>
                        )}
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',
                          whiteSpace:'nowrap'}}>
                          {tx.note||tx.description||c.label}
                        </span></p>
                      {/* Editable note field */}
                      {editNote?.id===tx.id ? (
                        <div style={{display:'flex',gap:6,marginTop:4}} onClick={e=>e.stopPropagation()}>
                          <input
                            autoFocus
                            type="text"
                            value={editNote.value}
                            onChange={e=>setEditNote(prev=>({...prev,value:e.target.value}))}
                            onKeyDown={e=>{
                              if(e.key==='Enter'){onSaveNote(tx.id,tx._type,editNote.value);setEditNote(null);}
                              if(e.key==='Escape')setEditNote(null);
                            }}
                            placeholder="What was this transaction?"
                            style={{flex:1,border:`1px solid ${C.green}`,borderRadius:7,padding:'4px 8px',
                              fontSize:12,color:C.ink,background:C.sand,fontFamily:SANS,outline:'none'}}
                          />
                          <button onClick={()=>{onSaveNote(tx.id,tx._type,editNote.value);setEditNote(null);}}
                            style={{border:'none',background:C.green,color:'#fff',borderRadius:7,
                              padding:'4px 8px',fontSize:12,cursor:'pointer',fontFamily:SANS}}>
                            Save
                          </button>
                        </div>
                      ) : (
                        <button onClick={()=>setEditNote({id:tx.id,type:tx._type,value:tx.note||''})}
                          style={{border:'none',background:'none',padding:0,cursor:'pointer',
                            textAlign:'left',width:'100%',marginTop:2}}>
                          <p style={{margin:0,fontSize:11,fontFamily:SANS,
                            color:tx.note?C.green:C.inkSoft+'88',fontStyle:tx.note?'normal':'italic'}}>
                            {tx.note
                              ? tx.note
                              : (tx._type==='import'
                                  ? `${instLabel(tx.source)} · tap to add note`
                                  : `${c.label} · tap to add note`)}
                            {tx.who?' · '+tx.who:''}
                          </p>
                        </button>
                      )}
                    </div>
                    <UserAvatar name={tx.who||'?'} size={22}/>
                    <p style={{margin:0,fontFamily:SERIF,fontSize:17,fontWeight:600,color:C.ink,
                      fontVariantNumeric:'tabular-nums',minWidth:64,textAlign:'right'}}>{fmt(tx.amount)}</p>
                    <button onClick={()=>{if(window.confirm('Remove?'))
                        tx._type==='import'?onDeleteImport(tx.id):onDeleteTxn(tx.id);}}
                      style={{border:'none',background:'none',cursor:'pointer',padding:'4px',flexShrink:0}}>
                      <Trash2 size={14} color={C.sandDark}/>
                    </button>
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      ))}
    </div>
  );
}

// ─── Bill editor ──────────────────────────────────────────────────────────────
export function BillEditModal({ bill, allCats, onSave, onDelete, onDeleteEverywhere, onClose }) {
  const [label,  setLabel]  = useState(bill?.label || '');
  const [amount, setAmount] = useState(bill?.amount ?? '');
  const [day,    setDay]    = useState(bill?.day ?? 1);
  const [cat,    setCat]    = useState(bill?.category || 'other');
  const [recurring, setRecurring] = useState(bill?.recurring ?? true);
  const [paymentType, setPaymentType] = useState(bill?.payment_type || 'service');
  const [busy,   setBusy]   = useState(false);

  const isNew = !bill;
  const valid = label.trim() && Number(amount) > 0 && day >= 1 && day <= 31;

  async function save() {
    if (!valid) return;
    setBusy(true);
    await onSave({
      key:           bill?.key || 'manual:' + uid(),
      label:         label.trim(),
      amount:        Number(amount),
      day:           Number(day),
      category:      cat,
      status:        bill?.detected ? 'confirmed' : 'manual',
      recurring:     recurring,
      payment_type:  paymentType,
      frequency:     recurring ? 'monthly' : 'one-time',
    });
    setBusy(false);
  }

  const paymentTypes = [
    {id:'service', label:'Service/Subscription', color:'#0369a1'},
    {id:'credit_card', label:'Credit Card Payment', color:'#c0392b'},
    {id:'utility', label:'Utility/Essential', color:'#1a7a4a'},
    {id:'other', label:'Other', color:'#6b7280'},
  ];

  return (
    <div style={{ position:'fixed', inset:0, zIndex:760,
      display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(26,26,24,0.6)' }}/>
      <div style={{ position:'relative', background:C.white, borderRadius:'20px 20px 0 0',
        padding:'22px 20px 34px', animation:'slideUp 0.25s ease', maxHeight:'88dvh', overflowY:'auto' }}>

        <div style={{ display:'flex', alignItems:'center', marginBottom:16 }}>
          <h2 style={{ flex:1, margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
            {isNew ? 'Add a bill' : 'Edit bill'}
          </h2>
          <button onClick={onClose} style={{ border:'none', background:'none', padding:6, cursor:'pointer' }}>
            <X size={20} color={C.inkSoft}/>
          </button>
        </div>

        {bill?.detected && (
          <p style={{ margin:'0 0 14px', fontSize:12, color:C.inkSoft,
            fontFamily:SANS, lineHeight:1.6 }}>
            Found in {bill.monthsSeen} months of statements. Anything you change here
            sticks, and future imports will not overwrite it.
          </p>
        )}

        <SL>Name</SL>
        <input value={label} onChange={e => setLabel(e.target.value)}
          placeholder="e.g. Rent"
          style={{ width:'100%', border:`1px solid ${C.sandDark}`, borderRadius:10,
            padding:'12px 14px', fontSize:16, color:C.ink, background:C.sand,
            marginBottom:14, outline:'none', fontFamily:SANS, boxSizing:'border-box' }}/>

        <SL>Amount</SL>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
          <span style={{ fontSize:18, color:C.inkSoft, fontFamily:SERIF }}>$</span>
          <input type="number" inputMode="decimal" value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{ flex:1, border:`1px solid ${C.sandDark}`, borderRadius:10,
              padding:'12px 14px', fontSize:16, color:C.ink, background:C.sand,
              outline:'none', fontFamily:SERIF, boxSizing:'border-box' }}/>
        </div>

        <SL>Is this recurring?</SL>
        <div style={{ display:'flex', gap:10, marginBottom:8 }}>
          <button onClick={() => setRecurring(true)} style={{
            flex:1, padding:'10px 14px', border:`1.5px solid ${recurring ? '#1a7a4a' : C.sandDark}`,
            background: recurring ? '#1a7a4a' : 'white', color: recurring ? 'white' : C.ink,
            borderRadius:10, cursor:'pointer', fontWeight:600, fontSize:14, fontFamily:SANS, transition:'all 0.12s'
          }}>Yes, every month</button>
          <button onClick={() => setRecurring(false)} style={{
            flex:1, padding:'10px 14px', border:`1.5px solid ${!recurring ? '#c0392b' : C.sandDark}`,
            background: !recurring ? '#c0392b' : 'white', color: !recurring ? 'white' : C.ink,
            borderRadius:10, cursor:'pointer', fontWeight:600, fontSize:14, fontFamily:SANS, transition:'all 0.12s'
          }}>No, one-time</button>
        </div>
        <p style={{ margin:'0 0 14px', fontSize:11, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6 }}>
          This only changes how this bill schedules going forward — it can't move any
          specific charge to a different month. To fix a transaction that's filed under
          the wrong month, edit it directly from the Spending tab instead (tap the ✏️
          next to it).
        </p>

        <SL>Type of payment</SL>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
          {paymentTypes.map(pt => (
            <button key={pt.id} onClick={() => setPaymentType(pt.id)} style={{
              padding:'10px 12px', border:`1.5px solid ${paymentType === pt.id ? pt.color : C.sandDark}`,
              background: paymentType === pt.id ? pt.color + '15' : 'white',
              color: paymentType === pt.id ? pt.color : C.inkSoft,
              borderRadius:10, cursor:'pointer', fontWeight: paymentType === pt.id ? 600 : 400,
              fontSize:12, fontFamily:SANS, transition:'all 0.12s'
            }}>{pt.label}</button>
          ))}
        </div>

        <SL>Usually charged on the</SL>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
          <input type="number" min="1" max="31" value={day}
            onChange={e => setDay(e.target.value)}
            style={{ width:80, border:`1px solid ${C.sandDark}`, borderRadius:10,
              padding:'12px 14px', fontSize:16, color:C.ink, background:C.sand,
              outline:'none', fontFamily:SERIF, boxSizing:'border-box' }}/>
          <span style={{ fontSize:13, color:C.inkSoft, fontFamily:SANS }}>
            of the month · the 31st falls back to the last day in shorter months
          </span>
        </div>

        <SL>Category</SL>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:7, marginBottom:20 }}>
          {allCats.filter(c => !c.isIncome).map(c => (
            <button key={c.id} onClick={() => setCat(c.id)}
              style={{ border:`1.5px solid ${cat===c.id ? c.color : C.sandDark}`,
                borderRadius:10, padding:'9px 6px', cursor:'pointer',
                background: cat===c.id ? c.color+'15' : C.white,
                display:'flex', flexDirection:'column', alignItems:'center', gap:5 }}>
              <CatIcon name={c.icon} size={16} color={cat===c.id ? c.color : C.inkSoft}/>
              <span style={{ fontSize:10, color:cat===c.id ? c.color : C.inkMid,
                fontFamily:SANS, textAlign:'center', lineHeight:1.2 }}>{c.label}</span>
            </button>
          ))}
        </div>

        <button onClick={save} disabled={!valid || busy}
          style={{ width:'100%', border:'none', padding:'15px', borderRadius:12,
            background: valid ? C.green : C.sandDark, color: valid ? '#fff' : C.inkSoft,
            fontSize:15, fontWeight:600, cursor: valid ? 'pointer' : 'default',
            fontFamily:SANS, marginBottom:8,
            display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
          {busy ? <><Spinner size={14}/>Saving…</> : isNew ? 'Add bill' : 'Save changes'}
        </button>

        {bill && (
          <>
            <button onClick={() => onDelete(bill)}
              style={{ width:'100%', border:`1px solid ${C.red}44`, padding:'13px',
                borderRadius:12, background:C.white, color:C.red, fontSize:14,
                fontWeight:600, cursor:'pointer', fontFamily:SANS }}>
              Remove from this month
            </button>
            <button onClick={() => {
                const msg = bill.manual
                  ? `Delete "${bill.label}" for good, from every month?`
                  : `Stop tracking "${bill.label}" as a bill in every month, past and future? Real charges already in your statements are never touched — this only affects the bill tracker.`;
                if (window.confirm(msg)) onDeleteEverywhere(bill);
              }}
              style={{ width:'100%', border:'none', padding:'8px', marginTop:6,
                background:'none', color:C.inkSoft, fontSize:11,
                cursor:'pointer', fontFamily:SANS, textDecoration:'underline' }}>
              Delete from every month instead
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── CALENDAR TAB ────────────────────────────────────────────────────────────
export function CalendarTab({year, month, txns, bankImports, billRules, billPayments, billActiveKeys, billConfiguredMonths, onDeleteBillForMonth, onUpdateBillForMonth, expectedIncome, setExpectedIncome, goals, onSaveGoals, allCats, history, showToast, onSaveRule, onDeleteRule}) {
  const [selectedDay, setSelectedDay] = useState(null);
  const today = new Date();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  // Merged bills (detected + manual overrides), same source of truth as the Bills tab
  const detected = detectRecurring(history || []);
  const mergedBills = applyBillRules(detected, billRules || [], billActiveKeys || new Map(), billConfiguredMonths || new Set(), year, month).filter(b => b.confidence === 'high');

  const billsByDay = {};
  mergedBills.forEach(b => {
    const d = Math.min(b.day, daysInMonth); // clamp to last day of shorter months
    if (!billsByDay[d]) billsByDay[d] = [];
    billsByDay[d].push(b);
  });

  // Predicted (planned ahead) and actual (already landed) income are tracked
  // completely separately — never summed together into one figure, since
  // they answer different questions ("what's expected" vs "what happened").
  const predictedIncomeByDay = {};
  (expectedIncome || []).forEach(inc => {
    const d = parseLocalDate(inc.date).getDate();
    if (!predictedIncomeByDay[d]) predictedIncomeByDay[d] = [];
    predictedIncomeByDay[d].push(inc);
  });

  const actualIncomeByDay = {};
  [...(txns||[]), ...(bankImports||[])]
    .filter(t => (t.category||t.cat) === 'income')
    .forEach(t => {
      const d = parseLocalDate(t.date).getDate();
      if (!actualIncomeByDay[d]) actualIncomeByDay[d] = [];
      actualIncomeByDay[d].push(t);
    });

  const depositsByDay = {};
  (goals || []).forEach(g => {
    (g.deposits || []).forEach(dep => {
      const d = parseLocalDate(dep.date).getDate();
      if (!depositsByDay[d]) depositsByDay[d] = [];
      depositsByDay[d].push({...dep, goalId: g.id, goalLabel: g.label});
    });
  });

  const days = Array(firstDayOfWeek).fill(null).concat(Array.from({length: daysInMonth}, (_, i) => i + 1));
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div style={{padding: '16px'}}>
      <h2 style={{margin: '0 0 16px', fontFamily: SERIF, fontSize: 20, fontWeight: 600, color: C.ink}}>
        📅 Financial Calendar
      </h2>
      <p style={{margin: '0 0 16px', fontSize: 12, color: C.inkSoft, fontFamily: SANS}}>
        Tap any day to see and edit what's happening — predicted income, bills due, and goal deposits.
      </p>

      {/* Calendar Grid */}
      <Card style={{padding: '16px', background: C.white}}>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 12}}>
          {weekDays.map(day => (
            <div key={day} style={{textAlign: 'center', fontSize: 11, fontWeight: 600, color: C.inkSoft, fontFamily: SANS, padding: '8px 0'}}>
              {day}
            </div>
          ))}
        </div>

        <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4}}>
          {weeks.map((week, weekIdx) => 
            week.map((day, dayIdx) => {
              const dayPredicted = day && predictedIncomeByDay[day];
              const dayActual = day && actualIncomeByDay[day];
              const dayBills = day && billsByDay[day];
              const dayDeposits = day && depositsByDay[day];
              const isToday = day && today.getDate() === day && today.getMonth() === month && today.getFullYear() === year;
              const hasAnything = dayPredicted || dayActual || dayBills || dayDeposits;

              return (
                <button
                  key={`${weekIdx}-${dayIdx}`}
                  onClick={() => day && setSelectedDay(day)}
                  disabled={!day}
                  style={{
                    aspectRatio: '1',
                    border: `1px solid ${isToday ? C.blue : C.sandMid}`,
                    borderRadius: 8,
                    padding: '6px',
                    background: isToday ? C.blue + '08' : C.white,
                    display: 'flex',
                    flexDirection: 'column',
                    fontSize: 12,
                    fontFamily: SANS,
                    minHeight: '70px',
                    cursor: day ? 'pointer' : 'default',
                    textAlign: 'left'
                  }}>
                  <div style={{fontSize: 11, fontWeight: 600, color: isToday ? C.blue : C.ink, marginBottom: 4}}>
                    {day || ''}
                  </div>

                  {day && (
                    <div style={{display: 'flex', flexDirection: 'column', gap: 2, flex: 1}}>
                      {dayActual && dayActual.length > 0 && (
                        <div style={{fontSize: 9, padding: '2px 4px', borderRadius: 3, background: C.green + '20',
                          color: C.green, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                          💵 {fmt(dayActual.reduce((a,i)=>a+i.amount,0))}
                        </div>
                      )}
                      {dayPredicted && dayPredicted.length > 0 && (
                        <div style={{fontSize: 9, padding: '2px 4px', borderRadius: 3, background: C.blue + '20',
                          color: C.blue, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                          💰 {fmt(dayPredicted.reduce((a,i)=>a+i.amount,0))}
                        </div>
                      )}
                      {dayBills && dayBills.length > 0 && (
                        <div style={{fontSize: 9, padding: '2px 4px', borderRadius: 3, background: C.red + '20',
                          color: C.red, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                          📋 {dayBills.length} bill{dayBills.length !== 1 ? 's' : ''}
                        </div>
                      )}
                      {dayDeposits && dayDeposits.length > 0 && (
                        <div style={{fontSize: 9, padding: '2px 4px', borderRadius: 3, background: C.purple + '20',
                          color: C.purple, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                          🎯 {fmt(dayDeposits.reduce((a,d)=>a+d.amount,0))}
                        </div>
                      )}
                      {!hasAnything && <div style={{flex:1}}/>}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </Card>

      {/* Legend */}
      <div style={{marginTop: 16, padding: '12px 16px', background: C.sand, borderRadius: 10, fontSize: 12, fontFamily: SANS}}>
        <p style={{margin: '0 0 8px', fontWeight: 600, color: C.ink}}>Legend:</p>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
            <span style={{display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: C.green + '40'}}/>
            <span style={{fontSize: 11, color: C.inkSoft}}>💵 Actual income (landed)</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
            <span style={{display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: C.blue + '40'}}/>
            <span style={{fontSize: 11, color: C.inkSoft}}>💰 Predicted income</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
            <span style={{display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: C.red + '40'}}/>
            <span style={{fontSize: 11, color: C.inkSoft}}>Bills due</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
            <span style={{display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: C.purple + '40'}}/>
            <span style={{fontSize: 11, color: C.inkSoft}}>Goal deposits</span>
          </div>
        </div>
      </div>

      {selectedDay && (
        <DayDetailPanel
          day={selectedDay}
          year={year}
          month={month}
          bills={billsByDay[selectedDay] || []}
          incomeEntries={predictedIncomeByDay[selectedDay] || []}
          actualEntries={actualIncomeByDay[selectedDay] || []}
          deposits={depositsByDay[selectedDay] || []}
          goals={goals || []}
          onSaveGoals={onSaveGoals}
          expectedIncome={expectedIncome || []}
          setExpectedIncome={setExpectedIncome}
          onSaveRule={onSaveRule}
          onDeleteRule={onDeleteRule}
          onDeleteBillForMonth={onDeleteBillForMonth}
          onUpdateBillForMonth={onUpdateBillForMonth}
          allMonthBills={mergedBills}
          showToast={showToast}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}

// ─── DAY DETAIL PANEL (calendar click-through, everything editable) ──────────
function DayDetailPanel({day, year, month, bills, incomeEntries, actualEntries, deposits, goals, onSaveGoals,
                          expectedIncome, setExpectedIncome, onSaveRule, onDeleteRule, onDeleteBillForMonth,
                          onUpdateBillForMonth, allMonthBills, showToast, onClose}) {
  const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const dateLabel = new Date(year, month, day).toLocaleDateString('en-CA', {weekday:'long', month:'long', day:'numeric'});

  const [addingIncome, setAddingIncome] = useState(false);
  const [newIncAmount, setNewIncAmount] = useState('');
  const [newIncSource, setNewIncSource] = useState('');
  const [newIncAccount, setNewIncAccount] = useState('');

  const [addingBill, setAddingBill] = useState(false);
  const [newBillLabel, setNewBillLabel] = useState('');
  const [newBillAmount, setNewBillAmount] = useState('');

  const [addingDeposit, setAddingDeposit] = useState(false);
  const [depositGoalId, setDepositGoalId] = useState(goals[0]?.id || '');
  const [newDepositAmount, setNewDepositAmount] = useState('');

  const inputStyle = {
    width:'100%', padding:'8px 10px', border:`1px solid ${C.sandDark}`, borderRadius:8,
    background:C.white, color:C.ink, fontFamily:SANS, fontSize:13, outline:'none', boxSizing:'border-box'
  };

  function saveIncome() {
    const amt = parseFloat(newIncAmount);
    if (isNaN(amt) || amt <= 0) { showToast('Enter an amount'); return; }
    const entry = {id:'income-'+Date.now(), date:dateStr, amount:amt, description:newIncSource.trim(), account:newIncAccount.trim(), person:'both'};
    const updated = [...expectedIncome, entry].sort((a,b)=>new Date(a.date)-new Date(b.date));
    setExpectedIncome(updated);
    localStorage.setItem(EXPECTED_INCOME_KEY, JSON.stringify(updated));
    showToast('Income entry added');
    setAddingIncome(false); setNewIncAmount(''); setNewIncSource(''); setNewIncAccount('');
  }

  function updateIncome(id, field, value) {
    const updated = expectedIncome.map(e => e.id === id ? {...e, [field]: field === 'amount' ? (parseFloat(value)||0) : value} : e);
    setExpectedIncome(updated);
    localStorage.setItem(EXPECTED_INCOME_KEY, JSON.stringify(updated));
  }

  function deleteIncome(id) {
    const updated = expectedIncome.filter(e => e.id !== id);
    setExpectedIncome(updated);
    localStorage.setItem(EXPECTED_INCOME_KEY, JSON.stringify(updated));
    showToast('Income entry deleted');
  }

  /** Editing a bill's amount or name from the calendar only affects this
   *  month — same fix as the Bills tab. Amounts genuinely vary month to
   *  month; nothing here should quietly rewrite another month's numbers. */
  async function updateBill(bill, field, value) {
    await onUpdateBillForMonth(bill, {
      amount: field === 'amount' ? (parseFloat(value)||0) : bill.amount,
      label:  field === 'label' ? value : bill.label,
      day:    bill.day,
      category: bill.category,
    });
    showToast('Saved for this month only');
  }

  async function saveNewBill() {
    const amt = parseFloat(newBillAmount);
    if (!newBillLabel.trim() || isNaN(amt) || amt <= 0) { showToast('Enter a name and amount'); return; }
    const key = 'manual:' + uid();
    const label = newBillLabel.trim();
    await onSaveRule({
      key, label, amount: amt, day, category: 'other', status: 'manual',
      recurring: true, payment_type: 'other', frequency: 'monthly',
    });
    // Also seed THIS month's own copy — otherwise, if this month has
    // already been explicitly configured, the new bill would silently not
    // show up here at all (the legacy fallback only covers untouched months).
    await onUpdateBillForMonth({ key }, { amount: amt, label, day, category: 'other' });
    showToast('Bill added');
    setAddingBill(false); setNewBillLabel(''); setNewBillAmount('');
  }

  /** Removes this bill from just the current month, same as the Bills tab —
   *  every other month keeps it as it was. */
  async function removeBill(bill) {
    await onDeleteBillForMonth(bill, allMonthBills || []);
  }

  function saveDeposit() {
    const amt = parseFloat(newDepositAmount);
    if (!depositGoalId || isNaN(amt) || amt <= 0) { showToast('Pick a goal and enter an amount'); return; }
    const updated = goals.map(g => g.id === depositGoalId
      ? {...g, currentBalance: (g.currentBalance||0) + amt, deposits: [...(g.deposits||[]), {id:'dep-'+Date.now(), date:dateStr, amount:amt}]}
      : g);
    onSaveGoals(updated);
    showToast('Deposit added to ' + (goals.find(g=>g.id===depositGoalId)?.label || 'goal'));
    setAddingDeposit(false); setNewDepositAmount('');
  }

  function updateDeposit(goalId, depId, value) {
    const amt = parseFloat(value) || 0;
    const updated = goals.map(g => {
      if (g.id !== goalId) return g;
      const oldDep = (g.deposits||[]).find(d=>d.id===depId);
      const oldAmt = oldDep ? oldDep.amount : 0;
      const newDeposits = (g.deposits||[]).map(d => d.id===depId ? {...d, amount:amt} : d);
      return {...g, deposits:newDeposits, currentBalance: (g.currentBalance||0) - oldAmt + amt};
    });
    onSaveGoals(updated);
  }

  function deleteDeposit(goalId, depId) {
    const updated = goals.map(g => {
      if (g.id !== goalId) return g;
      const oldDep = (g.deposits||[]).find(d=>d.id===depId);
      const oldAmt = oldDep ? oldDep.amount : 0;
      return {...g, deposits:(g.deposits||[]).filter(d=>d.id!==depId), currentBalance: Math.max(0,(g.currentBalance||0) - oldAmt)};
    });
    onSaveGoals(updated);
    showToast('Deposit removed');
  }

  return (
    <div style={{position:'fixed', inset:0, zIndex:770, display:'flex', flexDirection:'column', justifyContent:'flex-end'}}>
      <div onClick={onClose} style={{position:'absolute', inset:0, background:'rgba(26,26,24,0.55)'}}/>
      <div style={{position:'relative', background:C.white, borderRadius:'20px 20px 0 0',
        padding:'22px 20px 34px', animation:'slideUp 0.25s ease', maxHeight:'85dvh', overflowY:'auto'}}>

        <div style={{display:'flex', alignItems:'center', marginBottom:18}}>
          <h2 style={{flex:1, margin:0, fontFamily:SERIF, fontSize:20, fontWeight:600, color:C.ink}}>
            {dateLabel}
          </h2>
          <button onClick={onClose} style={{border:'none', background:'none', padding:6, cursor:'pointer'}}>
            <X size={20} color={C.inkSoft}/>
          </button>
        </div>

        {/* ACTUAL INCOME — read-only here; edit/delete lives on Home's Actual
            Income drill-down or the Spending category view, so there's one
            place that owns each kind of edit, not two disagreeing ones */}
        {actualEntries && actualEntries.length > 0 && (
          <div style={{marginBottom:20}}>
            <p style={{margin:'0 0 8px', fontSize:11, fontWeight:600, color:C.green, fontFamily:SANS, textTransform:'uppercase', letterSpacing:'0.06em'}}>
              💵 Actual income (landed)
            </p>
            {actualEntries.map(tx => (
              <div key={tx.id} style={{display:'flex', alignItems:'center', gap:8, padding:'6px 0', borderBottom:`1px solid ${C.sandMid}`}}>
                <span style={{flex:1, fontSize:13, color:C.ink, fontFamily:SANS, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                  {tx.note || tx.description || 'Deposit'}
                </span>
                <span style={{fontFamily:SERIF, fontSize:13, fontWeight:600, color:C.green}}>+{fmt(tx.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {/* PREDICTED INCOME */}
        <div style={{marginBottom:20}}>
          <p style={{margin:'0 0 8px', fontSize:11, fontWeight:600, color:C.blue, fontFamily:SANS, textTransform:'uppercase', letterSpacing:'0.06em'}}>
            💰 Predicted income
          </p>
          {incomeEntries.length === 0 && !addingIncome && (
            <p style={{margin:'0 0 8px', fontSize:12, color:C.inkSoft, fontFamily:SANS, fontStyle:'italic'}}>Nothing predicted this day</p>
          )}
          {incomeEntries.map(inc => (
            <div key={inc.id} style={{display:'flex', alignItems:'center', gap:6, padding:'6px 0', borderBottom:`1px solid ${C.sandMid}`}}>
              <input defaultValue={inc.description} placeholder="Source"
                onBlur={e=>updateIncome(inc.id,'description',e.target.value)}
                style={{...inputStyle, flex:1.4}}/>
              <input defaultValue={inc.account} placeholder="Account"
                onBlur={e=>updateIncome(inc.id,'account',e.target.value)}
                style={{...inputStyle, flex:1}}/>
              <span style={{fontFamily:SERIF, fontSize:13, color:C.inkSoft}}>$</span>
              <input type="number" defaultValue={inc.amount} placeholder="0.00"
                onBlur={e=>updateIncome(inc.id,'amount',e.target.value)}
                style={{...inputStyle, width:70, flex:'none'}}/>
              <button onClick={()=>deleteIncome(inc.id)} style={{border:'none', background:C.red+'20', color:C.red,
                borderRadius:6, padding:'6px 8px', cursor:'pointer', fontSize:11}}>🗑️</button>
            </div>
          ))}
          {addingIncome ? (
            <div style={{background:C.sand, borderRadius:10, padding:10, marginTop:8}}>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:6}}>
                <input placeholder="Source (e.g. NORR)" value={newIncSource} onChange={e=>setNewIncSource(e.target.value)} style={inputStyle}/>
                <input placeholder="Account" value={newIncAccount} onChange={e=>setNewIncAccount(e.target.value)} style={inputStyle}/>
              </div>
              <div style={{display:'flex', gap:6}}>
                <input type="number" placeholder="Amount" value={newIncAmount} onChange={e=>setNewIncAmount(e.target.value)} style={inputStyle}/>
                <button onClick={saveIncome} style={{border:'none', background:C.blue, color:'white', borderRadius:8, padding:'0 14px', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:SANS}}>Save</button>
                <button onClick={()=>setAddingIncome(false)} style={{border:`1px solid ${C.sandDark}`, background:'white', color:C.ink, borderRadius:8, padding:'0 12px', fontSize:12, cursor:'pointer', fontFamily:SANS}}>×</button>
              </div>
            </div>
          ) : (
            <button onClick={()=>setAddingIncome(true)} style={{width:'100%', marginTop:6, padding:'8px', border:`1px dashed ${C.blue}55`,
              borderRadius:8, background:'none', color:C.blue, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:SANS}}>
              + Add predicted income for this day
            </button>
          )}
        </div>

        {/* BILLS DUE */}
        <div style={{marginBottom:20}}>
          <p style={{margin:'0 0 8px', fontSize:11, fontWeight:600, color:C.red, fontFamily:SANS, textTransform:'uppercase', letterSpacing:'0.06em'}}>
            📋 Bills due
          </p>
          {bills.length === 0 && !addingBill && (
            <p style={{margin:'0 0 8px', fontSize:12, color:C.inkSoft, fontFamily:SANS, fontStyle:'italic'}}>No bills due this day</p>
          )}
          {bills.map(bill => (
            <div key={bill.key} style={{display:'flex', alignItems:'center', gap:6, padding:'6px 0', borderBottom:`1px solid ${C.sandMid}`}}>
              <input defaultValue={bill.label} onBlur={e=>{if(e.target.value.trim() && e.target.value!==bill.label) updateBill(bill,'label',e.target.value);}}
                style={{...inputStyle, flex:1.4}}/>
              <span style={{fontFamily:SERIF, fontSize:13, color:C.inkSoft}}>$</span>
              <input type="number" defaultValue={bill.amount} onBlur={e=>{const v=parseFloat(e.target.value); if(!isNaN(v) && v!==bill.amount) updateBill(bill,'amount',e.target.value);}}
                style={{...inputStyle, width:80, flex:'none'}}/>
              <button onClick={()=>removeBill(bill)} style={{border:'none', background:C.red+'20', color:C.red,
                borderRadius:6, padding:'6px 8px', cursor:'pointer', fontSize:11}}>🗑️</button>
            </div>
          ))}
          {addingBill ? (
            <div style={{background:C.sand, borderRadius:10, padding:10, marginTop:8}}>
              <div style={{display:'flex', gap:6}}>
                <input placeholder="Bill name" value={newBillLabel} onChange={e=>setNewBillLabel(e.target.value)} style={{...inputStyle, flex:1.4}}/>
                <input type="number" placeholder="Amount" value={newBillAmount} onChange={e=>setNewBillAmount(e.target.value)} style={{...inputStyle, width:80, flex:'none'}}/>
              </div>
              <div style={{display:'flex', gap:6, marginTop:6}}>
                <button onClick={saveNewBill} style={{border:'none', background:C.red, color:'white', borderRadius:8, padding:'8px 14px', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:SANS, flex:1}}>Save bill</button>
                <button onClick={()=>setAddingBill(false)} style={{border:`1px solid ${C.sandDark}`, background:'white', color:C.ink, borderRadius:8, padding:'8px 12px', fontSize:12, cursor:'pointer', fontFamily:SANS}}>×</button>
              </div>
            </div>
          ) : (
            <button onClick={()=>setAddingBill(true)} style={{width:'100%', marginTop:6, padding:'8px', border:`1px dashed ${C.red}55`,
              borderRadius:8, background:'none', color:C.red, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:SANS}}>
              + Add a bill due this day
            </button>
          )}
        </div>

        {/* GOAL DEPOSITS */}
        <div>
          <p style={{margin:'0 0 8px', fontSize:11, fontWeight:600, color:C.purple, fontFamily:SANS, textTransform:'uppercase', letterSpacing:'0.06em'}}>
            🎯 Goal deposits
          </p>
          {deposits.length === 0 && !addingDeposit && (
            <p style={{margin:'0 0 8px', fontSize:12, color:C.inkSoft, fontFamily:SANS, fontStyle:'italic'}}>No goal deposits this day</p>
          )}
          {deposits.map(dep => (
            <div key={dep.id} style={{display:'flex', alignItems:'center', gap:6, padding:'6px 0', borderBottom:`1px solid ${C.sandMid}`}}>
              <span style={{flex:1.4, fontSize:13, color:C.ink, fontFamily:SANS, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                {dep.goalLabel}
              </span>
              <span style={{fontFamily:SERIF, fontSize:13, color:C.inkSoft}}>$</span>
              <input type="number" defaultValue={dep.amount}
                onBlur={e=>{const v=parseFloat(e.target.value); if(!isNaN(v) && v!==dep.amount) updateDeposit(dep.goalId, dep.id, e.target.value);}}
                style={{...inputStyle, width:80, flex:'none'}}/>
              <button onClick={()=>deleteDeposit(dep.goalId, dep.id)} style={{border:'none', background:C.red+'20', color:C.red,
                borderRadius:6, padding:'6px 8px', cursor:'pointer', fontSize:11}}>🗑️</button>
            </div>
          ))}
          {goals.length > 0 && (addingDeposit ? (
            <div style={{background:C.sand, borderRadius:10, padding:10, marginTop:8}}>
              <div style={{display:'flex', gap:6}}>
                <select value={depositGoalId} onChange={e=>setDepositGoalId(e.target.value)} style={{...inputStyle, flex:1.4}}>
                  {goals.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                </select>
                <input type="number" placeholder="Amount" value={newDepositAmount} onChange={e=>setNewDepositAmount(e.target.value)} style={{...inputStyle, width:80, flex:'none'}}/>
              </div>
              <div style={{display:'flex', gap:6, marginTop:6}}>
                <button onClick={saveDeposit} style={{border:'none', background:C.purple, color:'white', borderRadius:8, padding:'8px 14px', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:SANS, flex:1}}>Save deposit</button>
                <button onClick={()=>setAddingDeposit(false)} style={{border:`1px solid ${C.sandDark}`, background:'white', color:C.ink, borderRadius:8, padding:'8px 12px', fontSize:12, cursor:'pointer', fontFamily:SANS}}>×</button>
              </div>
            </div>
          ) : (
            <button onClick={()=>setAddingDeposit(true)} style={{width:'100%', marginTop:6, padding:'8px', border:`1px dashed ${C.purple}55`,
              borderRadius:8, background:'none', color:C.purple, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:SANS}}>
              + Add a goal deposit for this day
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── BILLS TAB ────────────────────────────────────────────────────────────────
export function BillsTab({history, txns, bankImports, allCats, year, month,
                          billRules, onSaveRule, onDeleteRule, showToast, billsLocal,
                          billPayments, allBillPayments, onTogglePaid, profile, setTab,
                          billActiveKeys, billConfiguredMonths, onDeleteBillForMonth, onConfigureMonth,
                          onUpdateBillForMonth, onConfirmSuggestedBill}) {
  const [editing, setEditing] = useState(undefined);   // undefined = closed, null = new

  const detected = detectRecurring(history || []);
  // Suggestions ("might be bills") are patterns noticed in your statements —
  // unaffected by any month's active/excluded list, since confirming one is
  // how it gets added to a month in the first place.
  const allBillsUnscoped = applyBillRules(detected, billRules || []);
  const suggested = allBillsUnscoped.filter(b => b.confidence !== 'high');

  // What's actually on for THIS month specifically.
  const thisMonthIsConfigured = (billConfiguredMonths || new Set()).has(`${year}|${month}`);
  const bills = applyBillRules(detected, billRules || [], billActiveKeys || new Map(), billConfiguredMonths || new Set(), year, month);
  const confirmed = bills.filter(b => b.confidence === 'high');
  const sched      = buildSchedule(confirmed, [...txns, ...bankImports], year, month,
                       new Date(), billPayments || []);
  const weekTotal  = sched.dueThisWeek.reduce((a, e) => a + e.amount, 0);

  // Bills from a past month that were never paid — these don't reset when the
  // month changes, they stay overdue until someone closes them out.
  const carriedOver = getCarriedOverBills(confirmed, history || [], allBillPayments || [], year, month);
  const carriedOverTotal = carriedOver.reduce((a,e)=>a+e.amount,0);

  // If a bill is still overdue from a prior month AND this month's instance
  // has already come due too, that's worth a second look — could be a missed
  // payment, or it could be about to double-charge.
  const thisMonthActiveKeys = new Set(
    sched.entries.filter(e => e.status === 'due' || e.status === 'overdue').map(e => e.key)
  );
  const needsReview = carriedOver.filter(e => thisMonthActiveKeys.has(e.key));

  /** Saving a bill's details (amount, label, day, category) only ever
   *  affects the month you're looking at — amounts genuinely change month
   *  to month, so nothing here should quietly rewrite another month's
   *  numbers. Adding a brand-new manual bill is the one exception: it also
   *  needs a starting default recorded globally, since a manual bill has no
   *  detection pattern to fall back on for months no one has touched yet. */
  async function saveRule(rule) {
    if (editing === null) {
      // Brand new manual bill
      await onSaveRule({ key: rule.key, label: rule.label, amount: rule.amount,
        day: rule.day, category: rule.category, status: 'manual',
        recurring: true, payment_type: 'other', frequency: 'monthly' });
      await onUpdateBillForMonth(rule, { amount: rule.amount, label: rule.label, day: rule.day, category: rule.category });
    } else {
      await onUpdateBillForMonth(editing, { amount: rule.amount, label: rule.label, day: rule.day, category: rule.category });
      if (rule.label !== editing.label) {
        await onSaveRule({ key: rule.key, label: rule.label, status: editing.manual ? 'manual' : 'confirmed' });
      }
    }
    setEditing(undefined);
  }

  /** The default "delete" — removes this bill from THIS month only. Every
   *  other month, past or future, keeps it exactly as it was. This is what
   *  fixes deleting a bill wiping it out everywhere. */
  async function removeRule(bill) {
    await onDeleteBillForMonth(bill, confirmed);
    setEditing(undefined);
  }

  /** The rare, explicit "actually delete this everywhere" — a manual bill's
   *  row disappears for good; an auto-detected pattern stops being tracked
   *  as a bill at all, in any month, though the real transactions behind it
   *  are never touched. */
  async function removeRuleEverywhere(bill) {
    if (bill.manual) {
      await onDeleteRule(bill.key);
      showToast(`Deleted "${bill.label}" everywhere`);
    } else {
      await onSaveRule({ key: bill.key, status: 'hidden', label: bill.label });
      showToast(`Removed "${bill.label}" from every month`);
    }
    setEditing(undefined);
  }

  const STATUS = {
    overdue: { label:'OVERDUE',  color:C.red   },
    due:     { label:'UPCOMING', color:C.blue  },
    paid:    { label:'CHARGED',  color:C.green },
  };

  const Row = ({ e, onTap }) => {
    const c    = allCats.find(x => x.id === e.category) || { icon:'Package', color:C.inkSoft };
    const st   = STATUS[e.status] || STATUS.due;
    const done = e.status === 'paid';
    const lockedByData = e.seenInData;   // came from a statement, cannot be un-ticked
    const carried = e.carriedFrom;       // {year, month} if this is an overdue bill rolled forward

    return (
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px 12px 12px' }}>
        {/* Tick it off yourself — for a carried-over bill this closes out the
            month it was actually due in, not the one you're viewing */}
        <button
          onClick={() => { if (!lockedByData) onTogglePaid(e, !done, carried?.year, carried?.month); }}
          disabled={lockedByData}
          title={lockedByData
            ? 'Already matched to a transaction in your statements'
            : carried ? 'Mark complete' : done ? 'Mark as not paid' : 'Mark as paid'}
          style={{ border:'none', background:'none', padding:4, flexShrink:0,
            cursor: lockedByData ? 'default' : 'pointer' }}>
          <div style={{ width:22, height:22, borderRadius:6,
            border:`1.5px solid ${done ? C.green : carried ? C.red : C.sandDark}`,
            background: done ? C.green : 'transparent',
            opacity: lockedByData ? 0.55 : 1,
            display:'flex', alignItems:'center', justifyContent:'center' }}>
            {done && <Check size={13} color="#fff" strokeWidth={3}/>}
          </div>
        </button>

        <button onClick={onTap} style={{ display:'flex', alignItems:'center', gap:11,
          flex:1, minWidth:0, border:'none', background:'none',
          cursor:'pointer', textAlign:'left', padding:0 }}>
          <div style={{ width:32, height:32, borderRadius:9, background:c.color+'18',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
            opacity: done ? 0.5 : 1 }}>
            <CatIcon name={c.icon} size={15} color={c.color}/>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ margin:0, fontSize:14, fontFamily:SANS,
              color: done ? C.inkSoft : C.ink,
              textDecoration: done ? 'line-through' : 'none',
              textDecorationColor: done ? C.green : 'transparent',
              textDecorationThickness: '1.5px',
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {e.label}
              {e.edited && <span style={{ marginLeft:6, fontSize:9, fontWeight:700,
                color:C.inkSoft, letterSpacing:'0.04em' }}>EDITED</span>}
            </p>
            <p style={{ margin:'2px 0 0', fontSize:11, fontFamily:SANS,
              color: e.status === 'overdue' ? C.red : done ? C.green : C.inkSoft }}>
              {carried
                ? `overdue from ${MONTHS[carried.month]} ${carried.year}`
                : e.manualOnly
                ? `ticked off by ${e.tickedBy || 'someone'}`
                : e.seenInData
                ? 'matched in your statements'
                : <>
                    {e.date
                      ? e.date.toLocaleDateString('en-CA', { weekday:'short', month:'short', day:'numeric' })
                      : `around the ${e.day}`}
                    {e.viewingCurrentMonth && e.daysAway != null ? ' · ' + relativeDay(e.daysAway) : ''}
                    {e.varies ? ' · varies' : ''}
                  </>}
            </p>
          </div>
          <div style={{ textAlign:'right', flexShrink:0 }}>
            <p style={{ margin:0, fontFamily:SERIF, fontSize:17, fontWeight:600,
              color: done ? C.inkSoft : C.ink,
              textDecoration: done ? 'line-through' : 'none' }}>{fmt(e.amount)}</p>
            <span style={{ fontSize:9, fontWeight:700, letterSpacing:'0.06em',
              color:st.color, fontFamily:SANS }}>{st.label}</span>
          </div>
          <ChevronRight size={14} color={C.sandDark} style={{ flexShrink:0 }}/>
        </button>
      </div>
    );
  };

  const Section = ({ title, items, note }) => items.length === 0 ? null : (
    <>
      <SL>{title}</SL>
      {note && <p style={{ margin:'-4px 2px 8px', fontSize:11, color:C.inkSoft,
        fontFamily:SANS, lineHeight:1.6 }}>{note}</p>}
      <Card style={{ padding:'4px 0' }}>
        {items.map((e, i) => (
          <div key={e.key}>{i > 0 && <Divider/>}
            <Row e={e} onTap={() => setEditing(e)}/>
          </div>
        ))}
      </Card>
    </>
  );

  const AddButton = () => (
    <button onClick={() => setEditing(null)}
      style={{ width:'100%', border:`1.5px dashed ${C.sandDark}`, borderRadius:12,
        padding:'13px', background:'none', cursor:'pointer', fontFamily:SANS,
        fontSize:14, fontWeight:600, color:C.inkSoft, marginBottom:16,
        display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
      <Plus size={15} color={C.inkSoft}/> Add a bill manually
    </button>
  );

  return (
    <div style={{ padding:'16px 16px 0' }}>
      <Card style={{ background:C.green, padding:'20px 20px' }}>
        <p style={{ fontSize:11, color:'rgba(255,255,255,0.7)', textTransform:'uppercase',
          letterSpacing:'0.1em', margin:'0 0 4px', fontFamily:SANS }}>
          Still to be paid in {MONTHS[month]}
        </p>
        <p style={{ fontFamily:SERIF, fontSize:40, fontWeight:600, color:'#fff',
          margin:'0 0 14px', letterSpacing:'-0.02em', lineHeight:1 }}>
          {fmt(sched.outstandingTotal + carriedOverTotal)}
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
          {[['Next 7 days', fmt(weekTotal)],
            ['Already paid', fmt(sched.paidTotal)],
            ['Whole month', fmt(sched.monthTotal)]].map(([l, v]) => (
            <div key={l}>
              <p style={{ margin:0, fontSize:10, color:'rgba(255,255,255,0.65)',
                textTransform:'uppercase', letterSpacing:'0.08em', fontFamily:SANS }}>{l}</p>
              <p style={{ margin:0, fontFamily:SERIF, fontSize:17, fontWeight:600,
                color:'rgba(255,255,255,0.95)' }}>{v}</p>
            </div>
          ))}
        </div>
        {carriedOverTotal > 0 && (
          <p style={{ margin:'12px 0 0', fontSize:11, color:'rgba(255,255,255,0.75)',
            fontFamily:SANS, borderTop:'1px solid rgba(255,255,255,0.2)', paddingTop:10 }}>
            Includes {fmt(carriedOverTotal)} still owed from earlier months
          </p>
        )}
        <p style={{ margin:'10px 0 0', fontSize:11, color:'rgba(255,255,255,0.65)', fontFamily:SANS }}>
          Once a bill is actually charged, it shows up as regular spending too — see{' '}
          {setTab ? (
            <button onClick={()=>setTab('spending')} style={{border:'none', background:'none', padding:0,
              color:'#fff', fontWeight:700, cursor:'pointer', fontFamily:SANS, fontSize:11, textDecoration:'underline'}}>
              Spending
            </button>
          ) : 'Spending'}.
        </p>
      </Card>

      {!thisMonthIsConfigured && confirmed.length > 0 && (
        <div style={{ background:C.blue+'0d', border:`1px solid ${C.blue}33`, borderRadius:14,
          padding:'14px 16px', marginBottom:12 }}>
          <p style={{ margin:'0 0 4px', fontSize:13, fontWeight:700, color:C.blue, fontFamily:SANS }}>
            New month — keep these {confirmed.length} bill{confirmed.length===1?'':'s'}, or start fresh?
          </p>
          <p style={{ margin:'0 0 10px', fontSize:12, color:C.inkMid, fontFamily:SANS, lineHeight:1.6 }}>
            {MONTHS[month]} hasn't been set up yet. Bills from previous months are showing for now —
            asking just this once so you can decide before charges start rolling in.
          </p>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={()=>onConfigureMonth('empty', [])} style={{
              flex:1, border:`1px solid ${C.sandDark}`, background:'white', color:C.ink,
              padding:'10px', borderRadius:10, fontWeight:600, fontSize:12, fontFamily:SANS, cursor:'pointer' }}>
              Start {MONTHS[month]} empty
            </button>
            <button onClick={()=>onConfigureMonth('copy', confirmed)} style={{
              flex:1, border:'none', background:C.blue, color:'white',
              padding:'10px', borderRadius:10, fontWeight:600, fontSize:12, fontFamily:SANS, cursor:'pointer' }}>
              Keep these bills
            </button>
          </div>
        </div>
      )}

      {billsLocal && (
        <div style={{ background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:14,
          padding:'12px 16px', marginBottom:12 }}>
          <p style={{ margin:'0 0 4px', fontSize:13, fontWeight:700,
            color:C.amber, fontFamily:SANS }}>
            Bill edits are saved on this device only
          </p>
          <p style={{ margin:'0 0 8px', fontSize:12, color:'#92400e',
            fontFamily:SANS, lineHeight:1.6 }}>
            Everything here works, including ticking bills off, but your partner will
            not see it until these tables exist. Run this once in Supabase → SQL
            Editor, then reload — anything already saved is uploaded automatically.
          </p>
          <pre style={{ margin:0, background:'rgba(0,0,0,0.06)', borderRadius:8,
            padding:'10px 12px', fontSize:10, lineHeight:1.6, color:'#92400e',
            overflowX:'auto', fontFamily:'monospace' }}>{`create table if not exists bill_rules (
  key text primary key, label text, amount numeric,
  day int, category text,
  status text default 'auto',
  updated_at timestamptz default now()
);
alter table bill_rules enable row level security;
create policy "allow all on bill_rules" on bill_rules
  for all using (true) with check (true);

create table if not exists bill_payments (
  id text primary key, key text, year int, month int,
  label text, paid_by text,
  paid_at timestamptz default now()
);
alter table bill_payments enable row level security;
create policy "allow all on bill_payments" on bill_payments
  for all using (true) with check (true);`}</pre>
        </div>
      )}

      {needsReview.length > 0 && (
        <div style={{ background:'#fffbeb', border:`1px solid ${C.amber}55`, borderRadius:14,
          padding:'12px 16px', marginBottom:12, display:'flex', gap:10, alignItems:'flex-start' }}>
          <AlertCircle size={17} color={C.amber} style={{ flexShrink:0, marginTop:1 }}/>
          <div>
            <p style={{ margin:0, fontSize:12, color:'#92400e', fontFamily:SANS, lineHeight:1.6 }}>
              <b style={{ color:C.amber }}>
                {needsReview.length === 1 ? 'This needs a check' : `${needsReview.length} bills need a check`}:
              </b>{' '}
              {needsReview.map(e => e.label).join(', ')} — there's still an unpaid bill from
              a previous month AND a new one due this month. Make sure last month's charge
              wasn't missed, or that this isn't about to double-charge.
            </p>
          </div>
        </div>
      )}

      {sched.overdue.length > 0 && (
        <div style={{ background:C.redLight, border:`1px solid ${C.red}33`, borderRadius:14,
          padding:'12px 16px', marginBottom:12, display:'flex', gap:10, alignItems:'flex-start' }}>
          <AlertCircle size={17} color={C.red} style={{ flexShrink:0, marginTop:1 }}/>
          <p style={{ margin:0, fontSize:12, color:'#9b2c2c', fontFamily:SANS, lineHeight:1.6 }}>
            <b style={{ color:C.red }}>
              {sched.overdue.length} bill{sched.overdue.length === 1 ? '' : 's'} past the usual date.
            </b>{' '}
            Either the charge is late, or the statement covering it has not been uploaded yet.
          </p>
        </div>
      )}

      <Section title="Overdue from earlier months"
        items={carriedOver}
        note={carriedOver.length > 0 ? "These stay here — untouched — until you mark them complete. They don't reset just because the month changed." : null}/>
      <Section title="Past the usual date"
        items={sched.entries.filter(e => e.status === 'overdue')}/>
      <Section title="Coming up"
        items={sched.entries.filter(e => e.status === 'due')}
        note={weekTotal > 0 ? `${fmt(weekTotal)} of this lands within seven days.` : null}/>
      <Section title="Paid this month"
        items={sched.entries.filter(e => e.status === 'paid')}
        note="Ticked off by either of you, or matched to a transaction in an uploaded statement."/>

      {confirmed.length === 0 && (
        <Card style={{ textAlign:'center', padding:'32px 24px' }}>
          <CalendarDays size={36} color={C.sandDark} style={{ marginBottom:10 }}/>
          <p style={{ fontFamily:SERIF, fontSize:19, color:C.inkMid, margin:'0 0 6px' }}>
            No bills yet
          </p>
          <p style={{ fontSize:13, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6, margin:0 }}>
            Upload two or more months and anything charged regularly appears here on
            its own. You can also add a bill by hand.
          </p>
        </Card>
      )}

      <AddButton/>

      {suggested.length > 0 && (
        <>
          <SL>Might be bills</SL>
          <p style={{ margin:'-4px 2px 8px', fontSize:11, color:C.inkSoft,
            fontFamily:SANS, lineHeight:1.6 }}>
            These repeat month to month but the amount or date moves around, so they
            could equally be a shop you visit often. Tap to confirm one as a bill, or
            hide it.
          </p>
          <Card style={{ padding:'4px 0' }}>
            {suggested.map((b, i) => (
              <div key={b.key}>{i > 0 && <Divider/>}
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 18px' }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:0, fontSize:13, color:C.ink, fontFamily:SANS,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {b.label}
                    </p>
                    <p style={{ margin:'1px 0 0', fontSize:10, color:C.inkSoft, fontFamily:SANS }}>
                      seen in {b.monthsSeen} months · around the {b.day}
                      {b.varies ? ' · amount varies' : ''}
                    </p>
                  </div>
                  <span style={{ fontFamily:SERIF, fontSize:15, fontWeight:600, color:C.inkMid }}>
                    {fmt(b.amount)}
                  </span>
                  <button onClick={() => onConfirmSuggestedBill(b)}
                    style={{ border:'none', borderRadius:8, padding:'6px 11px',
                      background:C.green, color:'#fff', fontSize:11, fontWeight:700,
                      cursor:'pointer', fontFamily:SANS, flexShrink:0 }}>
                    It's a bill
                  </button>
                  <button onClick={() => removeRule(b)}
                    style={{ border:`1px solid ${C.sandDark}`, borderRadius:8,
                      padding:'6px 9px', background:C.white, fontSize:11,
                      color:C.inkSoft, cursor:'pointer', fontFamily:SANS, flexShrink:0 }}>
                    Hide
                  </button>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      <p style={{ fontSize:11, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6,
        padding:'0 4px', marginBottom:20 }}>
        Bills are found in your statements, then whatever you change here wins.
        Tap any bill to rename it, correct the amount or date, or remove it.
      </p>

      {editing !== undefined && (
        <BillEditModal bill={editing} allCats={allCats}
          onSave={saveRule} onDelete={removeRule} onDeleteEverywhere={removeRuleEverywhere}
          onClose={() => setEditing(undefined)}/>
      )}
    </div>
  );
}

// ─── CHARTS TAB ───────────────────────────────────────────────────────────────
// ─── GOALS TAB ────────────────────────────────────────────────────────────
export function GoalsTab({txns, bankImports, billPayments, billRules, profile}) {
  const allTx = [...txns, ...bankImports];
  const spent = allTx.reduce((a, t) => a + Math.abs(t.amount || 0), 0);
  const paidBillsThisMonth = billPayments?.length || 0;
  const totalBills = billRules?.length || 0;
  
  const messages = [
    paidBillsThisMonth > 0 && `Great job! You've paid ${paidBillsThisMonth} bill${paidBillsThisMonth > 1 ? 's' : ''} this month.`,
    paidBillsThisMonth === totalBills && totalBills > 0 && `🎉 All bills are paid! You're crushing it!`,
    spent < 500 && `💰 You've been mindful with spending. Keep it up!`,
    spent > 2000 && `📊 High spending month — good time to review where the money went.`,
    profile && `Keep going, ${profile.name.split(' ')[0]}! Every dollar saved adds up.`,
  ].filter(Boolean);
  
  const message = messages[0] || `You're doing great! Keep tracking your finances.`;
  
  return (
    <div style={{padding:'16px'}}>
      <Card style={{textAlign:'center',padding:'24px 16px',marginBottom:16}}>
        <h2 style={{margin:'0 0 8px',fontFamily:SERIF,fontSize:26,fontWeight:600,color:C.ink}}>
          💚 {message.split('!')[0]}!
        </h2>
        <p style={{margin:'8px 0 0',fontSize:14,color:C.inkMid,fontFamily:SANS}}>
          {paidBillsThisMonth === totalBills && totalBills > 0 
            ? 'All bills handled. Now focus on smart spending.' 
            : 'Keep building better habits.'}
        </p>
      </Card>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <Card style={{textAlign:'center',padding:'16px'}}>
          <p style={{margin:0,fontSize:11,color:C.inkSoft,fontFamily:SANS,textTransform:'uppercase',letterSpacing:'0.08em'}}>
            Bills Paid
          </p>
          <p style={{margin:'6px 0 0',fontFamily:SERIF,fontSize:28,fontWeight:600,color:C.green}}>
            {paidBillsThisMonth}/{totalBills}
          </p>
        </Card>
        <Card style={{textAlign:'center',padding:'16px'}}>
          <p style={{margin:0,fontSize:11,color:C.inkSoft,fontFamily:SANS,textTransform:'uppercase',letterSpacing:'0.08em'}}>
            Total Spent
          </p>
          <p style={{margin:'6px 0 0',fontFamily:SERIF,fontSize:28,fontWeight:600,color:spent > 2000 ? C.amber : C.green}}>
            ${spent.toLocaleString('en-CA',{maximumFractionDigits:0})}
          </p>
        </Card>
      </div>

      <Card style={{padding:'16px'}}>
        <p style={{margin:'0 0 12px',fontSize:13,fontWeight:600,color:C.ink,fontFamily:SANS}}>
          💡 Tips for Success
        </p>
        <ul style={{margin:0,paddingLeft:20,fontSize:13,color:C.inkMid,fontFamily:SANS,lineHeight:1.8}}>
          <li>Review your bills monthly and mark them as paid</li>
          <li>Watch for unusual spending patterns</li>
          <li>Celebrate small wins — every bill paid is progress</li>
          <li>Use quick-add to log expenses immediately</li>
          <li>Share goals with your partner for accountability</li>
        </ul>
      </Card>
    </div>
  );
}

export function ChartsTab({txns,bankImports,allCats,year,month,personView,profile}) {
  const me=firstName(profile?.name);
  const [view,setView]=useState('month'); // 'month' | 'year'
  const [annualData,setAnnualData]=useState([]);
  const [annualLoaded,setAnnualLoaded]=useState(false);

  useEffect(()=>{
    getAllBankImports().then(data=>{setAnnualData(data);setAnnualLoaded(true);}).catch(()=>{setAnnualLoaded(true);});
  },[]);

  // Monthly data
  const allTx=(personView==='mine'
    ? [...txns,...bankImports].filter(t=>!firstName(t.who)||firstName(t.who)===me)
    : [...txns,...bankImports]);
  const excludedIds=new Set([...ALWAYS_EXCLUDED_CATS, ...allCats.filter(c=>c.excluded).map(c=>c.id)]);
  const monthly={};
  allTx.forEach(t=>{const k=t.category||t.cat;
    if(k&&k!=='_skip'&&!excludedIds.has(k))monthly[k]=(monthly[k]||0)+t.amount;});
  const monthlyTotal=Object.values(monthly).reduce((a,b)=>a+b,0);
  const monthlySlices=allCats
    .map(c=>({id:c.id,label:c.label,color:c.color,value:monthly[c.id]||0}))
    .filter(d=>d.value>0)
    .sort((a,b)=>b.value-a.value);

  // Annual data
  const annual={};
  annualData.forEach(({category,amount})=>{
    if(category&&category!=='_skip'&&!excludedIds.has(category))
      annual[category]=(annual[category]||0)+amount;});
  const annualTotal=Object.values(annual).reduce((a,b)=>a+b,0);
  const annualSlices=allCats
    .map(c=>({id:c.id,label:c.label,color:c.color,value:annual[c.id]||0}))
    .filter(d=>d.value>0)
    .sort((a,b)=>b.value-a.value);

  // Monthly breakdown from annual
  const byMonth={};
  annualData.filter(d=>d.year===year&&!excludedIds.has(d.category))
    .forEach(({month:m,amount})=>{ byMonth[m]=(byMonth[m]||0)+amount; });

  const slices  = view==='month' ? monthlySlices  : annualSlices;
  const total   = view==='month' ? monthlyTotal   : annualTotal;
  const title   = view==='month' ? `${MONTHS[month]} spending` : `${year} total (from statements)`;

  return (
    <div style={{padding:'16px 16px 0'}}>
      {/* View toggle */}
      <div style={{display:'flex',background:C.sandMid,borderRadius:12,padding:3,marginBottom:16}}>
        {[['month','This month'],['year','Full year']].map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)} style={{flex:1,border:'none',borderRadius:9,
            padding:'9px 0',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:SANS,
            background:view===k?C.white:'transparent',color:view===k?C.ink:C.inkSoft,
            boxShadow:view===k?'0 1px 3px rgba(0,0,0,0.1)':'none'}}>{l}</button>
        ))}
      </div>

      {/* Donut chart */}
      <Card style={{textAlign:'center',padding:'24px 16px'}}>
        <p style={{margin:'0 0 16px',fontSize:12,color:C.inkSoft,textTransform:'uppercase',
          letterSpacing:'0.1em',fontFamily:SANS}}>{title}</p>
        {slices.length===0?(
          <div style={{padding:'32px 0',color:C.inkSoft}}>
            <PieChart size={40} color={C.sandDark} style={{marginBottom:12}}/>
            <p style={{fontFamily:SERIF,fontSize:18,color:C.inkMid}}>No data yet</p>
            <p style={{fontSize:13,marginTop:4,fontFamily:SANS}}>Upload bank statements to see your spending breakdown</p>
          </div>
        ):(
          <>
            <div style={{display:'flex',justifyContent:'center',marginBottom:20}}>
              <DonutChart data={slices} total={total} size={200}/>
            </div>
            {/* Legend */}
            <div style={{textAlign:'left'}}>
              {slices.map(d=>{
                const pct=((d.value/total)*100).toFixed(1);
                return (
                  <div key={d.id} style={{display:'flex',alignItems:'center',gap:10,
                    padding:'7px 0',borderBottom:`1px solid ${C.sandMid}`}}>
                    <div style={{width:10,height:10,borderRadius:3,background:d.color,flexShrink:0}}/>
                    <span style={{flex:1,fontSize:13,color:C.ink,fontFamily:SANS}}>{d.label}</span>
                    <span style={{fontSize:11,color:C.inkSoft,fontFamily:SANS}}>{pct}%</span>
                    <span style={{fontFamily:SERIF,fontSize:15,fontWeight:600,color:C.ink,
                      minWidth:72,textAlign:'right'}}>{fmt(d.value)}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {/* Monthly bar chart (year view) */}
      {view==='year'&&annualLoaded&&Object.keys(byMonth).length>0&&(
        <Card>
          <p style={{margin:'0 0 12px',fontSize:11,color:C.inkSoft,textTransform:'uppercase',
            letterSpacing:'0.1em',fontFamily:SANS}}>Monthly totals — {year}</p>
          {(() => {
            const maxVal=Math.max(...Object.values(byMonth),1);
            return Array.from({length:12},(_,m)=>{
              const val=byMonth[m]||0;
              const pct=(val/maxVal)*100;
              return (
                <div key={m} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                  <span style={{fontSize:11,color:C.inkSoft,fontFamily:SANS,width:28,flexShrink:0}}>
                    {MONTHS_SHORT[m]}
                  </span>
                  <div style={{flex:1,height:20,background:C.sandMid,borderRadius:4,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${pct}%`,background:C.green,borderRadius:4,
                      transition:'width 0.4s ease'}}/>
                  </div>
                  <span style={{fontFamily:SERIF,fontSize:13,fontWeight:600,color:C.ink,
                    minWidth:64,textAlign:'right'}}>{val>0?fmt(val):'—'}</span>
                </div>
              );
            });
          })()}
        </Card>
      )}
    </div>
  );
}



// ─── UPLOAD TAB v8 ────────────────────────────────────────────────────────────
// One button. No bank picker — the AI reads the statement and works out which
// institution it came from, including documents containing several accounts.
// Pipeline: pick → [processing] → identify (only if unsure) → validate → review → done
export function UploadTab({showToast, onImported, allCats, aiOn, aiDiag, profile, partnerName}) {
  const myFirst = firstName(profile?.name) || 'me';
  const partnerFirst = firstName(partnerName) || 'partner';
  const [who,       setWho]      = useState(myFirst);
  const [step,      setStep]     = useState('pick');
  const [fileType,  setFileType] = useState(null);
  const [parsed,    setParsed]   = useState([]);
  const [edits,     setEdits]    = useState({});
  const [issues,    setIssues]   = useState([]);
  const [autoFixed, setAutoFixed]= useState([]);
  const [answers,   setAnswers]  = useState({});
  const [accounts,  setAccounts] = useState([]);   // detected institutions
  const [askBank,   setAskBank]  = useState(null); // { text } when we must ask
  const [pendingCSV,setPendingCSV]=useState(null); // raw text awaiting bank choice
  const [error,     setError]    = useState(null);
  const [csvFailed, setCsvFailed]= useState(false);
  const [modal,     setModal]    = useState(null);
  const [warnings,  setWarnings] = useState([]);
  const [insight,   setInsight]  = useState(null);
  const [saving,    setSaving]   = useState(false);
  const [imported,  setImported] = useState([]);   // ids actually saved
  const [autoStats, setAutoStats]= useState(null); // what was decided for you

  const tick = () => new Promise(r => setTimeout(r, 50));

  const finalRows = parsed.filter(row => {
    // Internal transfer — excluding it removes BOTH halves of the pair
    const tr = issues.find(i => i.type === 'internal_transfer' &&
      i.pairIds && i.pairIds.includes(row.id));
    if (tr) {
      const ans = answers[tr.id] ?? tr.default;
      if (ans.startsWith('Yes')) return false;
    }
    // E-transfer between the two of you — household money moving, not spending
    const pt = issues.find(i => i.type === 'partner_transfer' && i.row.id === row.id);
    if (pt) {
      const ans = answers[pt.id] ?? pt.default;
      if (ans.startsWith('Yes')) return false;
    }
    // Standalone card payment / transfer with no partner in this batch
    const pay = issues.find(i => i.type === 'card_payment' && i.row.id === row.id);
    if (pay) {
      const ans = answers[pay.id] ?? pay.default;
      if (ans.startsWith('Skip')) return false;
    }
    const dupEx = issues.find(i => i.type === 'duplicate_existing' && i.row.id === row.id);
    if (dupEx) {
      const ans = answers[dupEx.id] ?? dupEx.default;
      if (ans === 'Skip — already imported') return false;
    }
    const dupBatch = issues.find(i =>
      i.type === 'duplicate_in_batch' && (i.secondId === row.id || i.firstId === row.id));
    if (dupBatch) {
      const ans = answers[dupBatch.id] ?? dupBatch.default;
      if (ans === 'Keep first only'  && dupBatch.secondId === row.id) return false;
      if (ans === 'Keep second only' && dupBatch.firstId  === row.id) return false;
    }
    // Income is kept and filed, not discarded — the budget is built from it
    // (the retag itself happens in the .map below)
    const lg = issues.find(i => i.type === 'large_transaction' && i.row.id === row.id);
    if (lg) {
      const ans = answers[lg.id] ?? lg.default;
      if (ans.startsWith('Looks wrong')) return false;
    }
    if (edits[row.id]?.skip) return false;
    return true;
  }).map(row => {
    const cr = issues.find(i => i.type === 'credit_check' && i.row.id === row.id);
    const isIncome = cr && (answers[cr.id] ?? cr.default).startsWith('Yes');
    return {
      ...row,
      category: edits[row.id]?.cat || (isIncome ? 'income' : row.category),
      source:   edits[row.id]?.src || row.source,
      note:     edits[row.id]?.note || row.note || '',
      who,
    };
  });

  const byMonth = {};
  finalRows.forEach(r => {
    const k = MONTHS[r.month] + ' ' + r.year;
    if (!byMonth[k]) byMonth[k] = [];
    byMonth[k].push(r);
  });

  // Which institutions ended up in this batch
  const usedSources = [...new Set(finalRows.map(r => r.source))];

  // ── Shared tail of the pipeline: categorise → validate ──────────────────────
  async function finishPipeline(rawRows) {
    setModal({ title:'Categorising ' + rawRows.length + ' transactions',
      sub:'Matching merchants to your budget categories using your spending history…' });
    await tick();

    const others = rawRows.filter(r => r.category === 'other');
    if (AI_AVAILABLE && others.length > 0) {
      setModal({ title:'Asking Claude to help',
        sub: others.length + ' merchants weren\'t recognised. Getting category suggestions now…' });
      await tick();
      try {
        const aiMap = await aiCategorize(others, allCats.map(c => c.id));
        rawRows.forEach(r => { if (aiMap[r.id]) r.category = aiMap[r.id]; });
      } catch {}
    }

    setModal({ title:'Running smart checks',
      sub:'Checking for duplicates, income transactions, and data anomalies…' });
    await tick();

    let existing = [];
    try { existing = await getAllBankImportsRaw(); } catch {}

    // Cross-check against the other person's already-imported statements:
    // an e-transfer between the two of you is household money moving, not spending.
    const tagged = rawRows.map(r => ({ ...r, who }));
    const partnerIssues = detectPartnerTransfers(tagged, existing);

    const report = buildValidationReport(tagged, existing, partnerIssues);

    // Every issue takes its safe default. Nothing is asked up front: being made
    // to answer a hundred questions before seeing any of your data is not a
    // review, it is an obstacle. The decisions are all listed afterwards and
    // any of them can be changed.
    const defaults = Object.fromEntries(report.all.map(i => [i.id, i.default]));

    setModal({ title: 'Saving ' + tagged.length + ' transactions',
      sub: 'Categorising and filing them. Nothing needs your attention yet.' });
    await tick();

    setParsed(tagged);
    setEdits({});
    setIssues(report.all);
    setAutoFixed(report.autoFixed);
    setAnswers(defaults);

    await importRows(tagged, report.all, defaults);
    setModal(null);
  }

  // ── Entry point ─────────────────────────────────────────────────────────────
  async function runPipeline(file) {
    const isPDF = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    setError(null); setCsvFailed(false); setAccounts([]); setWarnings([]); setInsight(null);
    setFileType(isPDF ? 'pdf' : 'csv');

    if (isPDF) {
      if (aiOn === false) {
        setError('PDF reading needs ANTHROPIC_API_KEY set in your Netlify environment '
          + 'variables. Note: no VITE_ prefix — the key stays on the server. '
          + 'CSV upload works without it.');
        return;
      }
      setModal({ title:'Claude is reading your statement',
        sub:'Working out which bank it is from and pulling the transactions off each page.' });
      await tick();
      try {
        const result = await parsePDFStatement(file, p => {
          // Long documents are read in batches of pages so each request stays
          // well inside the serverless time limit
          setModal(p.batches > 1
            ? { title:`Reading pages ${p.from}–${p.to} of ${p.total}`,
                sub:`Batch ${p.batch} of ${p.batches}. Long statements are read a few pages `
                  + `at a time so nothing times out. Please keep this page open.` }
            : { title:'Claude is reading your statement',
                sub:'Pulling the transactions off each page.' });
        });
        setAccounts(result.accounts || []);
        setWarnings(result.warnings || []);
        if (!result.rows.length) {
          setModal(null);
          setError('Claude read the document but found no transactions in it.');
          return;
        }
        await finishPipeline(result.rows);
      } catch (err) {
        setModal(null);
        setError('Could not read that PDF: ' + err.message);
      }
      return;
    }

    // ── CSV path ──
    setModal({ title:'Reading your statement', sub:'Identifying the bank and extracting transactions…' });
    await tick();
    const text = await file.text().catch(() => null);
    if (!text) { setModal(null); setError('Could not read that file.'); return; }

    const detected = await detectBank(text);

    if (detected.id === 'UNKNOWN') {
      // Genuinely can't tell — this is the only time we bother the user
      setModal(null);
      setPendingCSV(text);
      setAskBank({ preview: text.split(/\r?\n/).slice(0, 4).join(' · ').slice(0, 160) });
      setStep('identify');
      return;
    }

    await parseCSVWith(text, detected);
  }

  async function parseCSVWith(text, detected) {
    setModal({ title:'Reading your statement',
      sub:'Recognised as ' + instLabel(detected.id) + '. Extracting transactions…' });
    await tick();

    const { rows, error: pe, debug } = parseStatementCSV(text, detected.id);
    if (pe || rows.length === 0) {
      setModal(null);
      setCsvFailed(true);
      setError((pe || 'No transactions found in that file.') +
        '\n\nDetected: ' + instLabel(detected.id) +
        ' · Columns: ' + (debug?.headers?.slice(0,5).join(', ') || 'none'));
      return;
    }

    setAccounts([{ key:'csv', institution:detected.id,
      institutionName:instLabel(detected.id), accountLabel:'',
      kind:instKind(detected.id), confidence:detected.confidence,
      how:detected.how }]);
    await finishPipeline(rows);
  }

  /** Which rows survive a given set of answers. */
  function resolve(rows, issueList, ans) {
    const answer = i => ans[i.id] ?? i.default;
    return rows.filter(row => {
      const pt = issueList.find(i => i.type === 'partner_transfer' && i.row.id === row.id);
      if (pt && answer(pt).startsWith('Yes')) return false;
      const tr = issueList.find(i => i.type === 'internal_transfer' && i.pairIds?.includes(row.id));
      if (tr && answer(tr).startsWith('Yes')) return false;
      const pay = issueList.find(i => i.type === 'card_payment' && i.row.id === row.id);
      if (pay && answer(pay).startsWith('Skip')) return false;
      const de = issueList.find(i => i.type === 'duplicate_existing' && i.row.id === row.id);
      if (de && answer(de) === 'Skip — already imported') return false;
      const db = issueList.find(i => i.type === 'duplicate_in_batch' &&
        (i.secondId === row.id || i.firstId === row.id));
      if (db) {
        const a = answer(db);
        if (a === 'Keep first only'  && db.secondId === row.id) return false;
        if (a === 'Keep second only' && db.firstId  === row.id) return false;
      }
      const lg = issueList.find(i => i.type === 'large_transaction' && i.row.id === row.id);
      if (lg && answer(lg).startsWith('Looks wrong')) return false;
      if (edits[row.id]?.skip) return false;
      return true;
    }).map(row => {
      const cr = issueList.find(i => i.type === 'credit_check' && i.row.id === row.id);
      const asIncome = cr && answer(cr).startsWith('Yes');
      return {
        ...row,
        category: edits[row.id]?.cat || (asIncome ? 'income' : row.category),
        source:   edits[row.id]?.src || row.source,
        note:     edits[row.id]?.note || row.note || '',
        who,
      };
    });
  }

  async function importRows(rows, issueList, ans) {
    const keep = resolve(rows, issueList, ans);
    const toSave = keep.map(({ _type, _confidence, _fromPDF, _acctLabel, _internal, ...r }) => ({
      ...r, direction: _type || 'debit',
    }));
    try {
      await insertBankImports(toSave);
      setImported(toSave.map(r => r.id));
      setAutoStats({
        saved:    toSave.length,
        skipped:  rows.length - keep.length,
        decisions: issueList.length,
      });
      onImported();
      setStep('done');
    } catch (err) {
      showToast('Import failed — ' + err.message);
      setStep('review');
    }
  }

  /** Re-sync after the user changes one of the automatic decisions. */
  async function applyDecisionChanges() {
    setSaving(true);
    const keep    = resolve(parsed, issues, answers);
    const keepIds = new Set(keep.map(r => r.id));
    const remove  = imported.filter(id => !keepIds.has(id));
    const add     = keep.filter(r => !imported.includes(r.id));
    try {
      if (remove.length) await deleteManyRows(remove);
      if (add.length) {
        await insertBankImports(add.map(({ _type, _confidence, _fromPDF, _acctLabel, _internal, ...r }) => ({
          ...r, direction: _type || 'debit',
        })));
      }
      setImported(keep.map(r => r.id));
      setAutoStats(p => ({ ...p, saved: keep.length, skipped: parsed.length - keep.length }));
      onImported();
      showToast(
        remove.length || add.length
          ? `Updated — ${add.length} added, ${remove.length} removed`
          : 'Nothing changed');
      setStep('done');
    } catch (e) { showToast('Could not update — ' + e.message); }
    setSaving(false);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await runPipeline(file);
  }

  async function confirmImport() {
    setSaving(true);
    const toSave = finalRows.map(({ _type, _confidence, _fromPDF, _acctLabel, _internal, ...r }) => ({
      ...r,
      direction: _type || 'debit',   // needed later to pair partner e-transfers
    }));
    try {
      await insertBankImports(toSave);
      onImported();
      setStep('done');

      // Generate the insight after saving so the user isn't kept waiting
      if (AI_AVAILABLE) {
        setInsight('loading');
        try {
          const hist = await getAllBankImports();
          const labels = Object.fromEntries(allCats.map(c => [c.id, c.label]));
          const out = await spendingInsight(toSave, hist, labels);
          setInsight(out || null);
        } catch { setInsight(null); }
      }
    } catch (err) {
      showToast('Import failed — ' + err.message);
    }
    setSaving(false);
  }

  function reset() {
    setStep('pick'); setParsed([]); setEdits({}); setIssues([]); setAnswers({});
    setAutoFixed([]);
    setError(null); setCsvFailed(false); setAccounts([]); setWarnings([]);
    setFileType(null); setModal(null); setAskBank(null); setPendingCSV(null);
    setInsight(null);
  }

  // ── Processing overlay ──────────────────────────────────────────────────────
  const Overlay = modal ? (
    <div style={{ position:'fixed', inset:0, zIndex:800, background:'rgba(26,26,24,0.78)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:C.white, borderRadius:20, padding:'32px 28px',
        maxWidth:340, width:'100%', textAlign:'center',
        boxShadow:'0 24px 48px rgba(0,0,0,0.3)' }}>
        <Spinner size={40}/>
        <h2 style={{ fontFamily:SERIF, fontSize:22, fontWeight:600,
          color:C.ink, margin:'16px 0 8px' }}>{modal.title}</h2>
        <p style={{ fontSize:13, color:C.inkMid, margin:'0 0 20px',
          fontFamily:SANS, lineHeight:1.7 }}>{modal.sub}</p>
        <div style={{ background:C.redLight, border:'1px solid rgba(192,57,43,0.15)',
          borderRadius:10, padding:'10px 14px' }}>
          <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.red, fontFamily:SANS }}>
            ⚠ Do not close or refresh this page
          </p>
        </div>
      </div>
    </div>
  ) : null;

  // Small institution chip used in a few places
  const Chip = ({ id, label, sub }) => (
    <div style={{ display:'inline-flex', alignItems:'center', gap:7,
      background: instColor(id) + '14', border:'1px solid ' + instColor(id) + '44',
      borderRadius:99, padding:'5px 12px 5px 9px' }}>
      {instKind(id) === 'credit'
        ? <CreditCard size={13} color={instColor(id)}/>
        : <Landmark   size={13} color={instColor(id)}/>}
      <span style={{ fontSize:12, fontWeight:700, color:instColor(id), fontFamily:SANS }}>
        {label || instLabel(id)}
      </span>
      {sub && <span style={{ fontSize:11, color:instColor(id) + 'aa', fontFamily:SANS }}>{sub}</span>}
    </div>
  );

  // ── PICK ────────────────────────────────────────────────────────────────────
  if (step === 'pick') return (
    <div style={{ padding:'16px 16px 0' }}>
      {Overlay}

      <div style={{ background:'linear-gradient(135deg,#1a7a4a,#2d9d61)',
        borderRadius:16, padding:'20px 18px', marginBottom:14, color:'#fff' }}>
        <p style={{ margin:'0 0 6px', fontSize:16, fontWeight:700, fontFamily:SERIF }}>
          Upload a bank statement
        </p>
        <p style={{ margin:'0 0 10px', fontSize:13, fontFamily:SANS,
          color:'rgba(255,255,255,0.85)', lineHeight:1.6 }}>
          Just pick the file — <b>CSV or PDF</b>. You don't need to tell us which bank
          it's from; the statement says so and Claude reads it. One document can even
          hold several accounts.
        </p>
        <p style={{ margin:0, fontSize:12, color:'rgba(255,255,255,0.65)', fontFamily:SANS }}>
          💡 Every upload is checked for duplicates and income before anything is saved.
        </p>
      </div>

      {aiOn === true && !csvFailed && (
        <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd', borderRadius:12,
          padding:'10px 14px', marginBottom:14, display:'flex', gap:8, alignItems:'center' }}>
          <Sparkles size={13} color={C.purple}/>
          <p style={{ margin:0, fontSize:12, color:'#5b21b6', fontFamily:SANS }}>
            Claude connected — PDF reading, smart categorisation and data checks are active.
          </p>
        </div>
      )}
      {aiOn === false && !csvFailed && (() => {
        const d = aiDiag || {};
        const rejected = d.reason === 'rejected';
        return (
          <div style={{ background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:12,
            padding:'12px 14px', marginBottom:14 }}>
            <p style={{ margin:'0 0 4px', fontSize:13, fontWeight:700,
              color:C.amber, fontFamily:SANS }}>
              {rejected ? 'Anthropic rejected the API key'
                        : d.reason === 'missing' ? "Claude isn't connected yet"
                        : 'Claude is unavailable'}
            </p>
            <p style={{ margin:'0 0 8px', fontSize:12, color:'#92400e',
              fontFamily:SANS, lineHeight:1.6 }}>
              {rejected
                ? 'The variable is set, but the value is being refused. Almost always ' +
                  'this is a key that got truncated when pasted, or one that has been ' +
                  'revoked. Create a fresh key and paste the whole string.'
                : d.reason === 'missing'
                ? <>CSV upload still works. For PDF reading, add <b>ANTHROPIC_API_KEY</b> to
                    your Netlify environment variables and redeploy. No <code>VITE_</code>{' '}
                    prefix — that is what would leak the key into the browser.</>
                : (d.message || 'Could not reach Anthropic from the server.')}
            </p>
            {d.present && (
              <div style={{ background:'rgba(0,0,0,0.05)', borderRadius:7, padding:'7px 10px',
                fontFamily:'monospace', fontSize:11, color:'#92400e', lineHeight:1.7 }}>
                <div>key: {d.startsWith} {d.endsWith}</div>
                <div>length: {d.length} {d.length < 40 ? '← looks truncated' : ''}</div>
                <div>prefix ok: {d.looksValid ? 'yes' : 'no — should start sk-ant-'}</div>
                {d.hadWhitespace && <div>note: stray whitespace was trimmed</div>}
              </div>
            )}
          </div>
        );
      })()}

      {csvFailed && (
        <div style={{ background:'#fffbeb', border:'1.5px solid #b45309',
          borderRadius:14, padding:'16px', marginBottom:14 }}>
          <div style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:12 }}>
            <AlertCircle size={18} color={C.amber} style={{ flexShrink:0, marginTop:2 }}/>
            <div>
              <p style={{ margin:'0 0 4px', fontSize:14, fontWeight:700,
                color:C.amber, fontFamily:SANS }}>
                That CSV didn't work — but that's okay
              </p>
              <p style={{ margin:'0 0 8px', fontSize:13, color:'#92400e',
                fontFamily:SANS, lineHeight:1.6 }}>
                Banks don't always export a clean CSV — that's their problem, not yours.
                Upload the <b>PDF version</b> instead and Claude will read it page by page.
              </p>
              {error && (
                <div style={{ background:'rgba(0,0,0,0.05)', borderRadius:7,
                  padding:'6px 10px', fontFamily:'monospace', fontSize:11,
                  color:'#92400e', whiteSpace:'pre-wrap' }}>{error}</div>
              )}
            </div>
          </div>
          {aiOn !== false ? (
            <label style={{ display:'block', padding:'14px', borderRadius:11,
              background:C.amber, cursor:'pointer', textAlign:'center',
              fontSize:14, fontWeight:700, color:'#fff', fontFamily:SANS,
              position:'relative', overflow:'hidden', boxSizing:'border-box' }}>
              Try uploading the PDF instead →
              <input type="file" accept=".pdf,application/pdf" onChange={handleFile}
                style={{ position:'absolute', top:0, left:0, width:'100%',
                  height:'100%', opacity:0, cursor:'pointer' }}/>
            </label>
          ) : (
            <p style={{ margin:0, fontSize:12, color:'#92400e', fontFamily:SANS }}>
              Add <b>ANTHROPIC_API_KEY</b> to your Netlify environment variables
              to enable PDF reading.
            </p>
          )}
        </div>
      )}

      {error && !csvFailed && (
        <div style={{ background:C.redLight, border:'1px solid rgba(192,57,43,0.2)',
          borderRadius:12, padding:'12px 16px', marginBottom:14 }}>
          <p style={{ margin:'0 0 4px', fontSize:13, fontWeight:600, color:C.red, fontFamily:SANS }}>
            Upload failed
          </p>
          <p style={{ margin:0, fontSize:12, color:C.red,
            fontFamily:'monospace', whiteSpace:'pre-wrap' }}>{error}</p>
        </div>
      )}

      <SL>Whose spending is this?</SL>
      <div style={{ display:'flex', gap:8, marginBottom:22 }}>
        {[[myFirst, capitalize(myFirst)], [partnerFirst, capitalize(partnerFirst)]].map(([k,l]) => {
          const col = nameColor(k);
          return (
          <button key={k} onClick={() => setWho(k)} style={{ flex:1,
            border:'1.5px solid ' + (who===k ? col : C.sandDark),
            borderRadius:12, padding:'11px',
            background: who===k ? col+'15' : C.white, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            <div style={{ width:24, height:24, borderRadius:'50%', background:col, color:'#fff',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:9, fontWeight:700 }}>
              {nameInitials(l)}
            </div>
            <span style={{ fontSize:13, fontWeight:600,
              color: who===k ? col : C.inkMid, fontFamily:SANS }}>{l}</span>
          </button>
          );
        })}
      </div>

      <label style={{ display:'block', width:'100%', padding:'20px', borderRadius:14,
        background:C.ink, cursor:'pointer', textAlign:'center', fontSize:16,
        fontWeight:600, color:'#fff', fontFamily:SANS,
        boxSizing:'border-box', position:'relative', overflow:'hidden' }}>
        <Upload size={19} style={{ verticalAlign:'middle', marginRight:10 }}/>
        Choose a statement
        <input type="file"
          accept=".csv,.CSV,.pdf,.PDF,text/csv,text/plain,application/pdf"
          onChange={handleFile}
          style={{ position:'absolute', top:0, left:0, width:'100%',
            height:'100%', opacity:0, cursor:'pointer' }}/>
      </label>
      <p style={{ textAlign:'center', fontSize:12, color:C.inkSoft,
        marginTop:10, fontFamily:SANS, lineHeight:1.6 }}>
        CSV or PDF · The bank is detected automatically
      </p>
      <p style={{ textAlign:'center', fontSize:10, color:C.sandDark,
        marginTop:14, marginBottom:16, fontFamily:'monospace' }}>
        {__APP_VERSION__} · built {__BUILD_ID__}
      </p>
    </div>
  );

  // ── IDENTIFY — only shown when detection genuinely fails ────────────────────
  if (step === 'identify') return (
    <div style={{ padding:'16px 16px 0' }}>
      {Overlay}
      <Card style={{ padding:'20px 18px' }}>
        <div style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:12 }}>
          <div style={{ width:34, height:34, borderRadius:10, background:C.amber+'1e',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <HelpCircle size={18} color={C.amber}/>
          </div>
          <div>
            <h2 style={{ margin:0, fontFamily:SERIF, fontSize:21, fontWeight:600, color:C.ink }}>
              Which bank is this from?
            </h2>
            <p style={{ margin:'4px 0 0', fontSize:13, color:C.inkSoft,
              fontFamily:SANS, lineHeight:1.6 }}>
              This one doesn't name the institution anywhere we could find, so we need
              you to tell us just this once.
            </p>
          </div>
        </div>

        {askBank?.preview && (
          <div style={{ background:C.sand, borderRadius:9, padding:'8px 12px',
            marginBottom:14, fontFamily:'monospace', fontSize:11,
            color:C.inkSoft, wordBreak:'break-all' }}>
            {askBank.preview}…
          </div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
          {INSTITUTIONS.filter(i => i.id !== 'UNKNOWN').map(inst => (
            <button key={inst.id}
              onClick={() => { setAskBank(null); setStep('pick');
                parseCSVWith(pendingCSV, { id:inst.id, confidence:'high',
                  how:'You told us this one' }); }}
              style={{ border:'1.5px solid ' + C.sandDark, borderRadius:11,
                padding:'12px 14px', background:C.white, cursor:'pointer',
                display:'flex', alignItems:'center', gap:10, textAlign:'left' }}>
              {inst.kind === 'credit'
                ? <CreditCard size={16} color={inst.color}/>
                : <Landmark   size={16} color={inst.color}/>}
              <span style={{ fontSize:14, fontWeight:600, color:C.ink, fontFamily:SANS }}>
                {inst.label}
              </span>
            </button>
          ))}
        </div>
      </Card>
      <button onClick={reset}
        style={{ border:'1px solid ' + C.sandDark, width:'100%', padding:'13px',
          borderRadius:12, fontSize:14, background:C.white, color:C.inkMid,
          cursor:'pointer', fontFamily:SANS, marginBottom:16 }}>
        Cancel
      </button>
    </div>
  );

  // ── VALIDATE ────────────────────────────────────────────────────────────────
  if (step === 'validate') {
    const questions   = issues.filter(i => !i.autoFixed);
    const excluded    = parsed.length - finalRows.length;
    const transferSum = autoFixed
      .filter(i => i.type === 'internal_transfer')
      .reduce((a, i) => a + i.row.amount, 0);

    const TYPE_META = {
      partner_transfer:   { icon:'💸', label:'Transfer between you two',          color:C.green },
      internal_transfer:  { icon:'🔄', label:'Money moved between your accounts', color:C.green },
      card_payment:       { icon:'💳', label:'Card payment or transfer',          color:C.green },
      duplicate_in_batch: { icon:'🔁', label:'Same transaction twice in this file',color:C.blue },
      duplicate_existing: { icon:'📋', label:'Already in your budget',            color:C.blue },
      credit_check:       { icon:'💰', label:'Looks like income',                 color:C.green },
      large_transaction:  { icon:'🔍', label:'Unusually large',                   color:C.amber },
    };

    return (
      <div style={{ padding:'16px 16px 0' }}>
        {Overlay}
        <div style={{ marginBottom:12 }}>
          <h2 style={{ margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
            What we decided for you
          </h2>
          <p style={{ margin:'4px 0 0', fontSize:13, color:C.inkSoft, fontFamily:SANS }}>
            Found {parsed.length} transactions.
            {' '}Everything is already imported. These are the judgement calls made
            along the way — change any that look wrong.
          </p>
        </div>

        {accounts.length > 0 && (
          <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:12 }}>
            {accounts.map((a,i) => (
              <Chip key={i} id={a.institution}
                label={a.institutionName || instLabel(a.institution)}
                sub={a.accountLabel || a.period || ''}/>
            ))}
          </div>
        )}

        {/* ── Auto-fixed summary ── */}
        {autoFixed.length > 0 && (
          <div style={{ background:C.greenLight, border:`1px solid ${C.green}44`,
            borderRadius:14, padding:'14px 16px', marginBottom:14 }}>
            <div style={{ display:'flex', gap:9, alignItems:'flex-start', marginBottom:10 }}>
              <div style={{ width:28, height:28, borderRadius:99, background:C.green,
                display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <Check size={16} color="#fff" strokeWidth={3}/>
              </div>
              <div style={{ flex:1 }}>
                <p style={{ margin:0, fontSize:14, fontWeight:700, color:C.green, fontFamily:SANS }}>
                  {autoFixed.length} issue{autoFixed.length!==1?'s':''} fixed automatically
                </p>
                <p style={{ margin:'3px 0 0', fontSize:12, color:C.green+'cc',
                  fontFamily:SANS, lineHeight:1.6 }}>
                  {transferSum > 0
                    ? `Includes ${fmt(transferSum)} of transfers between your own accounts — ` +
                      `counting those would have inflated your spending.`
                    : `These were unambiguous, so we handled them without asking.`}
                </p>
              </div>
            </div>

            <div style={{ background:'rgba(255,255,255,0.7)', borderRadius:10, padding:'4px 0' }}>
              {autoFixed.map((i, idx) => {
                const meta = TYPE_META[i.type] || { icon:'✓', label:'Resolved', color:C.green };
                const kept = (answers[i.id] ?? i.default) !== i.default;
                return (
                  <div key={i.id} style={{ display:'flex', alignItems:'center', gap:9,
                    padding:'8px 12px',
                    borderTop: idx ? `1px solid ${C.sandMid}` : 'none' }}>
                    <span style={{ fontSize:14, flexShrink:0, opacity: kept ? 0.35 : 1 }}>
                      {meta.icon}
                    </span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:0, fontSize:12, fontWeight:600, color:C.ink,
                        fontFamily:SANS, textDecoration: kept ? 'line-through' : 'none',
                        opacity: kept ? 0.5 : 1,
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {i.summary}
                      </p>
                      <p style={{ margin:0, fontSize:10, color:C.inkSoft, fontFamily:SANS }}>
                        {meta.label}
                      </p>
                    </div>
                    <button
                      onClick={() => setAnswers(p => ({ ...p,
                        [i.id]: kept ? i.default : i.options.find(o => o !== i.default) }))}
                      style={{ border:`1px solid ${C.sandDark}`, borderRadius:7,
                        padding:'4px 10px', background:C.white, fontSize:11,
                        fontWeight:600, color:C.inkMid, cursor:'pointer',
                        fontFamily:SANS, flexShrink:0 }}>
                      {kept ? 'Undo' : 'Keep it'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd',
            borderRadius:12, padding:'10px 14px', marginBottom:12 }}>
            {warnings.map((w,i) => (
              <p key={i} style={{ margin: i?'4px 0 0':0, fontSize:11,
                color:'#5b21b6', fontFamily:SANS, lineHeight:1.6 }}>⚠ {w}</p>
            ))}
          </div>
        )}

        {/* ── Questions that genuinely need a human ── */}
        {questions.length > 0 && (
          <SL>Needs your call</SL>
        )}

        {questions.map((issue, idx) => {
          const ans  = answers[issue.id] ?? issue.default;
          const meta = TYPE_META[issue.type] || { icon:'❓', color:C.amber };
          const bc   = meta.color;
          return (
            <div key={issue.id} style={{ background:C.white, borderRadius:14,
              padding:'16px', marginBottom:12,
              boxShadow:'0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.04)',
              borderLeft:`4px solid ${bc}` }}>
              <div style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:10 }}>
                <div style={{ width:30, height:30, borderRadius:99, background:bc+'18',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:16, flexShrink:0 }}>{meta.icon}</div>
                <div style={{ flex:1 }}>
                  <p style={{ margin:'0 0 2px', fontSize:10, color:bc,
                    textTransform:'uppercase', letterSpacing:'0.08em',
                    fontFamily:SANS, fontWeight:700 }}>
                    {idx + 1} of {questions.length} · {meta.label}
                  </p>
                  <p style={{ margin:0, fontSize:14, color:C.ink,
                    fontFamily:SANS, lineHeight:1.65 }}>{issue.question}</p>
                </div>
              </div>

              {/* Both sides of a pair, when there are two */}
              <div style={{ background:C.sand, borderRadius:9, padding:'10px 14px',
                marginBottom:12 }}>
                {[issue.row, issue.against].filter(Boolean).map((r, ri) => (
                  <div key={ri} style={{ display:'flex', justifyContent:'space-between',
                    alignItems:'center', gap:8,
                    paddingTop: ri ? 8 : 0, marginTop: ri ? 8 : 0,
                    borderTop: ri ? `1px solid ${C.sandDark}` : 'none' }}>
                    <div style={{ minWidth:0 }}>
                      <p style={{ margin:0, fontSize:13, fontWeight:600, color:C.ink,
                        fontFamily:SANS, overflow:'hidden',
                        textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {r.description}
                      </p>
                      <p style={{ margin:'2px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS }}>
                        {r.date} · {instLabel(r.source)}
                        {r._type === 'credit' ? ' · money in' : ' · money out'}
                      </p>
                    </div>
                    <p style={{ margin:0, fontFamily:SERIF, fontSize:17, fontWeight:700,
                      color:C.ink, flexShrink:0 }}>{fmt(r.amount)}</p>
                  </div>
                ))}
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {issue.options.map(opt => (
                  <button key={opt}
                    onClick={() => setAnswers(p => ({ ...p, [issue.id]: opt }))}
                    style={{ border:`1.5px solid ${ans===opt ? C.green : C.sandDark}`,
                      borderRadius:10, padding:'10px 14px', cursor:'pointer',
                      background: ans===opt ? C.greenLight : C.white,
                      display:'flex', alignItems:'center', gap:10, textAlign:'left' }}>
                    <div style={{ width:18, height:18, borderRadius:'50%', flexShrink:0,
                      border:`2px solid ${ans===opt ? C.green : C.sandDark}`,
                      background: ans===opt ? C.green : 'transparent' }}/>
                    <span style={{ fontSize:13, fontWeight: ans===opt?600:400,
                      color: ans===opt?C.green:C.inkMid, fontFamily:SANS }}>{opt}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        <button onClick={applyDecisionChanges} disabled={saving}
          style={{ width:'100%', border:'none', padding:'16px', borderRadius:14,
            background:C.green, color:'#fff', fontSize:15, fontWeight:700,
            cursor:'pointer', fontFamily:SANS, marginBottom:8,
            display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
          {saving ? <><Spinner size={14}/>Updating…</> : 'Apply these decisions'}
        </button>
        <button onClick={() => setStep('done')} disabled={saving}
          style={{ width:'100%', border:`1px solid ${C.sandDark}`, padding:'13px',
            borderRadius:12, background:C.white, color:C.inkMid, fontSize:14,
            cursor:'pointer', fontFamily:SANS, marginBottom:8 }}>
          Leave them as they are
        </button>
        <p style={{ textAlign:'center', fontSize:11, color:C.inkSoft,
          fontFamily:SANS, margin:'0 0 16px' }}>
          {excluded > 0
            ? `${excluded} transaction${excluded!==1?'s':''} will be left out of the import.`
            : 'Nothing is being excluded.'}
        </p>
      </div>
    );
  }

  // ── REVIEW ──────────────────────────────────────────────────────────────────
  if (step === 'review') return (
    <div style={{ padding:'16px 16px 0' }}>
      {Overlay}
      <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center' }}>
        <button onClick={() => issues.length > 0 ? setStep('validate') : reset()}
          style={{ border:'1px solid ' + C.sandDark, borderRadius:8, padding:'6px 12px',
            background:C.white, fontSize:13, color:C.ink, cursor:'pointer', fontFamily:SANS }}>
          ← Back
        </button>
        <div style={{ flex:1 }}>
          <p style={{ margin:0, fontSize:14, fontWeight:600, color:C.ink, fontFamily:SANS }}>
            {finalRows.length} transactions to import
          </p>
          <p style={{ margin:0, fontSize:12, color:C.inkSoft, fontFamily:SANS }}>
            {fileType==='pdf' ? 'Read from PDF' : 'Read from CSV'}
            {Object.keys(byMonth).length > 1 ? ' · ' + Object.keys(byMonth).length + ' months' : ''}
            {usedSources.length > 1 ? ' · ' + usedSources.length + ' accounts' : ''}
          </p>
        </div>
        <button onClick={confirmImport} disabled={saving || finalRows.length === 0}
          style={{ border:'none', borderRadius:10, padding:'9px 18px', cursor:'pointer',
            fontFamily:SANS, fontSize:14, fontWeight:600,
            background: finalRows.length>0 ? C.green : C.sandDark,
            color: finalRows.length>0 ? '#fff' : C.inkSoft,
            display:'flex', alignItems:'center', gap:6 }}>
          {saving ? (<><Spinner size={14}/><span>…</span></>) : 'Import all'}
        </button>
      </div>

      {accounts.length > 0 && (
        <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:14 }}>
          {accounts.map((a,i) => (
            <Chip key={i} id={a.institution}
              label={a.institutionName || instLabel(a.institution)}
              sub={a.accountLabel || ''}/>
          ))}
        </div>
      )}

      {Object.entries(byMonth).map(([mk, rows]) => (
        <div key={mk}>
          <SL>{mk} — {rows.length} transactions · {fmt(rows.reduce((a,r)=>a+r.amount,0))}</SL>
          <Card style={{ padding:'4px 0', marginBottom:12 }}>
            {rows.map((tx, i) => {
              const ec  = edits[tx.id]?.cat || tx.category;
              const es  = edits[tx.id]?.src || tx.source;
              const skp = !!edits[tx.id]?.skip;
              const c   = allCats.find(x => x.id === ec) || { icon:'Package', color:C.inkSoft };
              const low = tx._confidence === 'low';
              const isCredit = tx._type === 'credit';
              return (
                <div key={tx.id}>
                  {i > 0 && <Divider/>}
                  <div style={{ padding:'10px 14px', opacity: skp ? 0.4 : 1,
                    background: skp ? C.sandMid : low ? '#fffbeb' : C.white }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <button
                        onClick={() => setEdits(p=>({...p,[tx.id]:{...p[tx.id],skip:!p[tx.id]?.skip}}))}
                        style={{ border:'none', background:'none', padding:0,
                          cursor:'pointer', flexShrink:0 }}>
                        <div style={{ width:20, height:20, borderRadius:5,
                          border:'1.5px solid ' + (skp ? C.sandDark : C.green),
                          background: skp ? 'transparent' : C.green,
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
                          {!skp && <Check size={12} color="#fff" strokeWidth={3}/>}
                        </div>
                      </button>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ margin:0, fontSize:12, color:C.ink, fontFamily:SANS,
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {tx.description}
                          {low && <span style={{ marginLeft:6, fontSize:10,
                            color:C.amber, fontWeight:600 }}>low confidence</span>}
                        </p>
                        <p style={{ margin:'1px 0 0', fontSize:10,
                          color:C.inkSoft, fontFamily:SANS }}>{tx.date}</p>
                      </div>
                      <select value={ec}
                        onChange={e => setEdits(p=>({...p,[tx.id]:{...p[tx.id],cat:e.target.value}}))}
                        style={{ border:'1px solid ' + c.color, borderRadius:7,
                          padding:'3px 6px', fontSize:10, fontWeight:700, color:c.color,
                          background:'#fff', cursor:'pointer', fontFamily:SANS, maxWidth:96 }}>
                        {allCats.map(x => (<option key={x.id} value={x.id}>{x.label}</option>))}
                      </select>
                      <p style={{ margin:0, fontFamily:SERIF, fontSize:15, fontWeight:600,
                        color:C.ink, minWidth:58, textAlign:'right' }}>{fmt(tx.amount)}</p>
                    </div>

                    {/* Account + direction, editable per row */}
                    <div style={{ display:'flex', alignItems:'center', gap:6,
                      marginTop:6, marginLeft:28 }}>
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px',
                        borderRadius:99, fontFamily:SANS,
                        background: isCredit ? C.greenLight : C.sandMid,
                        color: isCredit ? C.green : C.inkSoft }}>
                        {isCredit ? 'INCOME' : 'SPENDING'}
                      </span>
                      <select value={es}
                        onChange={e => setEdits(p=>({...p,[tx.id]:{...p[tx.id],src:e.target.value}}))}
                        style={{ border:'1px solid ' + instColor(es) + '55', borderRadius:7,
                          padding:'2px 6px', fontSize:10, fontWeight:600,
                          color:instColor(es), background:'#fff',
                          cursor:'pointer', fontFamily:SANS }}>
                        {INSTITUTIONS.map(x => (
                          <option key={x.id} value={x.id}>{x.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      ))}

      <button onClick={confirmImport} disabled={saving || finalRows.length === 0}
        style={{ border:'none', width:'100%', padding:'16px', borderRadius:14,
          fontSize:15, fontWeight:600, fontFamily:SANS,
          background: finalRows.length>0 ? C.green : C.sandDark,
          color: finalRows.length>0 ? '#fff' : C.inkSoft,
          cursor: finalRows.length>0 ? 'pointer' : 'default',
          display:'flex', alignItems:'center', justifyContent:'center',
          gap:8, marginBottom:16 }}>
        {saving ? (<><Spinner/><span>Importing…</span></>)
          : 'Import ' + finalRows.length + ' transaction' + (finalRows.length!==1?'s':'')}
      </button>
    </div>
  );

  // ── DONE ────────────────────────────────────────────────────────────────────
  const questionCount = issues.filter(i => !i.autoFixed).length;

  return (
    <div style={{ padding:'16px 16px 0' }}>
      <Card style={{ background:C.greenLight, border:'1px solid rgba(26,122,74,0.2)',
        textAlign:'center', padding:'28px 20px' }}>
        <Check size={44} color={C.green} style={{ marginBottom:10 }}/>
        <h2 style={{ fontFamily:SERIF, fontSize:26, fontWeight:600,
          color:C.green, margin:'0 0 6px' }}>Imported</h2>
        <p style={{ margin:0, fontSize:14, color:C.green+'cc', fontFamily:SANS }}>
          {autoStats?.saved ?? 0} transactions saved and categorised.
        </p>
        {usedSources.length > 0 && (
          <div style={{ display:'flex', gap:6, flexWrap:'wrap',
            justifyContent:'center', marginTop:12 }}>
            {usedSources.map(id => <Chip key={id} id={id}/>)}
          </div>
        )}
      </Card>

      {/* What was decided without asking */}
      {(autoStats?.skipped > 0 || issues.length > 0) && (
        <Card>
          <div style={{ display:'flex', gap:9, alignItems:'flex-start', marginBottom:10 }}>
            <div style={{ width:28, height:28, borderRadius:99, background:C.blue+'18',
              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <Sparkles size={14} color={C.blue}/>
            </div>
            <div style={{ flex:1 }}>
              <p style={{ margin:0, fontSize:14, fontWeight:700, color:C.ink, fontFamily:SANS }}>
                {autoStats?.skipped || 0} left out automatically
              </p>
              <p style={{ margin:'3px 0 0', fontSize:12, color:C.inkSoft,
                fontFamily:SANS, lineHeight:1.6 }}>
                Duplicates, transfers between your own accounts, and money coming in.
                You were not asked because the safe answer was obvious in each case.
                {questionCount > 0 && ` ${questionCount} were closer calls.`}
              </p>
            </div>
          </div>
          {issues.length > 0 && (
            <button onClick={() => setStep('validate')}
              style={{ width:'100%', border:`1px solid ${C.sandDark}`, borderRadius:10,
                padding:'11px', background:C.white, fontSize:13, fontWeight:600,
                color:C.ink, cursor:'pointer', fontFamily:SANS,
                display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
              Review {issues.length} decision{issues.length===1?'':'s'}
              <ChevronRight size={14} color={C.inkSoft}/>
            </button>
          )}
        </Card>
      )}

      {/* AI insight */}
      {insight === 'loading' && (
        <Card style={{ display:'flex', alignItems:'center', gap:10 }}>
          <Spinner size={16}/>
          <p style={{ margin:0, fontSize:13, color:C.inkSoft, fontFamily:SANS }}>
            Working out what this means for your spending…
          </p>
        </Card>
      )}
      {insight && insight !== 'loading' && (
        <Card style={{ border:'1px solid #c4b5fd', background:'#faf9ff' }}>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
            <Sparkles size={15} color={C.purple}/>
            <p style={{ margin:0, fontSize:11, fontWeight:700, color:C.purple,
              textTransform:'uppercase', letterSpacing:'0.08em', fontFamily:SANS }}>
              What this changes
            </p>
          </div>
          {insight.headline && (
            <p style={{ margin:'0 0 10px', fontFamily:SERIF, fontSize:18,
              fontWeight:600, color:C.ink, lineHeight:1.4 }}>{insight.headline}</p>
          )}
          {(insight.points || []).map((pt,i) => (
            <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start', marginBottom:7 }}>
              <div style={{ width:5, height:5, borderRadius:99, background:C.purple,
                marginTop:7, flexShrink:0 }}/>
              <p style={{ margin:0, fontSize:13, color:C.inkMid,
                fontFamily:SANS, lineHeight:1.6 }}>{pt}</p>
            </div>
          ))}
        </Card>
      )}

      <button onClick={() => setStep('review')}
        style={{ width:'100%', border:`1px solid ${C.sandDark}`, padding:'13px',
          borderRadius:12, background:C.white, color:C.inkMid, fontSize:13,
          cursor:'pointer', fontFamily:SANS, marginBottom:8 }}>
        See every imported transaction
      </button>
      <button onClick={reset}
        style={{ border:'none', width:'100%', padding:'15px', borderRadius:14,
          fontSize:14, fontWeight:600, background:C.ink, color:'#fff',
          cursor:'pointer', fontFamily:SANS, marginBottom:16 }}>
        Upload another statement
      </button>
    </div>
  );
}

// ─── AUTOMATION TAB (Charts + Upload combined) ────────────────────────────────
export function AutomationTab({txns,bankImports,allCats,year,month,personView,profile,partnerName,
                                showToast,onImported,aiOn,aiDiag}) {
  const [section, setSection] = useState('charts'); // 'charts' | 'upload'

  return (
    <div>
      <div style={{padding:'16px 16px 0'}}>
        <div style={{display:'flex',background:C.sandMid,borderRadius:12,padding:3,
          marginBottom:4}}>
          {[['charts','📊 Charts'],['upload','⬆️ Upload']].map(([k,l])=>(
            <button key={k} onClick={()=>setSection(k)} style={{flex:1,border:'none',
              borderRadius:9,padding:'8px 0',fontSize:13,fontWeight:600,cursor:'pointer',
              fontFamily:SANS,background:section===k?C.white:'transparent',
              color:section===k?C.ink:C.inkSoft,
              boxShadow:section===k?'0 1px 3px rgba(0,0,0,0.1)':'none'}}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {section==='charts'
        ? <ChartsTab txns={txns} bankImports={bankImports} allCats={allCats}
            year={year} month={month} personView={personView} profile={profile}/>
        : <UploadTab showToast={showToast} onImported={onImported} allCats={allCats}
            aiOn={aiOn} aiDiag={aiDiag} profile={profile} partnerName={partnerName}/>}
    </div>
  );
}


// ─── Partner activity ─────────────────────────────────────────────────────────
// Describes a realtime change in plain language, e.g.
//   "Sam added $42.10 to Groceries"
function describeChange(payload, allCats) {
  const row  = payload.new || payload.old || {};
  const evt  = payload.eventType || payload.type;
  const who  = (row.who || row.updated_by || 'Your partner');
  const name = who.charAt(0).toUpperCase() + who.slice(1).split(' ')[0];

  if (payload.table === 'bill_payments') {
    const label = row.label || 'a bill';
    const by    = row.paid_by || 'Your partner';
    const cap   = by.charAt(0).toUpperCase() + by.slice(1).split(' ')[0];
    return payload.eventType === 'DELETE'
      ? { who: cap, text: `${cap} marked ${label} as not paid` }
      : { who: cap, text: `${cap} paid ${label}` };
  }

  if (payload.table === 'bill_rules') {
    const label = row.label || 'a bill';
    if (evt === 'DELETE') {
      return { who: name, text: `${name} removed the ${label} bill rule` };
    }
    if (evt === 'INSERT') {
      return { who: name, text: `${name} added a new bill: ${label}` };
    }
    if (evt === 'UPDATE') {
      return { who: name, text: `${name} updated the ${label} bill rule` };
    }
  }

  if (payload.table === 'category_targets') {
    return { who: name, text: `${name} updated budget targets for categories` };
  }

  if (payload.table === 'goals') {
    return { who: name, text: `${name} updated a financial goal` };
  }

  if (payload.table === 'budget_settings') {
    return { who: name, text: `${name} updated the income or credit-card targets` };
  }

  const catId = row.cat || row.category;
  const cat   = allCats.find(c => c.id === catId);
  const label = cat ? cat.label : 'a category';
  const amt   = row.amount != null ? fmt(row.amount) : '';
  const merchant = row.merchant ? ` at ${row.merchant}` : '';
  const personSpent = row.person ? ` (${row.person})` : '';

  if (evt === 'INSERT') {
    return payload.table === 'bank_imports'
      ? { who:name, text:`${name} imported a transaction — ${amt} in ${label}` }
      : { who:name, text:`${name} added ${amt} to ${label}${merchant}${personSpent}` };
  }
  if (evt === 'UPDATE') return { who:name, text:`${name} edited a ${label} transaction` };
  if (evt === 'DELETE') return { who:name, text:`${name} removed a transaction` };
  return { who:name, text:`${name} made a change` };
}

export function ActivityPanel({ items, onClose, onClear }) {
  return (
    <div style={{ position:'fixed', inset:0, zIndex:700,
      display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div onClick={onClose}
        style={{ position:'absolute', inset:0, background:'rgba(26,26,24,0.55)' }}/>
      <div style={{ position:'relative', background:C.white,
        borderRadius:'20px 20px 0 0', maxHeight:'70dvh',
        display:'flex', flexDirection:'column', animation:'slideUp 0.25s ease' }}>

        <div style={{ padding:'20px 20px 12px', borderBottom:`1px solid ${C.sandMid}`,
          display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ flex:1 }}>
            <h2 style={{ margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
              Partner activity
            </h2>
            <p style={{ margin:'3px 0 0', fontSize:12, color:C.inkSoft, fontFamily:SANS }}>
              Changes your budget partner made, newest first.
            </p>
          </div>
          <button onClick={onClose}
            style={{ border:'none', background:'none', padding:6, cursor:'pointer' }}>
            <X size={20} color={C.inkSoft}/>
          </button>
        </div>

        <div style={{ overflowY:'auto', flex:1, padding:'12px 16px' }}>
          {items.length === 0 ? (
            <div style={{ textAlign:'center', padding:'40px 0' }}>
              <Bell size={36} color={C.sandDark} style={{ marginBottom:10 }}/>
              <p style={{ fontFamily:SERIF, fontSize:18, color:C.inkMid, margin:0 }}>
                Nothing new
              </p>
              <p style={{ fontSize:13, color:C.inkSoft, fontFamily:SANS, marginTop:4 }}>
                You'll see it here the moment your partner adds or imports anything.
              </p>
            </div>
          ) : items.map(n => (
            <div key={n.id} style={{ display:'flex', gap:11, alignItems:'flex-start',
              padding:'11px 0', borderBottom:`1px solid ${C.sandMid}` }}>
              <UserAvatar name={n.who} size={30}/>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ margin:0, fontSize:14, color:C.ink,
                  fontFamily:SANS, lineHeight:1.5 }}>{n.text}</p>
                <p style={{ margin:'2px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS }}>
                  {new Date(n.at).toLocaleString('en-CA',
                    { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}
                </p>
              </div>
            </div>
          ))}
          <div style={{ height:12 }}/>
        </div>

        <div style={{ padding:'12px 16px 24px', borderTop:`1px solid ${C.sandMid}` }}>
          <button onClick={onClear} disabled={items.length === 0}
            style={{ width:'100%', border:'none', padding:'13px', borderRadius:12,
              background: items.length ? C.ink : C.sandDark,
              color: items.length ? '#fff' : C.inkSoft,
              fontSize:14, fontWeight:600,
              cursor: items.length ? 'pointer' : 'default', fontFamily:SANS }}>
            Mark all as read
          </button>
        </div>
      </div>
    </div>
  );
}



// ─── Duplicate cleanup ────────────────────────────────────────────────────────
// Import-time checks only see the batch being imported. Duplicates accumulate
// afterwards — a statement uploaded twice, or once under a misdetected bank and
// again after the fix. This finds them in what is already saved.
export function DuplicateModal({ rows, allCats, onDelete, onClose, showToast }) {
  const groups = findExistingDuplicates(rows || []);
  const [chosen, setChosen] = useState(() =>
    Object.fromEntries(groups.map(g => [g.id, true])));
  const [busy, setBusy] = useState(false);

  const selected  = groups.filter(g => chosen[g.id]);
  const toRemove  = selected.flatMap(g => g.remove);
  const reclaimed = selected.reduce((a, g) => a + g.amount * g.remove.length, 0);

  async function run() {
    setBusy(true);
    try {
      await onDelete(toRemove.map(r => r.id));
      showToast(`Removed ${toRemove.length} duplicate${toRemove.length === 1 ? '' : 's'}`);
      onClose();
    } catch (e) { showToast('Could not remove — ' + e.message); }
    setBusy(false);
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:770,
      display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(26,26,24,0.6)' }}/>
      <div style={{ position:'relative', background:C.sand, borderRadius:'20px 20px 0 0',
        maxHeight:'92dvh', display:'flex', flexDirection:'column', animation:'slideUp 0.25s ease' }}>

        <div style={{ padding:'20px 20px 14px', background:C.white,
          borderRadius:'20px 20px 0 0', borderBottom:`1px solid ${C.sandMid}`,
          display:'flex', alignItems:'flex-start', gap:12 }}>
          <div style={{ flex:1 }}>
            <h2 style={{ margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
              {groups.length ? `${groups.length} duplicate${groups.length===1?'':'s'} found`
                             : 'No duplicates'}
            </h2>
            <p style={{ margin:'4px 0 0', fontSize:13, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6 }}>
              {groups.length
                ? 'Same merchant, same day, same amount. One copy is kept and the rest removed.'
                : 'Nothing in this month appears more than once.'}
            </p>
          </div>
          <button onClick={onClose} style={{ border:'none', background:'none', padding:6, cursor:'pointer' }}>
            <X size={20} color={C.inkSoft}/>
          </button>
        </div>

        <div style={{ overflowY:'auto', flex:1, padding:'12px 16px' }}>
          {groups.length === 0 && (
            <Card style={{ textAlign:'center', padding:'32px 20px' }}>
              <Check size={34} color={C.green} style={{ marginBottom:10 }}/>
              <p style={{ margin:0, fontSize:14, color:C.inkMid, fontFamily:SANS }}>
                This month looks clean.
              </p>
            </Card>
          )}

          {groups.map(g => {
            const on = chosen[g.id];
            const c  = allCats.find(x => x.id === (g.keep.category || g.keep.cat))
                    || { icon:'Package', color:C.inkSoft };
            return (
              <Card key={g.id} style={{ padding:'12px 14px',
                border:`1px solid ${on ? C.red + '55' : C.sandDark}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                  <button onClick={() => setChosen(p => ({ ...p, [g.id]: !p[g.id] }))}
                    style={{ border:'none', background:'none', padding:0, cursor:'pointer', flexShrink:0 }}>
                    <div style={{ width:20, height:20, borderRadius:5,
                      border:`1.5px solid ${on ? C.red : C.sandDark}`,
                      background: on ? C.red : 'transparent',
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {on && <Check size={12} color="#fff" strokeWidth={3}/>}
                    </div>
                  </button>
                  <div style={{ width:30, height:30, borderRadius:9, background:c.color+'18',
                    display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <CatIcon name={c.icon} size={15} color={c.color}/>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:0, fontSize:13, fontWeight:600, color:C.ink, fontFamily:SANS,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {g.label}
                    </p>
                    <p style={{ margin:'1px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS }}>
                      {g.date} · appears {g.count} times
                    </p>
                  </div>
                  <span style={{ fontFamily:SERIF, fontSize:16, fontWeight:700, color:C.ink }}>
                    {fmt(g.amount)}
                  </span>
                </div>

                {g.crossAccount && (
                  <p style={{ margin:'0 0 8px', fontSize:11, color:C.amber,
                    fontFamily:SANS, lineHeight:1.5, paddingLeft:30 }}>
                    Recorded under {g.sources.map(instLabel).join(' and ')}. One purchase
                    cannot be on two accounts, so this is the same statement imported twice.
                  </p>
                )}

                <div style={{ paddingLeft:30 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:3 }}>
                    <Check size={11} color={C.green} strokeWidth={3}/>
                    <span style={{ fontSize:11, color:C.green, fontFamily:SANS }}>
                      keeping the {instLabel(g.keep.source)} copy
                    </span>
                  </div>
                  {g.remove.map(r => (
                    <div key={r.id} style={{ display:'flex', alignItems:'center', gap:7 }}>
                      <Trash2 size={11} color={on ? C.red : C.sandDark}/>
                      <span style={{ fontSize:11, fontFamily:SANS,
                        color: on ? C.red : C.inkSoft,
                        textDecoration: on ? 'line-through' : 'none' }}>
                        removing the {instLabel(r.source)} copy
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>

        {groups.length > 0 && (
          <div style={{ padding:'12px 16px 24px', background:C.white,
            borderTop:`1px solid ${C.sandMid}` }}>
            <button onClick={run} disabled={busy || toRemove.length === 0}
              style={{ width:'100%', border:'none', padding:'15px', borderRadius:12,
                background: toRemove.length ? C.red : C.sandDark,
                color: toRemove.length ? '#fff' : C.inkSoft,
                fontSize:15, fontWeight:700, fontFamily:SANS,
                cursor: toRemove.length ? 'pointer' : 'default',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              {busy ? <><Spinner size={14}/>Removing…</>
                    : `Remove ${toRemove.length} duplicate${toRemove.length===1?'':'s'}`}
            </button>
            <p style={{ margin:'8px 0 0', fontSize:11, color:C.inkSoft,
              textAlign:'center', fontFamily:SANS }}>
              {fmt(reclaimed)} of double-counted spending comes off your totals.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Reset / danger zone ──────────────────────────────────────────────────────
// Deleting shared data is not reversible and affects both people, so this
// screen states plainly what will go, offers a backup first, and requires the
// full reset to be typed out rather than tapped.
export function ResetModal({ year, month, onClose, onDone, showToast }) {
  const [mode,    setMode]    = useState(null);    // null | 'month' | 'all'
  const [scope,   setScope]   = useState('all');   // for month mode
  const [counts,  setCounts]  = useState(null);
  const [typed,   setTyped]   = useState('');
  const [busy,    setBusy]    = useState(false);
  const [backedUp,setBackedUp]= useState(false);

  const CONFIRM = 'DELETE EVERYTHING';

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [m, a] = await Promise.all([countMonthData(year, month), countAllData()]);
        if (live) setCounts({ month: m, all: a });
      } catch { if (live) setCounts({ month:null, all:null }); }
    })();
    return () => { live = false; };
  }, [year, month]);

  async function downloadBackup() {
    try {
      const data = await exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `budget-for-two-backup-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBackedUp(true);
      showToast('Backup downloaded');
    } catch (e) {
      showToast('Backup failed — ' + e.message);
    }
  }

  async function runMonthReset() {
    setBusy(true);
    try {
      await deleteMonthData(year, month, scope);
      showToast(`${MONTHS[month]} ${year} cleared`);
      onDone();
    } catch (e) { showToast('Could not clear — ' + e.message); }
    setBusy(false);
  }

  async function runFullReset() {
    setBusy(true);
    try {
      await deleteAllData();
      try {
        localStorage.removeItem('b42_custom_cats');
        localStorage.removeItem('b42_cat_targets');
        localStorage.removeItem('b42_notifs');
      } catch {}
      showToast('Everything cleared');
      onDone();
    } catch (e) { showToast('Could not clear — ' + e.message); }
    setBusy(false);
  }

  const m = counts?.month;
  const a = counts?.all;
  const monthCount = scope === 'all' ? (m ? m.manual + m.imported : 0)
                   : scope === 'imported' ? (m?.imported || 0)
                   : (m?.manual || 0);

  const Opt = ({ id, label, sub }) => (
    <button onClick={() => setScope(id)}
      style={{ border:`1.5px solid ${scope===id ? C.green : C.sandDark}`, borderRadius:10,
        padding:'10px 14px', cursor:'pointer', width:'100%', textAlign:'left',
        background: scope===id ? C.greenLight : C.white,
        display:'flex', alignItems:'flex-start', gap:10, marginBottom:6 }}>
      <div style={{ width:16, height:16, borderRadius:'50%', flexShrink:0, marginTop:2,
        border:`2px solid ${scope===id ? C.green : C.sandDark}`,
        background: scope===id ? C.green : 'transparent' }}/>
      <div>
        <p style={{ margin:0, fontSize:13, fontWeight:scope===id?600:400,
          color:scope===id?C.green:C.ink, fontFamily:SANS }}>{label}</p>
        <p style={{ margin:'1px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS }}>{sub}</p>
      </div>
    </button>
  );

  return (
    <div style={{ position:'fixed', inset:0, zIndex:750,
      display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(26,26,24,0.6)' }}/>
      <div style={{ position:'relative', background:C.sand, borderRadius:'20px 20px 0 0',
        maxHeight:'92dvh', display:'flex', flexDirection:'column', animation:'slideUp 0.25s ease' }}>

        <div style={{ padding:'20px 20px 14px', background:C.white,
          borderRadius:'20px 20px 0 0', borderBottom:`1px solid ${C.sandMid}`,
          display:'flex', alignItems:'flex-start', gap:12 }}>
          <div style={{ flex:1 }}>
            <h2 style={{ margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
              Reset data
            </h2>
            <p style={{ margin:'4px 0 0', fontSize:13, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6 }}>
              Start a month over, or wipe the budget and begin again. Both of you share
              this data, so anything removed here disappears for your partner too.
            </p>
          </div>
          <button onClick={onClose} style={{ border:'none', background:'none', padding:6, cursor:'pointer' }}>
            <X size={20} color={C.inkSoft}/>
          </button>
        </div>

        <div style={{ overflowY:'auto', flex:1, padding:'14px 16px' }}>

          {/* Backup first */}
          <Card style={{ border:`1px solid ${C.green}44`, background:C.greenLight }}>
            <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
              <Download size={17} color={C.green} style={{ flexShrink:0, marginTop:2 }}/>
              <div style={{ flex:1 }}>
                <p style={{ margin:'0 0 3px', fontSize:13, fontWeight:700, color:C.green, fontFamily:SANS }}>
                  Download a backup first
                </p>
                <p style={{ margin:'0 0 10px', fontSize:12, color:C.green+'cc',
                  fontFamily:SANS, lineHeight:1.6 }}>
                  A JSON file with every transaction and setting. Nothing here can be
                  undone, so this is your only way back.
                </p>
                <button onClick={downloadBackup}
                  style={{ border:'none', borderRadius:9, padding:'8px 16px',
                    background:C.green, color:'#fff', fontSize:13, fontWeight:600,
                    cursor:'pointer', fontFamily:SANS, display:'flex', alignItems:'center', gap:6 }}>
                  {backedUp ? <><Check size={13}/> Downloaded — get another</> : 'Download backup'}
                </button>
              </div>
            </div>
          </Card>

          {/* Reset one month */}
          <Card>
            <p style={{ margin:'0 0 3px', fontSize:14, fontWeight:700, color:C.ink, fontFamily:SANS }}>
              Reset {MONTHS[month]} {year}
            </p>
            <p style={{ margin:'0 0 10px', fontSize:12, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6 }}>
              {m
                ? `${m.imported} imported and ${m.manual} manual ${m.manual===1?'entry':'entries'} in this month.`
                : 'Counting…'}
              {' '}Other months are untouched.
            </p>

            {mode === 'month' ? (
              <>
                <Opt id="all"      label="Everything in this month"
                     sub={m ? `${m.imported + m.manual} transactions` : ''}/>
                <Opt id="imported" label="Imported transactions only"
                     sub={m ? `${m.imported} rows · keeps anything you typed in` : ''}/>
                <Opt id="manual"   label="Manual entries only"
                     sub={m ? `${m.manual} rows · keeps imported statements` : ''}/>

                <div style={{ display:'flex', gap:8, marginTop:12 }}>
                  <button onClick={() => setMode(null)} disabled={busy}
                    style={{ flex:1, border:`1px solid ${C.sandDark}`, borderRadius:10,
                      padding:'12px', background:C.white, fontSize:13, color:C.inkMid,
                      cursor:'pointer', fontFamily:SANS }}>
                    Cancel
                  </button>
                  <button onClick={runMonthReset} disabled={busy || monthCount === 0}
                    style={{ flex:2, border:'none', borderRadius:10, padding:'12px',
                      background: monthCount ? C.red : C.sandDark,
                      color: monthCount ? '#fff' : C.inkSoft,
                      fontSize:13, fontWeight:700,
                      cursor: monthCount ? 'pointer' : 'default', fontFamily:SANS,
                      display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                    {busy ? <><Spinner size={13}/>Clearing…</>
                          : monthCount ? `Delete ${monthCount} transaction${monthCount===1?'':'s'}`
                          : 'Nothing to delete'}
                  </button>
                </div>
              </>
            ) : (
              <button onClick={() => { setMode('month'); setScope('all'); }}
                style={{ border:`1px solid ${C.red}55`, borderRadius:10, padding:'11px 16px',
                  background:C.white, fontSize:13, fontWeight:600, color:C.red,
                  cursor:'pointer', fontFamily:SANS, width:'100%' }}>
                Reset this month…
              </button>
            )}
          </Card>

          {/* Full wipe */}
          <Card style={{ border:`1px solid ${C.red}44` }}>
            <p style={{ margin:'0 0 3px', fontSize:14, fontWeight:700, color:C.red, fontFamily:SANS }}>
              Reset everything
            </p>
            <p style={{ margin:'0 0 10px', fontSize:12, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6 }}>
              Deletes every transaction from every month, both people, plus your
              category targets and custom categories.
              {a ? ` That is ${a.imported + a.manual} transactions in total.` : ''}
              {' '}Your accounts and sign-in stay as they are.
            </p>

            {mode === 'all' ? (
              <>
                <p style={{ margin:'0 0 6px', fontSize:12, color:C.ink, fontFamily:SANS }}>
                  Type <b style={{ fontFamily:'monospace' }}>{CONFIRM}</b> to confirm:
                </p>
                <input value={typed} onChange={e => setTyped(e.target.value)}
                  placeholder={CONFIRM} autoComplete="off"
                  style={{ width:'100%', border:`1.5px solid ${typed===CONFIRM?C.red:C.sandDark}`,
                    borderRadius:9, padding:'11px 13px', fontSize:14, color:C.ink,
                    background:C.white, fontFamily:'monospace', outline:'none',
                    boxSizing:'border-box', marginBottom:10 }}/>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => { setMode(null); setTyped(''); }} disabled={busy}
                    style={{ flex:1, border:`1px solid ${C.sandDark}`, borderRadius:10,
                      padding:'12px', background:C.white, fontSize:13, color:C.inkMid,
                      cursor:'pointer', fontFamily:SANS }}>
                    Cancel
                  </button>
                  <button onClick={runFullReset} disabled={busy || typed !== CONFIRM}
                    style={{ flex:2, border:'none', borderRadius:10, padding:'12px',
                      background: typed===CONFIRM ? C.red : C.sandDark,
                      color: typed===CONFIRM ? '#fff' : C.inkSoft,
                      fontSize:13, fontWeight:700,
                      cursor: typed===CONFIRM ? 'pointer' : 'default', fontFamily:SANS,
                      display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                    {busy ? <><Spinner size={13}/>Deleting…</> : 'Delete everything'}
                  </button>
                </div>
              </>
            ) : (
              <button onClick={() => setMode('all')}
                style={{ border:'none', borderRadius:10, padding:'11px 16px',
                  background:C.red, fontSize:13, fontWeight:700, color:'#fff',
                  cursor:'pointer', fontFamily:SANS, width:'100%' }}>
                Reset everything…
              </button>
            )}
          </Card>

          <p style={{ fontSize:11, color:C.inkSoft, fontFamily:SANS,
            lineHeight:1.6, padding:'0 4px 20px' }}>
            Deleting removes the data, not the account. You can both still sign in, and
            uploading a statement again rebuilds the month from scratch.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
const SUPABASE_READY=!!(import.meta.env.VITE_SUPABASE_URL&&import.meta.env.VITE_SUPABASE_ANON_KEY);
const DEF_INCOME={jordan:3984.44,ness:800,sunlife:0};

export default function App() {
  const now=new Date();
  // Auth
  const [authState,setAuthState]=useState('loading'); // loading|auth|app
  const [profile,  setProfile  ]=useState(null);      // user_metadata
  // App state
  const [tab,        setTab       ]=useState('home');
  const [quickAddCat,setQuickAddCat]=useState(null); // pre-selected category for quick add
  const [month,      setMonth     ]=useState(now.getMonth());
  const [year,       setYear      ]=useState(now.getFullYear());
  const [txns,       setTxns      ]=useState([]);
  const [imports,    setImports   ]=useState([]);
  const [ccTarget,   setCcTarget  ]=useState(500);
  const [customCats, setCustomCats]=useState([]);
  const [catTargets, setCatTargets]=useState({});
  const [suggested,  setSuggested ]=useState({});
  const [toast,      setToast     ]=useState(null);
  const [showReview, setShowReview]=useState(false);
  const [otherItems, setOtherItems]=useState([]);
  const [notifs,     setNotifs    ]=useState([]);
  const [showActivity,setShowActivity]=useState(false);
  const [view,       setView      ]=useState('combined');
  const [aiOn,       setAiOn      ]=useState(null); // null = still checking
  const [aiDiag,     setAiDiag    ]=useState(null);
  const [history,    setHistory   ]=useState([]);   // all imports, for recurring detection
  const [showReset,  setShowReset ]=useState(false);
  const [showExport, setShowExport]=useState(false);
  const [showEmailPreview, setShowEmailPreview]=useState(false);
  const [billRules,  setBillRules ]=useState([]);
  const [showDupes,  setShowDupes ]=useState(false);
  const [billsLocal, setBillsLocal]=useState(false);
  const [billPayments,setBillPayments]=useState([]);
  const [allBillPayments,setAllBillPayments]=useState([]); // unscoped by month — for cross-month overdue carry-forward
  const [billMonthActive, setBillMonthActiveState]=useState([]); // [{key,year,month}] — which bills are on for which month
  const [billMonthConfigured, setBillMonthConfiguredState]=useState([]); // [{year,month}] — months set up at all
  const [income,     setIncome    ]=useState(DEF_INCOME);
  const [expectedIncome, setExpectedIncome]=useState(() => {
    try {
      const saved = localStorage.getItem(EXPECTED_INCOME_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [unreviewed, setUnreviewed]=useState([]); // Partner transactions not yet reviewed
  const [showActivityHelper, setShowActivityHelper]=useState(false); // Show helper on login
  const [editingCatTarget, setEditingCatTarget]=useState(null); // { catId, newAmount }
  const [goals, setGoals] = useState(() => {
    try {
      const saved = localStorage.getItem(GOALS_KEY);
      if (saved) return ensureGoalGroups(JSON.parse(saved));
    } catch {}
    return defaultGoals();
  });
  const [depositingGoalId, setDepositingGoalId] = useState(null);

  // Single place every goal edit flows through: updates state, caches to
  // localStorage immediately, and pushes to Supabase so goals survive even if
  // one partner's browser storage gets cleared or they're on a different device.
  async function saveGoals(updatedGoals) {
    setGoals(updatedGoals);
    try { localStorage.setItem(GOALS_KEY, JSON.stringify(updatedGoals)); } catch {}
    try { await upsertGoals(updatedGoals, profile?.name || 'unknown'); } catch {}
  }

  // Alphabetical everywhere, so a category is always where you expect it —
  // including custom ones added later.
  const allCats=[...DEFAULT_CATS,...customCats]
    .sort((a,b)=>a.label.localeCompare(b.label,'en',{sensitivity:'base'}));

  // Fast lookups for "which bills are on for the month being viewed, and
  // with what amount/label/day/category" — see applyBillRules() in
  // recurring.js for how these get used. A Map, not just a Set, because an
  // active row can carry its own values that only apply to that one month.
  const billActiveKeys = new Map(billMonthActive.map(r => [`${r.key}|${r.year}|${r.month}`,
    { amount: r.amount, label: r.label, day: r.day, category: r.category }]));
  const billConfiguredMonths = new Set(billMonthConfigured.map(r => `${r.year}|${r.month}`));
  const thisMonthIsConfigured = billConfiguredMonths.has(`${year}|${month}`);

  // The other household member's display name — read from their own
  // transactions (whoever isn't you), not hardcoded. Falls back to a plain
  // "Partner" until they've added anything of their own.
  const myName = profile?.name || 'You';
  const partnerName = (() => {
    const me = firstName(myName);
    const counts = {};
    [...txns, ...imports, ...history].forEach(t => {
      const w = (t.who || '').trim();
      if (!w) return;
      const fn = firstName(w);
      if (!fn || fn === me) return;
      counts[w] = (counts[w] || 0) + 1;
    });
    const best = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    return best ? best[0].split(/\s+/)[0] : 'Partner';
  })();

  // Computed once here so Home and Spending can never disagree about it —
  // both just receive the same number.
  const predictedIncomeTotal = (expectedIncome||[])
    .filter(i => { const d = parseLocalDate(i.date); return d.getFullYear()===year && d.getMonth()===month; })
    .reduce((a,i)=>a+(i.amount||0),0);

  // ── Auth init ────────────────────────────────────────────────────────────────
  useEffect(()=>{
    // Load local prefs immediately (don't block on auth)
    try {
      const cc=localStorage.getItem(CUSTOM_CATS_KEY); if(cc)setCustomCats(JSON.parse(cc));
      const ct=localStorage.getItem(CAT_TARGETS_KEY); if(ct)setCatTargets(JSON.parse(ct));
      const nf=localStorage.getItem(NOTIFS_KEY);      if(nf)setNotifs(JSON.parse(nf));
    } catch {}

    if(!SUPABASE_READY){setAuthState('auth');return;}

    // Check existing session
    supabase.auth.getSession().then(({data:{session}})=>{
      if(session?.user){
        const meta=session.user.user_metadata;
        if(meta?.name){setProfile({...meta,email:session.user.email,id:session.user.id});setAuthState('app');}
        else{setAuthState('auth');}
      } else {
        setAuthState('auth');
      }
    });

    // Listen for future auth changes
    const unsub=onAuthChange((event,session)=>{
      if(event==='SIGNED_IN'&&session?.user){
        const meta=session.user.user_metadata;
        if(meta?.name){setProfile({...meta,email:session.user.email,id:session.user.id});setAuthState('app');}
        else{setAuthState('auth');}
      }
      if(event==='SIGNED_OUT'){setProfile(null);setAuthState('auth');}
    });
    return unsub;
  },[]);

  // ── Load data ────────────────────────────────────────────────────────────────
  useEffect(()=>{
    if(authState!=='app'||!SUPABASE_READY)return;
    loadAll();
  },[authState,month,year]);

  // Ticked-off bills are per month, so reload them when the month changes
  useEffect(()=>{
    if(authState!=='app'||!SUPABASE_READY)return;
    getBillPayments(year,month).then(setBillPayments).catch(()=>{});
  },[authState,year,month]);

  async function loadAll(){
    try{
      const [t,b,s,ai,hist]=await Promise.all([getTxns(year,month),getBankImports(year,month),
        getSettings(year,month),getAllBankImports(),getAllBankImportsRaw()]);
      setHistory(hist);
      try {
        // If the bill_rules table exists but local edits are waiting, push them up
        try { await syncLocalBillRules(); } catch {}
        setBillRules(await getBillRules());
        try { await syncLocalBillPayments(); } catch {}
        setBillPayments(await getBillPayments(year, month));
        // Unscoped by month — lets an unpaid bill from a prior month carry
        // forward as overdue instead of disappearing when the month changes
        getAllBillPayments().then(setAllBillPayments).catch(()=>{});
        // Which bills are switched on for which month, and which months have
        // been explicitly set up at all — small datasets, fetched in full
        getBillMonthActive().then(setBillMonthActiveState).catch(()=>{});
        getBillMonthConfigured().then(setBillMonthConfiguredState).catch(()=>{});
        // Load category targets from Supabase (shared with partner)
        const remoteTargets = await getCategoryTargets();
        if(Object.keys(remoteTargets).length > 0) {
          setCatTargets(remoteTargets);
          localStorage.setItem(CAT_TARGETS_KEY,JSON.stringify(remoteTargets));
        }
        // Load goals from Supabase too — this is the source of truth across
        // devices/browsers; localStorage is just a fast local cache
        const remoteGoals = await getGoals();
        if(remoteGoals) {
          const merged = ensureGoalGroups(remoteGoals);
          setGoals(merged);
          localStorage.setItem(GOALS_KEY, JSON.stringify(merged));
        }
        const mod = await import('./supabase.js');
        setBillsLocal(!!mod.billRulesLocalOnly || !!mod.billPaidLocalOnly);
      } catch {}
      setTxns(t);setImports(b);
      setIncome(s?.income||DEF_INCOME);setCcTarget(s?.cc_target??500);
      if(ai.length>20){const nt=computeTargets(ai);if(Object.keys(nt).length>0)setSuggested(nt);}
    }catch(e){showToast('Load error: '+e.message);}
  }

  async function openReview() {
    try {
      const items = await getOtherImports(year, month);
      setOtherItems(items);
      setShowReview(true);
    } catch(e) { showToast('Could not load items: '+e.message); }
  }

  // Move one transaction to a different category. Works for both manual
  // entries and imported rows, and updates local state immediately so the
  // drill-down and the bars reflect the change without a round trip.
  async function handleChangeCategory(tx, newCat) {
    const isImport = tx.description !== undefined || tx.source !== undefined;
    try {
      if (isImport) {
        await updateBankImport(tx.id, { category: newCat });
        setImports(prev => prev.map(t => t.id === tx.id ? { ...t, category: newCat } : t));
      } else {
        await updateTransaction(tx.id, { cat: newCat });
        setTxns(prev => prev.map(t => t.id === tx.id ? { ...t, cat: newCat } : t));
      }
      const label = allCats.find(c => c.id === newCat)?.label || newCat;
      showToast(`Moved to ${label}`);
    } catch (e) {
      showToast('Could not move that transaction');
    }
  }

  /** Edits date, amount, category, and note together. Changing the date can
   *  move a transaction into a different month — since txns/imports state is
   *  scoped to the month currently being viewed, a transaction that moves
   *  away just drops out of the local list rather than staying visible in
   *  the wrong month. */
  async function handleEditTxnSave(tx, updates) {
    const isImport = tx.description !== undefined || tx.source !== undefined;
    const movedAway = updates.year !== year || updates.month !== month;
    try {
      if (isImport) {
        await updateBankImport(tx.id, {
          date: updates.date, amount: updates.amount, category: updates.category,
          note: updates.note, year: updates.year, month: updates.month,
        });
        setImports(prev => movedAway
          ? prev.filter(t => t.id !== tx.id)
          : prev.map(t => t.id === tx.id ? { ...t, ...updates } : t));
      } else {
        await updateTransaction(tx.id, {
          date: updates.date, amount: updates.amount, cat: updates.category,
          note: updates.note, year: updates.year, month: updates.month,
        });
        setTxns(prev => movedAway
          ? prev.filter(t => t.id !== tx.id)
          : prev.map(t => t.id === tx.id ? { ...t, ...updates, cat: updates.category } : t));
      }
      showToast(movedAway
        ? `Moved to ${MONTHS[updates.month]} ${updates.year}`
        : 'Transaction updated');
    } catch (e) {
      showToast('Could not save that change');
    }
  }

  // One row deleted from wherever it lives
  async function deleteRow(tx) {
    const isImport = tx._table === 'bank_imports' || tx.description !== undefined;
    try {
      if (isImport) {
        await deleteBankImport(tx.id);
        setImports(prev => prev.filter(t => t.id !== tx.id));
      } else {
        await deleteTxn(tx.id);
        setTxns(prev => prev.filter(t => t.id !== tx.id));
      }
      showToast('Deleted');
    } catch (e) { showToast('Could not delete — ' + e.message); }
  }

  async function deleteRows(ids) {
    await deleteManyRows(ids);
    setImports(prev => prev.filter(t => !ids.includes(t.id)));
    setTxns(prev => prev.filter(t => !ids.includes(t.id)));
    await loadAll();
  }

  /** Tick a bill off, or untick it. Defaults to marking it paid for the
   *  currently viewed month, but a carried-over overdue bill from an earlier
   *  month can pass its own year/month so the right instance gets closed out. */
  async function toggleBillPaid(bill, paid, billYear = year, billMonth = month) {
    const me = profile?.name || 'someone';
    const sameAsViewedMonth = billYear === year && billMonth === month;
    // Update the screen first — waiting on the network to see a tick land feels broken
    if (sameAsViewedMonth) {
      setBillPayments(prev => paid
        ? [...prev.filter(p => p.key !== bill.key),
           { key:bill.key, year:billYear, month:billMonth, label:bill.label, paid_by:me, paid_at:new Date().toISOString() }]
        : prev.filter(p => p.key !== bill.key));
    }
    setAllBillPayments(prev => paid
      ? [...prev.filter(p => !(p.key === bill.key && p.year === billYear && p.month === billMonth)),
         { key:bill.key, year:billYear, month:billMonth, label:bill.label, paid_by:me, paid_at:new Date().toISOString() }]
      : prev.filter(p => !(p.key === bill.key && p.year === billYear && p.month === billMonth)));
    try {
      await setBillPaid(bill.key, billYear, billMonth, paid, me, bill.label);

      // A bill only counts as spending once a real transaction exists for it.
      // If it's already matched to something in your statements (seenInData),
      // that transaction already exists — don't double it up. But a bill
      // ticked off by hand, ahead of the statement arriving, needs its own
      // transaction created here, or the money never shows up as spent.
      const marker = '__bill:' + bill.key;
      if (paid && !bill.seenInData) {
        const billDate = bill.date ? new Date(bill.date).toISOString().slice(0,10)
                        : `${billYear}-${String(billMonth+1).padStart(2,'0')}-${String(bill.day||1).padStart(2,'0')}`;
        await addTxn({
          cat: bill.category || 'other', amount: bill.amount, date: billDate,
          note: marker, merchant: bill.label, who: me, person: firstName(me) || 'jordan',
          source: 'bill-manual',
        });
      } else if (!paid) {
        // Un-ticking: remove the transaction we created for this bill, if any
        // (never touches a transaction that came from an actual statement).
        try {
          const monthTxns = sameAsViewedMonth ? txns : await getTxns(billYear, billMonth);
          const linked = monthTxns.find(t => t.note === marker && t.source === 'bill-manual');
          if (linked) await deleteTxn(linked.id);
        } catch {}
      }

      if(paid) {
        // Encouragement message when bill is paid
        const messages = [
          `✨ Nice! You just paid ${bill.label}!`,
          `💪 ${bill.label} is handled!`,
          `🎯 Another bill knocked out!`,
          `💚 ${bill.label} ✓`,
          `⚡ One less thing to worry about!`,
        ];
        const msg = messages[Math.floor(Math.random() * messages.length)];
        showToast(msg);
      } else {
        showToast(`${bill.label} marked unpaid`);
      }
    } catch(e) { 
      showToast('Could not update bill status'); 
      if (sameAsViewedMonth) setBillPayments(await getBillPayments(year, month));   // put it back
      getAllBillPayments().then(setAllBillPayments).catch(()=>{});
    }
  }

  async function saveBillRule(rule) {
    try {
      await upsertBillRule(rule);
      setBillRules(await getBillRules());
      const mod = await import('./supabase.js');
      setBillsLocal(!!mod.billRulesLocalOnly);
      showToast(rule.status === 'hidden' ? 'Hidden from bills' : 'Bill saved');
    } catch (e) { showToast('Could not save — ' + e.message); }
  }

  async function removeBillRule(key) {
    try {
      await deleteBillRule(key);
      setBillRules(await getBillRules());
    } catch (e) { showToast('Could not remove — ' + e.message); }
  }

  /** The actual "delete" a person reaches for from the Bills tab. Removes a
   *  bill from THIS month only — every other month, past or future, is
   *  untouched. If this month hasn't been explicitly configured yet, this
   *  is also the moment it becomes explicit: everything else currently
   *  showing gets carried over as its own snapshot (own amount, own
   *  everything), and only the one bill being deleted drops out. */
  async function deleteBillForMonth(bill, visibleBillsThisMonth) {
    const monthTag = `${year}|${month}`;
    const alreadyConfigured = billMonthConfigured.some(r => `${r.year}|${r.month}` === monthTag);
    try {
      if (!alreadyConfigured) {
        const keep = visibleBillsThisMonth.filter(b => b.key !== bill.key);
        await markMonthConfigured(year, month, keep);
        setBillMonthConfiguredState(prev => [...prev, { year, month }]);
        setBillMonthActiveState(prev => [...prev, ...keep.map(b => ({ key:b.key, year, month, amount:b.amount, label:b.label, day:b.day, category:b.category }))]);
      } else {
        await setBillActiveForMonth(bill.key, year, month, false);
        setBillMonthActiveState(prev => prev.filter(r => !(r.key === bill.key && r.year === year && r.month === month)));
      }
      showToast(`Removed "${bill.label}" from ${MONTHS[month]} — other months are unaffected`);
    } catch (e) { showToast('Could not remove that bill — ' + e.message); }
  }

  /** The one-time "copy last month's bills, or start fresh?" prompt. Either
   *  choice marks the month configured, so the prompt never asks twice.
   *  Copying takes a snapshot of each bill's current amount/day/category —
   *  a starting point you can then adjust for this month specifically,
   *  not a live link back to wherever those values came from. */
  async function configureThisMonth(choice, visibleBillsThisMonth) {
    try {
      const seed = choice === 'copy' ? visibleBillsThisMonth : [];
      await markMonthConfigured(year, month, seed);
      setBillMonthConfiguredState(prev => [...prev, { year, month }]);
      setBillMonthActiveState(prev => [...prev, ...seed.map(b => ({ key:b.key, year, month, amount:b.amount, label:b.label, day:b.day, category:b.category }))]);
      showToast(choice === 'copy' ? `Copied ${seed.length} bill${seed.length===1?'':'s'} into ${MONTHS[month]} — amounts here are independent from here on` : `${MONTHS[month]} starts with no bills — add them as you go`);
    } catch (e) { showToast('Could not set up this month — ' + e.message); }
  }

  /** Edits a bill's amount/label/day/category for THIS month only — the
   *  actual fix for "amounts change month to month." Never touches the
   *  shared bill_rules row, so nothing about another month changes. */
  async function updateBillForMonth(bill, updates) {
    try {
      await setBillOverrideForMonth(bill.key, year, month, updates);
      setBillMonthActiveState(prev => [
        ...prev.filter(r => !(r.key === bill.key && r.year === year && r.month === month)),
        { key: bill.key, year, month, ...updates },
      ]);
      showToast(`Saved for ${MONTHS[month]} only`);
    } catch (e) { showToast('Could not save — ' + e.message); }
  }

  /** Confirming a suggested bill establishes the recognized pattern (so
   *  "Might be bills" stops asking) without pinning its amount globally —
   *  the amount only gets set for the month you're actually confirming it
   *  for, exactly like any other edit. */
  async function confirmSuggestedBill(b) {
    try {
      await saveBillRule({ key: b.key, label: b.label, status: 'confirmed' });
      await updateBillForMonth(b, { amount: b.amount, label: b.label, day: b.day, category: b.category });
      showToast(`"${b.label}" confirmed as a bill for ${MONTHS[month]}`);
    } catch (e) { showToast('Could not confirm that bill — ' + e.message); }
  }

  async function handleSaveNote(id, type, note) {
    try {
      if (type === 'import') {
        await updateBankImport(id, { note });
        setImports(prev => prev.map(t => t.id === id ? { ...t, note } : t));
      } else {
        await updateTransaction(id, { note });
        setTxns(prev => prev.map(t => t.id === id ? { ...t, note } : t));
      }
    } catch(e) { showToast('Could not save note'); }
  }

  useEffect(()=>{
    if(authState!=='app'||!SUPABASE_READY)return;
    const unsub=subscribeToMonth(year,month,
      ()=>getTxns(year,month).then(setTxns).catch(()=>{}),
      ()=>getSettings(year,month).then(s=>{if(s){setIncome(s.income);setCcTarget(s.cc_target);}}).catch(()=>{}),
      ()=>getBankImports(year,month).then(setImports).catch(()=>{}),
    );
    return unsub;
  },[authState,month,year]);

  // ── Partner activity (whole-budget realtime, any month) ──────────────────────
  useEffect(()=>{
    if(authState!=='app'||!SUPABASE_READY||!profile)return;
    const me=(profile.name||'').toLowerCase().split(' ')[0];

    const unsub=subscribeToPartnerActivity(payload=>{
      const row=payload.new||payload.old||{};
      const actor=(row.who||row.paid_by||row.updated_by||'').toLowerCase();
      // Ignore our own writes — only surface the partner's changes
      if(actor && me && (actor.includes(me)||me.includes(actor)))return;
      // budget_settings, category_targets, and goals rows carry no 'who'; skip rather than misattribute
      if(!actor && (payload.table==='budget_settings'||payload.table==='category_targets'||payload.table==='goals'))return;

      if(payload.table==='bill_payments'){
        getBillPayments(year,month).then(setBillPayments).catch(()=>{});
        getAllBillPayments().then(setAllBillPayments).catch(()=>{});
      }
      if(payload.table==='bill_rules'){
        getBillRules().then(setBillRules).catch(()=>{});
      }
      if(payload.table==='category_targets'){
        getCategoryTargets().then(targets=>{
          if(Object.keys(targets).length > 0) {
            setCatTargets(targets);
            localStorage.setItem(CAT_TARGETS_KEY,JSON.stringify(targets));
          }
        }).catch(()=>{});
      }
      if(payload.table==='goals'){
        getGoals().then(remote=>{
          if(remote){
            const merged=ensureGoalGroups(remote);
            setGoals(merged);
            localStorage.setItem(GOALS_KEY,JSON.stringify(merged));
          }
        }).catch(()=>{});
      }

      const {who,text}=describeChange(payload,allCats);
      const entry={id:uid(),who,text,at:Date.now()};
      setNotifs(prev=>{
        const next=[entry,...prev].slice(0,50);
        try{localStorage.setItem(NOTIFS_KEY,JSON.stringify(next));}catch{}
        return next;
      });
      
      // Track unreviewed partner transactions for helper modal
      if(payload.table === 'transactions' || payload.table === 'bill_payments' || payload.table === 'bill_rules'){
        setUnreviewed(prev => [...prev, { ...payload, displayText: text }].slice(0,20));
        setShowActivityHelper(true); // Show helper when partner activity comes in
      }
      
      showToast(text);
    });
    return unsub;
  },[authState,profile,customCats.length,year,month]);

  function clearNotifs(){
    setNotifs([]);
    try{localStorage.removeItem(NOTIFS_KEY);}catch{}
    setShowActivity(false);
  }

  // ── Debounced settings save ──────────────────────────────────────────────────
  const saveRef=useRef(null);
  async function saveSettings(ccVal){
    const cc = ccVal ?? ccTarget;
    if(saveRef.current)clearTimeout(saveRef.current);
    saveRef.current=setTimeout(async()=>{
      // income is derived from transactions now; only the CC target is stored
      try{await upsertSettings(year,month,{},cc);}catch{}
    },800);
  }

  // Ask the serverless function whether the key is configured server-side
  useEffect(()=>{ checkAI()
    .then(ok=>{ setAiOn(ok); setAiDiag(aiDiagnostics()); })
    .catch(()=>setAiOn(false)); },[]);

  // Keep localStorage in sync with expected income as a backup — the editor
  // and calendar already write on every change, but this covers any other
  // path that updates the list, including clearing it back to empty.
  useEffect(()=>{
    if(typeof window === 'undefined') return;
    try { localStorage.setItem(EXPECTED_INCOME_KEY, JSON.stringify(expectedIncome || [])); } catch {}
  }, [expectedIncome]);

  function showToast(msg){setToast(msg);setTimeout(()=>setToast(null),2600);}
  function changeMonth(dir){let m=month+dir,y=year;if(m<0){m=11;y--;}if(m>11){m=0;y++;}setMonth(m);setYear(y);}
  async function addTxn(tx){await insertTxn({...tx,id:uid(),ts:Date.now(),year,month});}
  async function removeTxn(id){await deleteTxn(id);}
  async function removeImport(id){await deleteBankImport(id);setImports(p=>p.filter(t=>t.id!==id));}

  /**
   * Photo → Storage → a row in `receipts` → Claude reads it. Returns the
   * extracted fields plus the receipt's id and image URL so the review step
   * can show the photo next to what Claude read off it, and so confirming
   * later can link back to this exact receipt.
   */
  async function scanReceipt(file) {
    const id = uid();
    const { url } = await uploadReceiptImage(file, id);
    const who = profile?.name || 'unknown';
    await insertReceipt({
      id, image_path: url, uploaded_by: who,
      uploaded_at: new Date().toISOString(), status: 'pending',
    });
    try {
      const extracted = await analyzeReceipt(file, allCats.map(c => c.id));
      await updateReceipt(id, {
        status: 'analyzed', merchant: extracted.merchant, amount: extracted.amount,
        date: extracted.date, suggested_category: extracted.category,
        confidence: extracted.confidence, note: extracted.itemsSummary,
      });
      return { id, imageUrl: url, ...extracted };
    } catch (err) {
      await updateReceipt(id, { status: 'failed', note: String(err.message || err) });
      throw err;
    }
  }

  /** Turns a reviewed/edited receipt into a real transaction, and marks the
   *  receipt row confirmed so the two stay linked. */
  async function confirmReceiptTxn(receiptId, fields) {
    const who = fields.who || profile?.name || 'unknown';
    const tx = {
      cat: fields.category, amount: fields.amount, note: fields.itemsSummary || '',
      date: fields.date, who, person: firstName(who) || 'jordan',
      merchant: fields.merchant, source: 'receipt',
    };
    await addTxn(tx);
    if (receiptId) await updateReceipt(receiptId, { status: 'confirmed' });
    showToast(`Added ${fmt(fields.amount)} from receipt`);
  }

  function addCustomCat(cat){const u=[...customCats,cat];setCustomCats(u);localStorage.setItem(CUSTOM_CATS_KEY,JSON.stringify(u));showToast(`"${cat.label}" added`);}
  function deleteCustomCat(id){const u=customCats.filter(c=>c.id!==id);setCustomCats(u);localStorage.setItem(CUSTOM_CATS_KEY,JSON.stringify(u));}
  function acceptSuggested(){
    const m={...catTargets,...suggested};
    setCatTargets(m);
    localStorage.setItem(CAT_TARGETS_KEY,JSON.stringify(m));
    if(profile?.name) upsertCategoryTargets(m,profile.name).catch(()=>{});
    setSuggested({});
    showToast('Budget targets updated');
  }
  async function handleSignOut(){await signOut();setProfile(null);setAuthState('auth');}

  // ── Render states ────────────────────────────────────────────────────────────
  if(authState==='loading') return (
    <div style={{minHeight:'100dvh',display:'flex',alignItems:'center',justifyContent:'center',background:C.sand}}>
      <div style={{textAlign:'center'}}><B42Logo size={56}/><p style={{marginTop:16,fontSize:13,color:C.inkSoft,fontFamily:SANS}}>Loading…</p></div>
    </div>
  );

  if(authState==='auth') return (
    <AuthScreen onAuth={()=>{
      supabase.auth.getSession().then(({data:{session}})=>{
        if(session?.user?.user_metadata?.name){
          setProfile({...session.user.user_metadata,email:session.user.email,id:session.user.id});
          setAuthState('app');
        }
      });
    }}/>
  );

  if(!profile) return (
    <div style={{minHeight:'100dvh',display:'flex',alignItems:'center',justifyContent:'center',background:C.sand}}>
      <Spinner size={28}/>
    </div>
  );

  const color=nameColor(profile.name);
  const NAV=[
    {id:'home',   label:'Home',   Icon:Home},
    {id:'spending',label:'Spending',Icon:Wallet},
    {id:'bills',  label:'Bills',  Icon:CalendarDays},
    {id:'calendar',label:'Calendar',Icon:Calendar},
    {id:'automation',label:'Automation',Icon:PieChart},
  ];

  return (
    <div style={{maxWidth:560,margin:'0 auto',minHeight:'100dvh',background:C.sand,
      paddingBottom:'calc(60px + env(safe-area-inset-bottom, 0px))'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes popIn{0%{opacity:0;transform:scale(0.85) translateY(8px)}70%{opacity:1;transform:scale(1.02) translateY(-1px)}100%{opacity:1;transform:scale(1) translateY(0)}}@keyframes gentleBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}`}</style>

      {/* Header — Month Navigation + Notifications Only */}
      <div style={{background:C.white,borderBottom:`1px solid ${C.sandMid}`,
        padding:'10px 16px',position:'sticky',top:0,zIndex:50,
        display:'flex',alignItems:'center',gap:10,justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <B42Badge/>
          <button onClick={()=>changeMonth(-1)} style={{border:`1px solid ${C.sandDark}`,borderRadius:8,
            padding:'5px 10px',background:C.white,fontSize:16,color:C.inkMid,lineHeight:1,cursor:'pointer'}}>‹</button>
          <p style={{flex:1,margin:0,fontFamily:SERIF,fontSize:17,fontWeight:600,minWidth:140,
            color:C.ink,textAlign:'center',letterSpacing:'-0.01em'}}>{MONTHS[month]} {year}</p>
          <button onClick={()=>changeMonth(1)} style={{border:`1px solid ${C.sandDark}`,borderRadius:8,
            padding:'5px 10px',background:C.white,fontSize:16,color:C.inkMid,lineHeight:1,cursor:'pointer'}}>›</button>
        </div>
        <button onClick={()=>setShowActivity(true)}
          title="Partner activity"
          style={{border:'none',background:'none',padding:'5px 4px',
            cursor:'pointer',position:'relative',display:'flex',alignItems:'center'}}>
          {notifs.length>0
            ? <BellRing size={19} color={C.green} strokeWidth={2}/>
            : <Bell size={19} color={C.sandDark} strokeWidth={1.6}/>}
          {notifs.length>0&&(
            <span style={{position:'absolute',top:1,right:0,minWidth:15,height:15,
              borderRadius:99,background:C.red,color:'#fff',fontSize:9,fontWeight:700,
              display:'flex',alignItems:'center',justifyContent:'center',
              padding:'0 3px',fontFamily:SANS,border:`1.5px solid ${C.white}`}}>
              {notifs.length>9?'9+':notifs.length}
            </span>
          )}
        </button>
      </div>

      {/* Top Navigation — Main Features */}
      <TopNav tabs={NAV} activeTab={tab} onTabChange={setTab} C={C} SANS={SANS} />

      {/* Content */}
      {tab==='home'    && <HomeTab txns={txns} bankImports={imports} ccTarget={ccTarget}
          allCats={allCats} catTargets={catTargets} year={year} month={month}
          view={view} setView={setView} history={history} billRules={billRules}
          billPayments={billPayments} allBillPayments={allBillPayments} profile={profile} partnerName={partnerName}
          billActiveKeys={billActiveKeys} billConfiguredMonths={billConfiguredMonths}
          expectedIncome={expectedIncome} setExpectedIncome={setExpectedIncome} onAddTxn={addTxn}
          showToast={showToast} goals={goals} onSaveGoals={saveGoals}
          depositingGoalId={depositingGoalId} setDepositingGoalId={setDepositingGoalId}
          setTab={setTab} onEditTxnSave={handleEditTxnSave} onDeleteTxn={deleteRow}/>}
      {tab==='spending' && <SpendingTab txns={txns} bankImports={imports}
          allCats={allCats} catTargets={catTargets}
          suggested={suggested} onAcceptSuggested={acceptSuggested}
          onAddCat={addCustomCat} onDeleteCat={deleteCustomCat} profile={profile} partnerName={partnerName}
          onReviewOther={openReview}
          otherCount={imports.filter(t=>(t.category||t.cat)==='other').length}
          onChangeCategory={handleChangeCategory}
          view={view} setView={setView}
          onDeleteRow={deleteRow}
          duplicateCount={findExistingDuplicates([...txns,...imports]).length}
          onReviewDuplicates={()=>setShowDupes(true)}
          setQuickAddCat={setQuickAddCat} setTab={setTab}
          setEditingCatTarget={setEditingCatTarget} showToast={showToast}
          onScanReceipt={scanReceipt} onConfirmReceipt={confirmReceiptTxn}
          onEditTxnSave={handleEditTxnSave} predictedIncomeTotal={predictedIncomeTotal}/>}
      {tab==='add'     && <AddTab profile={profile} partnerName={partnerName} allCats={allCats} quickCat={quickAddCat} onAdd={async tx=>{await addTxn(tx);showToast(`Added ${fmt(tx.amount)}`);setQuickAddCat(null);setTab('home');}}/>}
      {tab==='history' && <HistoryTab txns={txns} bankImports={imports} allCats={allCats}
          profile={profile} partnerName={partnerName}
          onDeleteTxn={removeTxn} onDeleteImport={removeImport} onSaveNote={handleSaveNote}/>}
      {tab==='bills'   && <BillsTab history={history} txns={txns}
          bankImports={imports} allCats={allCats} year={year} month={month}
          billRules={billRules} showToast={showToast} billsLocal={billsLocal}
          billPayments={billPayments} allBillPayments={allBillPayments} onTogglePaid={toggleBillPaid} profile={profile}
          billActiveKeys={billActiveKeys} billConfiguredMonths={billConfiguredMonths}
          onDeleteBillForMonth={deleteBillForMonth} onConfigureMonth={configureThisMonth}
          onUpdateBillForMonth={updateBillForMonth} onConfirmSuggestedBill={confirmSuggestedBill}
          onSaveRule={saveBillRule} onDeleteRule={removeBillRule} setTab={setTab}/>}
      {tab==='calendar' && <CalendarTab year={year} month={month} txns={txns}
          bankImports={imports} billRules={billRules} billPayments={billPayments}
          billActiveKeys={billActiveKeys} billConfiguredMonths={billConfiguredMonths}
          onDeleteBillForMonth={deleteBillForMonth} onUpdateBillForMonth={updateBillForMonth}
          expectedIncome={expectedIncome} setExpectedIncome={setExpectedIncome}
          goals={goals} onSaveGoals={saveGoals} allCats={allCats} history={history}
          showToast={showToast} onSaveRule={saveBillRule} onDeleteRule={removeBillRule}/>}
      {tab==='automation' && <AutomationTab txns={txns} bankImports={imports} allCats={allCats}
          year={year} month={month} personView={view} profile={profile} partnerName={partnerName}
          showToast={showToast} onImported={loadAll} aiOn={aiOn} aiDiag={aiDiag}/>}

      {showReset && (
        <ResetModal
          year={year} month={month}
          showToast={showToast}
          onClose={()=>setShowReset(false)}
          onDone={async ()=>{
            setShowReset(false);
            setCustomCats([]); setCatTargets({}); setSuggested({}); setNotifs([]);
            await loadAll();
          }}
        />
      )}

      {showDupes && (
        <DuplicateModal
          rows={[...txns, ...imports]}
          allCats={allCats}
          showToast={showToast}
          onDelete={deleteRows}
          onClose={()=>setShowDupes(false)}
        />
      )}

      {/* Partner activity panel */}
      {showActivity && (
        <ActivityPanel
          items={notifs}
          onClose={()=>setShowActivity(false)}
          onClear={clearNotifs}
        />
      )}

      {/* OtherReviewModal */}
      {showReview && otherItems.length > 0 && (
        <OtherReviewModal
          items={otherItems}
          allCats={allCats}
          onDeleteRow={async tx => { await deleteRow(tx); setOtherItems(p=>p.filter(t=>t.id!==tx.id)); }}
          onSave={async () => {
            setShowReview(false);
            await loadAll();
            showToast('Categories saved');
          }}
          onClose={() => setShowReview(false)}
        />
      )}
      {/* Bottom bar with settings and export */}
      <BottomBar 
        profile={profile} 
        onSettings={() => setShowReset(true)}
        onViewChange={() => setView(view === 'combined' ? 'solo' : 'combined')}
        view={view}
        onExport={() => setShowExport(true)}
        onEmailPreview={() => setShowEmailPreview(true)}
        C={C}
        SANS={SANS}
        nameColor={nameColor}
        nameInitials={nameInitials}
      />

      {/* Partner activity helper modal */}
      {showActivityHelper && unreviewed.length > 0 && (
        <PartnerActivityHelper
          unreviewed={unreviewed}
          onClose={() => setShowActivityHelper(false)}
          C={C}
          SERIF={SERIF}
          SANS={SANS}
        />
      )}

      {/* Edit category target modal */}
      {editingCatTarget && (
        <EditCategoryTargetModal
          catId={editingCatTarget}
          catLabel={allCats.find(c => c.id === editingCatTarget)?.label || 'Category'}
          currentTarget={catTargets[editingCatTarget] || allCats.find(c => c.id === editingCatTarget)?.target || 0}
          onSave={async (catId, newAmount) => {
            const updated = { ...catTargets, [catId]: newAmount };
            setCatTargets(updated);
            localStorage.setItem(CAT_TARGETS_KEY, JSON.stringify(updated));
            try {
              await upsertCategoryTargets(updated, profile?.name || 'unknown');
            } catch (e) {
              showToast('Could not save to server, but saved locally');
            }
            showToast(`Budget for ${allCats.find(c => c.id === catId)?.label} updated to $${newAmount.toFixed(2)}`);
          }}
          onClose={() => setEditingCatTarget(null)}
          C={C}
          SERIF={SERIF}
          SANS={SANS}
        />
      )}

      {/* Weekly email preview modal */}
      {showEmailPreview && (
        <WeeklyEmailPreviewModal 
          txns={txns}
          bankImports={imports}
          billPayments={billPayments}
          billRules={billRules}
          profile={profile}
          year={year}
          month={month}
          onClose={() => setShowEmailPreview(false)}
          showToast={showToast}
          C={C}
          SERIF={SERIF}
          SANS={SANS}
        />
      )}

      {/* Export modal */}
      {showExport && (
        <ExportModal 
          year={year} 
          month={month} 
          txns={txns} 
          bankImports={imports}
          billPayments={billPayments}
          billRules={billRules}
          onClose={() => setShowExport(false)}
          showToast={showToast}
          C={C}
          SERIF={SERIF}
          SANS={SANS}
          MONTHS={MONTHS}
        />
      )}

      {toast&&<Toast msg={toast}/>}
    </div>
  );
}
