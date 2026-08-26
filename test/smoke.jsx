/**
 * Renders the real components with mock data.
 *
 * A build only proves the code parses. These three bugs all parsed fine and
 * then threw on first render: a missing constant, a stale variable reference,
 * and a temporal dead zone. Rendering catches that class.
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { detectRecurring, splitRecurring, getCarriedOverBills, applyBillRules } from '../src/recurring.js';
import { getBudgetAdvice } from '../src/advice.js';
import { categorizeBudget } from '../src/categorize.js';
import { findSharedMoments, summariseTogether } from '../src/together.js';
import { buildValidationReport } from '../src/validate.js';
import { detectPartnerTransfers } from '../src/together.js';
import App, { HomeTab, SpendingTab, BillsTab, CalendarTab, HistoryTab, ChartsTab, UploadTab,
  AutomationTab, AuthScreen, AddTab, AddCatModal, ReceiptScanModal, ReceiptHistoryModal, EditTransactionModal, OtherReviewModal, ActivityPanel,
  ResetModal, BillEditModal, DuplicateModal, filterByView, resolveWho, monthStampFor, shouldShowBudgetSuggestions,
  buildBillsPrintHtml, WeeklyEmailPreviewModal, resolveTestEmailTarget, describeReceiptsBackendIssue,
  describeBillPaidBy,
  C, SERIF, SANS } from '../src/App.jsx';
import { isHeic, scaleFactorFor, MAX_EDGE } from '../src/receipt.js';
import { isRlsDenied } from '../src/supabase.js';

const mk = (o = {}) => ({
  id: Math.random().toString(36).slice(2),
  date: '2026-07-12', description: 'LOBLAWS 1032', amount: 84.2,
  category: 'groceries', source: 'BMO', who: 'jordan',
  year: 2026, month: 6, direction: 'debit', ...o,
});

const history = [];
[3,4,5].forEach(m => {
  history.push(mk({ month:m, date:`2026-0${m+1}-30`, description:'STELA RENT', amount:1900, category:'other' }));
  history.push(mk({ month:m, date:`2026-0${m+1}-02`, description:'NETFLIX.COM', amount:9.03, category:'subscriptions' }));
  history.push(mk({ month:m, date:`2026-0${m+1}-11`, description:'LOBLAWS 1032', amount:60+m*20 }));
});

const txns = [];
const imports = [
  mk(), 
  mk({ description:'STELA RENT', amount:1900, category:'other', date:'2026-07-30' }),
  mk({ description:'NORR PAYROLL', amount:3984.44, category:'income', direction:'credit' }),
  mk({ description:'BAR RAVAL', amount:64, category:'restaurant', who:'jordan' }),
  mk({ description:'BAR RAVAL', amount:38.5, category:'restaurant', who:'ness', source:'CIBC' }),
];

const results = [];
const pending = [];
function check(name, fn) {
  try {
    const ret = fn();
    if (ret && typeof ret.then === 'function') {
      // Async check — don't let it report "ok" before it's actually resolved.
      pending.push(ret.then(
        () => results.push(['ok  ', name]),
        e  => results.push(['FAIL', name + '  →  ' + e.message])
      ));
    } else {
      results.push(['ok  ', name]);
    }
  } catch (e) { results.push(['FAIL', name + '  →  ' + e.message]); }
}

check('detectRecurring',   () => detectRecurring(history));

// Electricity is no longer its own spending category — utility charges should
// route into 'rent' (labeled "Home" in the UI) rather than a dead category id.
check('categorizeBudget: electricity routes into Home (rent id), not its own category', () => {
  const cat = categorizeBudget('TORONTO HYDRO PAD');
  if (cat !== 'rent') throw new Error(`expected 'rent' (Home), got '${cat}'`);
});
check('categorizeBudget: rent still routes into Home (rent id)', () => {
  const cat = categorizeBudget('STELA RENT PAYMENT');
  if (cat !== 'rent') throw new Error(`expected 'rent' (Home), got '${cat}'`);
});

check('splitRecurring',    () => splitRecurring(detectRecurring(history), imports));

check('getCarriedOverBills: unpaid last month carries forward as overdue', () => {
  // history already has NETFLIX.COM charged every month for Apr/May/Jun 2026.
  // Add a July charge for something else (so we know we HAVE a July statement)
  // but no Netflix charge in July — that's the unpaid month to detect.
  const withJuly = [...history, mk({ month:6, date:'2026-07-11', description:'LOBLAWS 1032', amount:70 })];
  const recurring = detectRecurring(withJuly).filter(b => b.confidence === 'high');
  const today = new Date(2026, 7, 15); // viewing August, as of Aug 15
  const carried = getCarriedOverBills(recurring, withJuly, [], 2026, 7, today);
  const netflix = carried.find(c => c.label.toUpperCase().includes('NETFLIX'));
  if (!netflix) throw new Error('expected NETFLIX to carry forward as overdue from July');
  if (netflix.carriedFrom.month !== 6) throw new Error('expected carriedFrom month to be July (6)');
  if (netflix.status !== 'overdue') throw new Error('expected status overdue');
});

check('getCarriedOverBills: paid last month does not carry forward', () => {
  const withJulyPaid = [...history,
    mk({ month:6, date:'2026-07-11', description:'LOBLAWS 1032', amount:70 }),
    mk({ month:6, date:'2026-07-02', description:'NETFLIX.COM', amount:9.03 }),
  ];
  const recurring = detectRecurring(withJulyPaid).filter(b => b.confidence === 'high');
  const today = new Date(2026, 7, 15);
  const carried = getCarriedOverBills(recurring, withJulyPaid, [], 2026, 7, today);
  const netflix = carried.find(c => c.label.toUpperCase().includes('NETFLIX'));
  if (netflix) throw new Error('did not expect NETFLIX to carry forward — it was charged in July');
});

check('getCarriedOverBills: only applies when viewing the real current month', () => {
  const withJuly = [...history, mk({ month:6, date:'2026-07-11', description:'LOBLAWS 1032', amount:70 })];
  const recurring = detectRecurring(withJuly).filter(b => b.confidence === 'high');
  const today = new Date(2026, 7, 15); // today is August, but we're asking about September
  const carried = getCarriedOverBills(recurring, withJuly, [], 2026, 8, today);
  if (carried.length !== 0) throw new Error('expected no carry-forward when not viewing the current real month');
});

// getBudgetAdvice calls out to /api/claude, which has no meaning in this Node
// test environment — fetch to a relative URL throws immediately, so these
// exercise the graceful rule-based fallback path deterministically, without
// needing network mocking.
check('getBudgetAdvice: falls back to a rules-based tip when AI is unreachable', async () => {
  const result = await getBudgetAdvice({
    availableMoney: 500, actualIncome: 3000, predictedIncomeTotal: 3000,
    spentSoFar: 200, billsNotChargedYet: 100, budgetedForSpending: 1000, goalsMonthlyTotal: 0,
  });
  if (result.source !== 'rules') throw new Error('expected the rules fallback in a Node test environment');
  if (!result.advice || typeof result.advice !== 'string') throw new Error('expected a non-empty advice string');
});

check('getBudgetAdvice: warns when bills outstanding exceed available money', async () => {
  const result = await getBudgetAdvice({
    availableMoney: 200, actualIncome: 3000, predictedIncomeTotal: 3000,
    spentSoFar: 200, billsNotChargedYet: 3000, budgetedForSpending: 1000, goalsMonthlyTotal: 0,
  });
  if (!/hasn't been charged|hold off/i.test(result.advice)) {
    throw new Error('expected advice to mention holding off given large outstanding bills, got: ' + result.advice);
  }
});

check('getBudgetAdvice: warns when budget exceeds predicted income', async () => {
  const result = await getBudgetAdvice({
    availableMoney: 500, actualIncome: 1000, predictedIncomeTotal: 2000,
    spentSoFar: 100, billsNotChargedYet: 0, budgetedForSpending: 5000, goalsMonthlyTotal: 0,
  });
  if (!/predicted to come in|budget/i.test(result.advice)) {
    throw new Error('expected advice to mention the budget/predicted-income mismatch, got: ' + result.advice);
  }
});

check('findSharedMoments', () => findSharedMoments([...txns, ...imports]));
check('summariseTogether', () => summariseTogether(findSharedMoments(imports).shared));
check('validationReport',  () => buildValidationReport(imports.map(r=>({...r,_type:r.direction})), history));
check('partnerTransfers',  () => detectPartnerTransfers(imports.map(r=>({...r,_type:r.direction})), history));

// Now the real component tree
check('render App', () => renderToString(React.createElement(App)));

// The tabs are where the real logic lives — render each with mock data
const profile = { name:'Jordan Yerbury', goal:'Pay down credit card debt' };
const allCats = [
  {id:'groceries',label:'Groceries',icon:'ShoppingBasket',target:400,color:'#1a7a4a'},
  {id:'restaurant',label:'Dining out',icon:'Utensils',target:250,color:'#1d4ed8'},
  {id:'subscriptions',label:'Subscriptions',icon:'CreditCard',target:155,color:'#0891b2'},
  {id:'other',label:'Other',icon:'Package',target:200,color:'#6b7280'},
  {id:'cc_payment',label:'Credit card payments',icon:'CreditCard',target:0,color:'#57534e',excluded:true},
  {id:'income',label:'Income',icon:'Leaf',target:0,color:'#1a7a4a',excluded:true,isIncome:true},
];
const noop = () => {};
const goals = [
  { id: 'g1', person: 'jordan', label: 'Short-term Goal', target: 5000, monthlyContribution: 500, description: 'Emergency fund', currentBalance: 1200, deposits: [] },
  { id: 'g2', person: 'jordan', label: 'Medium-term Goal', target: 3000, monthlyContribution: 200, description: '', currentBalance: 0, deposits: [] },
  { id: 'g3', person: 'jordan', label: 'Long-term Goal', target: 20000, monthlyContribution: 300, description: '', currentBalance: 0, deposits: [] },
  { id: 'g4', person: 'mariel', label: 'Short-term Goal', target: 600, monthlyContribution: 100, description: '', currentBalance: 600, deposits: [] },
  { id: 'g5', person: 'mariel', label: 'Medium-term Goal', target: 2200, monthlyContribution: 250, description: '', currentBalance: 500, deposits: [] },
  { id: 'g6', person: 'mariel', label: 'Long-term Goal', target: 4000, monthlyContribution: 150, description: '', currentBalance: 0, deposits: [] },
  { id: 'g7', person: 'couple', label: 'Short-term Goal', target: 1000, monthlyContribution: 100, description: '', currentBalance: 0, deposits: [] },
  { id: 'g8', person: 'couple', label: 'Medium-term Goal', target: 5000, monthlyContribution: 400, description: '', currentBalance: 0, deposits: [] },
  { id: 'g9', person: 'couple', label: 'Long-term Goal', target: 15000, monthlyContribution: 750, description: '', currentBalance: 13000, deposits: [] },
];

const expectedIncomeMock = [
  { id: 'inc1', date: '2026-07-14', amount: 2012, description: 'NORR', account: 'Joint chequing', person: 'both' },
  { id: 'inc2', date: '2026-06-01', amount: 500, description: 'Old month entry', account: '', person: 'both' },
];

// Regression guard: 'income' is no longer a row in the real category list
// (DEFAULT_CATS), but income transactions must still be excluded from spend
// totals via the ALWAYS_EXCLUDED_CATS safety net, not by allCats membership.
check('HomeTab: income excluded from spend totals even when not in allCats', () => {
  const catsWithoutIncome = allCats.filter(c => c.id !== 'income');
  const bigPaycheck = mk({ description: 'NORR PAYROLL', amount: 5000, category: 'income', direction: 'credit' });
  const smallGroceryRun = mk({ description: 'LOBLAWS 1032', amount: 50, category: 'groceries' });
  const html = renderToString(React.createElement(HomeTab, {
    txns: [], bankImports: [bigPaycheck, smallGroceryRun], ccTarget: 0,
    allCats: catsWithoutIncome, catTargets: {}, year: 2026, month: 6,
    profile, view: 'combined', setView: noop, history: [], billRules: [],
    billPayments: [],
    expectedIncome: [], setExpectedIncome: noop,
    showToast: noop, goals: [], onSaveGoals: noop,
    depositingGoalId: null, setDepositingGoalId: noop
  }));
  if (html.includes('5,050.00')) {
    throw new Error('income leaked into spend total — got $5,050 instead of $50');
  }
  if (!html.includes('50.00')) {
    throw new Error('expected spend total to reflect the $50 grocery run');
  }
});

check('HomeTab: Actual Income section is visible and shows the real total', () => {
  const paycheck = mk({ description: 'NORR PAYROLL', amount: 3200, category: 'income', direction: 'credit', who: 'jordan' });
  const html = renderToString(React.createElement(HomeTab, {
    txns: [], bankImports: [paycheck], ccTarget: 0,
    allCats, catTargets: {}, year: 2026, month: 6,
    profile, partnerName: 'Mariel', view: 'combined', setView: noop, history: [], billRules: [],
    billPayments: [],
    expectedIncome: [], setExpectedIncome: noop, onAddTxn: noop,
    showToast: noop, goals: [], onSaveGoals: noop,
    depositingGoalId: null, setDepositingGoalId: noop
  }));
  if (!html.includes('Actual Income This Month')) {
    throw new Error('expected an "Actual Income This Month" section to render');
  }
  if (!html.includes('3,200.00')) {
    throw new Error('expected the actual income total ($3,200) to appear');
  }
  if (!html.includes('Add actual income manually')) {
    throw new Error('expected a way to manually add actual income');
  }
});

check('HomeTab: Available Money = Income − Spent − Bills Paid, no double-counting', () => {
  // A recognized bill (rent) plus one discretionary grocery run, both charged
  // this month, plus a paycheck. The two spend buckets must sum to exactly
  // what was spent — nothing counted twice, nothing missing.
  const rentBillHistory = [
    mk({ year:2026, month:4, date:'2026-05-01', description:'STELA RENT', amount:1900, category:'rent' }),
    mk({ year:2026, month:5, date:'2026-06-01', description:'STELA RENT', amount:1900, category:'rent' }),
  ];
  const rentThisMonth = mk({ description:'STELA RENT', amount:1900, category:'rent', date:'2026-07-01' });
  const groceries = mk({ description:'LOBLAWS 1032', amount:120, category:'groceries', date:'2026-07-10' });
  const paycheck = mk({ description:'NORR PAYROLL', amount:5000, category:'income', direction:'credit', date:'2026-07-15' });

  const html = renderToString(React.createElement(HomeTab, {
    txns: [], bankImports: [rentThisMonth, groceries, paycheck], ccTarget: 0,
    allCats, catTargets: {}, year: 2026, month: 6,
    profile, partnerName: 'Mariel', view: 'combined', setView: noop,
    history: [...rentBillHistory, rentThisMonth, groceries, paycheck],
    billRules: [], billPayments: [],
    expectedIncome: [], setExpectedIncome: noop, onAddTxn: noop,
    showToast: noop, goals: [], onSaveGoals: noop,
    depositingGoalId: null, setDepositingGoalId: noop,
    setTab: noop, onEditTxnSave: noop, onDeleteTxn: noop
  }));

  if (!html.includes('Available Money')) throw new Error('expected an "Available Money" hero label');
  if (!html.includes('Bills Paid')) throw new Error('expected a "Bills Paid" stat');
  if (!html.includes('1,900.00')) throw new Error('expected the $1,900 rent to appear as bills paid');
  if (!html.includes('120.00')) throw new Error('expected the $120 groceries to appear as spent this month');
  // Available = 5000 - 120 - 1900 = 2980.00 — must appear once, not some
  // double-subtracted lower figure like 980.00 (5000-120-1900-1900)
  if (!html.includes('2,980.00')) throw new Error('Available Money is wrong — looks like bills were subtracted twice');
});

// Bug report, with screenshots: Bills tab showed $3,260.75 paid this
// month. Home's "Bills Paid This Month" showed only $387.46 for the exact
// same month. Traced it to several of the paid bills being credit card
// payments (category 'cc_payment') — a category that's normally EXCLUDED
// from spend totals, to avoid double-counting the purchases it covers.
// Bills Paid used to be derived by filtering transactions down to
// bill-matching categories, which silently dropped ANY bill whose own
// category happened to be excluded — so a real, ticked-paid $480 credit
// card bill contributed exactly $0 to Home's figure, even though the
// Bills tab correctly counted it.
// Predicted income should sit faintly under Actual Income as context —
// visible, but never folded into any total.
// A scanned receipt saved to the database but never appeared in Charges.
// Two causes: addTxn didn't update on-screen state (and the realtime
// listener deliberately ignores our own writes, so nothing refreshed it),
// and it stamped year/month from the month being VIEWED rather than the
// transaction's own date — so a July receipt scanned in August filed
// itself under August. monthStampFor covers the second half.
check('monthStampFor: uses the transaction\'s own date, not the month on screen', () => {
  // Viewing August 2026 (month index 7), receipt dated 12 July 2026
  const r = monthStampFor('2026-07-12', 2026, 7);
  if (r.year !== 2026 || r.month !== 6) {
    throw new Error(`a July receipt must file under July (month 6), got year=${r.year} month=${r.month}`);
  }
});

check('monthStampFor: falls back to the viewed month when the date is missing or unusable', () => {
  const missing = monthStampFor('', 2026, 7);
  if (missing.year !== 2026 || missing.month !== 7) throw new Error('expected the viewed month when no date is given');
  const junk = monthStampFor('not-a-date', 2026, 7);
  if (junk.year !== 2026 || junk.month !== 7) throw new Error('expected the viewed month when the date is unparseable');
});

check('monthStampFor: keeps a same-month transaction in that month', () => {
  const r = monthStampFor('2026-08-03', 2026, 7);
  if (r.year !== 2026 || r.month !== 7) throw new Error('an August transaction viewed in August must stay in August');
});

check('HomeTab: shows predicted income beneath actual, without adding it to any total', () => {
  const paycheck = mk({ description:'NORR PAYROLL', amount:5000, category:'income', direction:'credit', date:'2026-07-15' });
  const html = renderToString(React.createElement(HomeTab, {
    txns: [], bankImports: [paycheck], ccTarget: 0,
    allCats, catTargets: {}, year: 2026, month: 6,
    profile, partnerName: 'Mariel', view: 'combined', setView: noop,
    history: [], billRules: [], billPayments: [],
    expectedIncome: [{ id:'p1', date:'2026-07-28', amount:1200, description:'Second paycheck', person:'both' }],
    setExpectedIncome: noop, onAddTxn: noop,
    showToast: noop, goals: [], onSaveGoals: noop,
    depositingGoalId: null, setDepositingGoalId: noop,
    setTab: noop, onEditTxnSave: noop, onDeleteTxn: noop
  }));
  if (!html.includes('1,200.00')) throw new Error('expected the $1,200 predicted income to be shown');
  if (!html.includes('predicted')) throw new Error('expected the predicted figure to be labelled as predicted');
  // Actual income must stay $5,000 — predicted is context, never added in
  if (html.includes('6,200.00')) throw new Error('predicted income was added into actual income — it must never be');
});

check('HomeTab: a bill categorized as a credit card payment counts as Bills Paid, matching the Bills tab — not silently dropped', () => {
  const ccPaymentBill = { key:'manual:scotiabank', label:'Scotiabank Credit Card', amount:480, day:15, status:'manual', category:'cc_payment' };
  const groceries = mk({ description:'LOBLAWS 1032', amount:120, category:'groceries', date:'2026-07-10' });
  const paycheck = mk({ description:'NORR PAYROLL', amount:5000, category:'income', direction:'credit', date:'2026-07-15' });

  const html = renderToString(React.createElement(HomeTab, {
    txns: [], bankImports: [groceries, paycheck], ccTarget: 0,
    allCats, catTargets: {}, year: 2026, month: 6,
    profile, partnerName: 'Mariel', view: 'combined', setView: noop,
    history: [],
    billRules: [ccPaymentBill],
    billPayments: [{ key:'manual:scotiabank', year:2026, month:6, label:'Scotiabank Credit Card', paid_by:'Jordan', paid_at:'2026-07-15T00:00:00.000Z' }],
    expectedIncome: [], setExpectedIncome: noop, onAddTxn: noop,
    showToast: noop, goals: [], onSaveGoals: noop,
    depositingGoalId: null, setDepositingGoalId: noop,
    setTab: noop, onEditTxnSave: noop, onDeleteTxn: noop
  }));

  if (!html.includes('480.00')) {
    throw new Error('the $480 credit card payment is missing from Bills Paid — this reproduces the reported bug exactly');
  }
});

// Bug report: Spending tab showed "Spent so far $4,005.31" while Home
// showed "Other Spending $3,565.85" for the same month — two different
// numbers under two similarly-named labels. Both were technically correct
// under their own (different) definitions, which is exactly the problem:
// Spending counted bill-category transactions, Home deliberately didn't
// (to avoid double-counting with Bills Paid). This proves they're now
// the same calculation, not two approximations of a similar idea — a
// recognized bill's category (Netflix → 'subscriptions') is excluded from
// BOTH tabs' spending totals identically, given the exact same underlying
// data.
check('SpendingTab and HomeTab show the exact same spending total for identical data', () => {
  const netflixBill = { key:'manual:netflix', label:'Netflix', amount:15, day:2, status:'manual', category:'subscriptions' };
  const netflixCharge = mk({ description:'NETFLIX.COM', amount:15, category:'subscriptions', date:'2026-07-02' });
  const groceries = mk({ description:'LOBLAWS 1032', amount:120, category:'groceries', date:'2026-07-10' });
  const paycheck = mk({ description:'NORR PAYROLL', amount:5000, category:'income', direction:'credit', date:'2026-07-15' });

  const sharedProps = {
    year: 2026, month: 6, history: [], billRules: [netflixBill],
    billActiveKeys: new Map(), billConfiguredMonths: new Map(),
  };

  const homeHtml = renderToString(React.createElement(HomeTab, {
    txns: [], bankImports: [netflixCharge, groceries, paycheck], ccTarget: 0,
    allCats, catTargets: {}, ...sharedProps,
    profile, partnerName: 'Mariel', view: 'combined', setView: noop,
    billPayments: [],
    expectedIncome: [], setExpectedIncome: noop, onAddTxn: noop,
    showToast: noop, goals: [], onSaveGoals: noop,
    depositingGoalId: null, setDepositingGoalId: noop,
    setTab: noop, onEditTxnSave: noop, onDeleteTxn: noop
  }));

  const spendingHtml = renderToString(React.createElement(SpendingTab, {
    txns: [], bankImports: [netflixCharge, groceries, paycheck],
    allCats, catTargets: {}, ...sharedProps,
    suggested: {}, onAcceptSuggested: noop, onDismissSuggested: noop,
    onAddCat: noop, onDeleteCat: noop, profile, partnerName: 'Mariel',
    onReviewOther: noop, otherCount: 0, onChangeCategory: noop,
    view: 'combined', setView: noop,
    onDeleteRow: noop, duplicateCount: 0, onReviewDuplicates: noop,
    setQuickAddCat: noop, setTab: noop,
    setEditingCatTarget: noop, showToast: noop,
    onScanReceipt: noop, onConfirmReceipt: noop, onEditTxnSave: noop
  }));

  // Both should show $120 (groceries only) — NOT $135 (groceries + the
  // $15 Netflix bill charge), and NOT disagree with each other.
  if (!homeHtml.includes('120.00')) throw new Error('expected Home\'s Other Spending to show $120 (Netflix excluded as a bill category)');
  if (!spendingHtml.includes('120.00')) throw new Error('expected Spending\'s total to show $120 (Netflix excluded as a bill category) — this is the reported mismatch');
  if (spendingHtml.includes('135.00') || homeHtml.includes('135.00')) {
    throw new Error('a bill-category transaction leaked into the discretionary total on one of the two tabs');
  }
});

// Regression guard for a real, reproducible bug: new Date('2026-08-01') parses
// as UTC midnight. In any timezone behind UTC (Toronto included), reading it
// back with local getters like getMonth() rolls it back to the previous day —
// and for an entry dated the 1st, that means the previous MONTH. It would
// then vanish from that month's filtered "predicted income" view entirely,
// which is exactly what was reported. This test forces the timezone that
// actually exhibits the bug (the sandbox defaults to UTC, where the bug does
// NOT reproduce), so it only proves something if parseLocalDate is doing its
// job rather than passing by accident.
check('Predicted income dated the 1st does not vanish in a timezone behind UTC', () => {
  const originalTZ = process.env.TZ;
  process.env.TZ = 'America/Toronto';
  try {
    // Sanity-check the premise: naive parsing really does exhibit the bug
    // here, so this test would actually catch a regression, not pass blindly.
    const naive = new Date('2026-08-01');
    if (naive.getMonth() !== 6) {
      throw new Error('test premise failed: naive Date parsing did not reproduce the known bug in this environment — the TZ setting may not be taking effect');
    }

    const augFirstEntry = { id:'inc1', date:'2026-08-01', amount:2012, description:'NORR', account:'', person:'both' };
    const html = renderToString(React.createElement(HomeTab, {
      txns: [], bankImports: [], ccTarget: 0,
      allCats, catTargets: {}, year: 2026, month: 7, // viewing August (0-indexed 7)
      profile, partnerName: 'Mariel', view: 'combined', setView: noop,
      history: [], billRules: [], billPayments: [],
      expectedIncome: [augFirstEntry], setExpectedIncome: noop, onAddTxn: noop,
      showToast: noop, goals: [], onSaveGoals: noop,
      depositingGoalId: null, setDepositingGoalId: noop,
      setTab: noop, onEditTxnSave: noop, onDeleteTxn: noop
    }));

    if (!html.includes('2,012.00')) {
      throw new Error('the $2,012 predicted income dated Aug 1 did not appear while viewing August — it vanished into the wrong month');
    }
  } finally {
    process.env.TZ = originalTZ;
  }
});

check('CalendarTab: predicted and actual income are shown separately, never summed together', () => {
  const originalTZ = process.env.TZ;
  process.env.TZ = 'America/Toronto';
  try {
    const predicted = { id:'inc1', date:'2026-07-15', amount:2000, description:'Expected paycheck', account:'', person:'both' };
    const actualDeposit = mk({ description:'NORR PAYROLL', amount:3984.44, category:'income', direction:'credit', date:'2026-07-15' });

    const html = renderToString(React.createElement(CalendarTab, {
      year: 2026, month: 6, txns: [], bankImports: [actualDeposit],
      billRules: [], billPayments: [],
      expectedIncome: [predicted], setExpectedIncome: noop,
      goals: [], onSaveGoals: noop, allCats, history: [],
      showToast: noop, onSaveRule: noop, onDeleteRule: noop
    }));

    // Each figure should appear on its own — never combined into one 5984.44
    // (Calendar's month-grid badges show a compact "$Xk" format to fit
    // narrow cells — see the calendar overflow fix.)
    if (html.includes('$6.0k')) {
      throw new Error('predicted and actual income were added together into one figure — they must stay separate');
    }
    if (!html.includes('$2.0k')) throw new Error('expected the $2,000 predicted income to appear on its own (compact as $2.0k)');
    if (!html.includes('$4.0k')) throw new Error('expected the $3,984.44 actual income to appear on its own (compact as $4.0k)');
  } finally {
    process.env.TZ = originalTZ;
  }
});

check('SpendingTab: dashboard shows Still Available To Spend', () => {
  const groceries = mk({ description:'LOBLAWS 1032', amount:120, category:'groceries', date:'2026-07-10' });
  const html = renderToString(React.createElement(SpendingTab, {
    txns: [], bankImports: [groceries],
    allCats, catTargets: {}, suggested: {},
    onAcceptSuggested: noop, onAddCat: noop, onDeleteCat: noop,
    profile, onReviewOther: noop, otherCount: 0, onChangeCategory: noop,
    view: 'combined', setView: noop,
    onDeleteRow: noop, duplicateCount: 0, onReviewDuplicates: noop,
    setQuickAddCat: noop, setTab: noop,
    setEditingCatTarget: noop, showToast: noop,
    onScanReceipt: noop, onConfirmReceipt: noop, onEditTxnSave: noop
  }));
  if (!html.includes('Still Available To Spend')) throw new Error('expected the Spending tab dashboard hero');
  if (!html.includes('120.00')) throw new Error('expected the $120 grocery spend to appear');
});

// Bug report (reversing an earlier decision): "when I click either myself
// or my partner spending, it should ONLY show personal spending, not
// combined." An earlier version split Combined evenly between the two
// people, on the theory that shared-card attribution was too unreliable to
// show real per-person totals. Attribution is solid now — every
// transaction carries a "who," visible as an avatar on each row — so each
// view shows that person's REAL charges. The two totals will not each be
// half of Combined, and that's the point: one person genuinely spends more
// some months, and the app should say so.
check('SpendingTab: each person sees their own real charges, not an even split of Combined', () => {
  // Deliberately unequal: Jordan $300, Ness $60.
  const jordanTxn = mk({ description:'BIG PURCHASE', amount:300, category:'groceries', date:'2026-07-10', who:'Jordan Yerbury' });
  const nessTxn = mk({ description:'SMALL PURCHASE', amount:60, category:'groceries', date:'2026-07-11', who:'Mariel Smith' });

  const render = (view) => renderToString(React.createElement(SpendingTab, {
    txns: [], bankImports: [jordanTxn, nessTxn],
    allCats, catTargets: {}, suggested: {},
    onAcceptSuggested: noop, onAddCat: noop, onDeleteCat: noop,
    profile, partnerName: 'Mariel Smith', onReviewOther: noop, otherCount: 0, onChangeCategory: noop,
    view, setView: noop,
    onDeleteRow: noop, duplicateCount: 0, onReviewDuplicates: noop,
    setQuickAddCat: noop, setTab: noop,
    setEditingCatTarget: noop, showToast: noop,
    onScanReceipt: noop, onConfirmReceipt: noop, onEditTxnSave: noop
  }));

  const combined = render('combined');
  const mine = render('mine');       // Jordan (profile's own name)
  const partner = render('partner'); // Ness/Mariel

  if (!combined.includes('360.00')) throw new Error('expected Combined to show the true household total ($360)');

  // Each view must show that person's OWN real spending
  if (!mine.includes('300.00')) throw new Error('expected Jordan\'s view to show his real $300 of charges');
  if (!partner.includes('60.00')) throw new Error('expected Ness\'s view to show her real $60 of charges');

  // And must NOT show the other person's money, or an even split
  if (partner.includes('300.00')) throw new Error('Ness\'s view is showing Jordan\'s $300 — individual views must be personal only');
  if (mine.includes('180.00') || partner.includes('180.00')) {
    throw new Error('still showing an even half-split of Combined instead of real personal spending');
  }
});

['mine','combined'].forEach(v => {
  check('render HomeTab (' + v + ')', () => renderToString(React.createElement(HomeTab, {
    txns, bankImports: imports, ccTarget: 500,
    allCats, catTargets: {}, year: 2026, month: 6,
    profile, partnerName: 'Mariel', view: v, setView: noop, history, billRules: [],
    billPayments: [],
    expectedIncome: expectedIncomeMock, setExpectedIncome: noop, onAddTxn: noop,
    showToast: noop, goals, onSaveGoals: noop,
    depositingGoalId: null, setDepositingGoalId: noop,
    setTab: noop, onEditTxnSave: noop, onDeleteTxn: noop
  })));

  check('render SpendingTab (' + v + ')', () => renderToString(React.createElement(SpendingTab, {
    txns, bankImports: imports,
    allCats, catTargets: {}, suggested: {},
    onAcceptSuggested: noop, onAddCat: noop, onDeleteCat: noop,
    profile, onReviewOther: noop, otherCount: 0, onChangeCategory: noop,
    view: v, setView: noop,
    onDeleteRow: noop, duplicateCount: 2, onReviewDuplicates: noop,
    setQuickAddCat: noop, setTab: noop,
    setEditingCatTarget: noop, showToast: noop,
    onScanReceipt: noop, onConfirmReceipt: noop, onEditTxnSave: noop
  })));
});

check('render HomeTab (no history)', () => renderToString(React.createElement(HomeTab, {
  txns: [], bankImports: [], ccTarget: 0,
  allCats, catTargets: {}, year: 2026, month: 6,
  profile, partnerName: 'Mariel', view: 'combined', setView: noop, history: [], billRules: [],
  billPayments: [],
  expectedIncome: [], setExpectedIncome: noop, onAddTxn: noop,
  showToast: noop, goals: [], onSaveGoals: noop,
  depositingGoalId: null, setDepositingGoalId: noop,
  setTab: noop, onEditTxnSave: noop, onDeleteTxn: noop
})));

check('render SpendingTab (no history)', () => renderToString(React.createElement(SpendingTab, {
  txns: [], bankImports: [],
  allCats, catTargets: {}, suggested: {},
  onAcceptSuggested: noop, onAddCat: noop, onDeleteCat: noop,
  profile, onReviewOther: noop, otherCount: 0, onChangeCategory: noop,
  view: 'combined', setView: noop,
  onDeleteRow: noop, duplicateCount: 0, onReviewDuplicates: noop,
  setQuickAddCat: noop, setTab: noop,
  setEditingCatTarget: noop, showToast: noop,
  onScanReceipt: noop, onConfirmReceipt: noop, onEditTxnSave: noop
})));

// The actual bug report: "uploading bills does not work." Traced to the
// receipts feature needing a Storage bucket AND a database table that may
// never have been created (a required migration, easy to lose track of
// among several accumulated over time) — every scan would fail silently at
// the very first step. This banner is what makes that diagnosable instead
// of just "doesn't work."
check('SpendingTab: shows a clear setup warning when the receipts backend is not ready', () => {
  const html = renderToString(React.createElement(SpendingTab, {
    txns: [], bankImports: [],
    allCats, catTargets: {}, suggested: {},
    onAcceptSuggested: noop, onAddCat: noop, onDeleteCat: noop,
    profile, onReviewOther: noop, otherCount: 0, onChangeCategory: noop,
    view: 'combined', setView: noop,
    onDeleteRow: noop, duplicateCount: 0, onReviewDuplicates: noop,
    setQuickAddCat: noop, setTab: noop,
    setEditingCatTarget: noop, showToast: noop,
    onScanReceipt: noop, onConfirmReceipt: noop, onEditTxnSave: noop,
    receiptsSetup: { bucketOk: false, tableOk: false, ready: false }
  }));
  if (!html.includes("isn&#x27;t set up yet")) throw new Error('expected a clear setup warning when the receipts backend is not ready');
  if (!html.includes('RECEIPT_SCANNING_MIGRATION.sql')) throw new Error('expected the warning to name the exact migration file to run');
});

check('SpendingTab: does NOT show the setup warning once the receipts backend is ready', () => {
  const html = renderToString(React.createElement(SpendingTab, {
    txns: [], bankImports: [],
    allCats, catTargets: {}, suggested: {},
    onAcceptSuggested: noop, onAddCat: noop, onDeleteCat: noop,
    profile, onReviewOther: noop, otherCount: 0, onChangeCategory: noop,
    view: 'combined', setView: noop,
    onDeleteRow: noop, duplicateCount: 0, onReviewDuplicates: noop,
    setQuickAddCat: noop, setTab: noop,
    setEditingCatTarget: noop, showToast: noop,
    onScanReceipt: noop, onConfirmReceipt: noop, onEditTxnSave: noop,
    receiptsSetup: { bucketOk: true, tableOk: true, ready: true }
  }));
  if (html.includes("isn't set up yet")) throw new Error('should not show the setup warning once the backend is confirmed ready');
});

const billProps = { billRules: [], onSaveRule: noop, onDeleteRule: noop,
  showToast: noop, billsLocal: false, setTab: noop,
  billPayments: [], allBillPayments: [], onTogglePaid: noop, profile: { name:'Jordan' }, partnerName: 'Mariel',
  billActiveKeys: new Map(), billConfiguredMonths: new Set(),
  onDeleteBillForMonth: noop, onConfigureMonth: noop };

check('render BillsTab', () => renderToString(React.createElement(BillsTab, {
  history, txns, bankImports: imports, allCats, year: 2026, month: 6, ...billProps })));

check('render BillsTab (bills ticked off)', () => renderToString(React.createElement(BillsTab, {
  history, txns, bankImports: imports, allCats, year: 2026, month: 6,
  ...billProps, billPayments: [
    { key:'stela rent', year:2026, month:6, label:'Rent', paid_by:'ness',
      paid_at:'2026-07-27T12:00:00Z' },
  ] })));

check('render BillsTab (local-only mode)', () => renderToString(React.createElement(BillsTab, {
  history, txns, bankImports: imports, allCats, year: 2026, month: 6,
  ...billProps, billsLocal: true })));

check('render BillsTab (with user rules)', () => renderToString(React.createElement(BillsTab, {
  history, txns, bankImports: imports, allCats, year: 2026, month: 6,
  ...billProps, billRules: [
    { key:'stela rent', label:'Rent', amount:1900, day:30, status:'confirmed', category:'other' },
    { key:'netflix',    label:'Netflix', status:'hidden' },
    { key:'manual:gym', label:'Gym', amount:59.99, day:5, status:'manual', category:'other' },
  ] })));

// "Who paid this?" — either partner should be able to mark a bill paid on
// the other's behalf, not have it silently attributed to whoever's logged
// in. The picker itself opens via local component state on a checkbox
// click, which this SSR-only test harness can't simulate (no DOM
// interaction) — this confirms the component renders safely with the new
// partnerName prop and an unpaid bill present; the actual attribution
// logic (resolveWho) is already covered by its own dedicated tests above.
// Every part of the app should distinguish combined from personal. Bills
// already record WHO paid (v74), but the tab ignored the view entirely and
// always showed the household picture. Combined now shows everything;
// each personal view shows only the bills that person was recorded paying.
// Fixtures here are deliberately self-contained (empty history/txns) so the
// only bills in play are the two below — otherwise the shared fixtures'
// own detected bills muddy the amounts being asserted.
check('BillsTab: personal views show only the bills that person paid', () => {
  const cats = [{ id:'other', label:'Other', icon:'Package', color:'#888', target:0 }];
  const rules = [
    { key:'manual:rent', label:'Rent', amount:1900, day:1, status:'manual', category:'other' },
    { key:'manual:gym',  label:'Gym',  amount:60,   day:5, status:'manual', category:'other' },
  ];
  const payments = [
    { key:'manual:rent', year:2026, month:6, label:'Rent', paid_by:'Jordan Yerbury', paid_at:'2026-07-01T00:00:00.000Z' },
    { key:'manual:gym',  year:2026, month:6, label:'Gym',  paid_by:'Mariel Smith',   paid_at:'2026-07-05T00:00:00.000Z' },
  ];
  const render = (view) => renderToString(React.createElement(BillsTab, {
    history: [], txns: [], bankImports: [], allCats: cats, year: 2026, month: 6,
    billRules: rules, onSaveRule: noop, onDeleteRule: noop, showToast: noop, billsLocal: false,
    billPayments: payments, allBillPayments: payments, onTogglePaid: noop,
    profile: { name:'Jordan Yerbury' }, partnerName: 'Mariel Smith', setTab: noop,
    billActiveKeys: new Map(), billConfiguredMonths: new Set(),
    onDeleteBillForMonth: noop, onConfigureMonth: noop,
    view, setView: noop,
  }));

  const combined = render('combined');
  const mine = render('mine');
  const partner = render('partner');

  // Combined shows both partners' paid bills
  if (!combined.includes('$1,900.00') || !combined.includes('$60.00')) {
    throw new Error("Combined should list both partners' paid bills");
  }

  // The real signal: each personal view shows that person's bill and NOT
  // the other person's. (The household total $1,960 legitimately appears in
  // both, as the "paid by both" context line — so it can't be the test.)
  if (!mine.includes('$1,900.00')) throw new Error("Jordan's view should show the $1,900 rent he paid");
  if (mine.includes('$60.00')) throw new Error("Jordan's view is showing the $60 gym Ness paid — Bills is ignoring the view");
  if (!partner.includes('$60.00')) throw new Error("Ness's view should show the $60 gym she paid");
  if (partner.includes('$1,900.00')) throw new Error("Ness's view is showing the $1,900 rent Jordan paid — Bills is ignoring the view");
});

check('render BillsTab (unpaid bill, partnerName present for the "who paid" picker)', () => {
  const html = renderToString(React.createElement(BillsTab, {
    history, txns, bankImports: imports, allCats, year: 2026, month: 6,
    ...billProps, partnerName: 'Mariel Smith', billRules: [
      { key:'stela rent', label:'Rent', amount:1900, day:30, status:'confirmed', category:'other' },
    ]
  }));
  if (!html.includes('Rent')) throw new Error('expected the unpaid Rent bill to render');
});

check('BillsTab: no "hidden bills" restore section exists — deleting is final', () => {
  const html = renderToString(React.createElement(BillsTab, {
    history, txns, bankImports: imports, allCats, year: 2026, month: 6,
    ...billProps, billRules: [
      { key:'netflix', label:'Netflix', status:'hidden' },
    ]
  }));
  if (html.includes('Hidden bills')) throw new Error('expected no "Hidden bills" section — this was removed for simplicity');
  if (html.includes('Restore')) throw new Error('expected no "Restore" affordance anywhere');
});

// This is the actual bug report: deleting a bill removed it from every
// month, past and future, because there was no concept of "this month" at
// all — a single global status flag was the only mechanism. These test
// applyBillRules() directly, since that's where the fix genuinely lives.
check('applyBillRules: deleting a bill for one month leaves other months untouched', () => {
  const detected = [{ key:'netflix', label:'Netflix', amount:9.03, day:2, monthsSeen:3, confidence:'high', varies:false }];
  const rules = [{ key:'netflix', status:'confirmed', label:'Netflix' }];

  // August (month 7) is configured with Netflix explicitly removed
  const activeKeys = new Map(); // Netflix NOT included for August — it was deleted
  const configuredMonths = new Set(['2026|7']);

  const august = applyBillRules(detected, rules, activeKeys, configuredMonths, 2026, 7);
  if (august.some(b => b.key === 'netflix')) {
    throw new Error('expected Netflix to be gone from August after being deleted there');
  }

  // July (month 6) was never touched — must still show Netflix via the
  // legacy fallback, completely unaffected by August's deletion
  const july = applyBillRules(detected, rules, activeKeys, configuredMonths, 2026, 6);
  if (!july.some(b => b.key === 'netflix')) {
    throw new Error('deleting Netflix from August also removed it from July — deletion is not month-scoped');
  }

  // September (month 8), also never touched, must likewise be unaffected
  const september = applyBillRules(detected, rules, activeKeys, configuredMonths, 2026, 8);
  if (!september.some(b => b.key === 'netflix')) {
    throw new Error('deleting Netflix from August also removed it from September — deletion is not month-scoped');
  }
});

check('applyBillRules: an unconfigured month falls back to showing everything (no silent data loss)', () => {
  const detected = [{ key:'netflix', label:'Netflix', amount:9.03, day:2, monthsSeen:3, confidence:'high', varies:false }];
  const rules = [{ key:'netflix', status:'confirmed', label:'Netflix' }];
  // No active keys and no configured months at all — this month has simply
  // never been touched by the new system
  const result = applyBillRules(detected, rules, new Map(), new Set(), 2026, 6);
  if (!result.some(b => b.key === 'netflix')) {
    throw new Error('an untouched month should still show existing confirmed bills via the legacy fallback');
  }
});

check('applyBillRules: status "hidden" still means gone from every month (the rare permanent case)', () => {
  const detected = [{ key:'netflix', label:'Netflix', amount:9.03, day:2, monthsSeen:3, confidence:'high', varies:false }];
  const rules = [{ key:'netflix', status:'hidden', label:'Netflix' }];
  const july = applyBillRules(detected, rules, new Map(), new Set(['2026|6']), 2026, 6);
  const august = applyBillRules(detected, rules, new Map(), new Set(['2026|7']), 2026, 7);
  if (july.some(b => b.key === 'netflix') || august.some(b => b.key === 'netflix')) {
    throw new Error('a globally-hidden bill should not appear in any month');
  }
});

// This is the second half of the bug report: even after bills became
// month-scoped for existence (v62), amount/label/day/category were still
// stored on a single shared bill_rules row — editing a bill's amount in ANY
// month rewrote it in EVERY month, because there was no per-month value at
// all, only a per-month on/off switch. Bill amounts genuinely change month
// to month (utilities, variable subscriptions); an edit must only affect
// the month it was made in.
check('applyBillRules: editing a bill\'s amount for one month leaves other months\' amounts untouched', () => {
  const detected = [{ key:'hydro', label:'Toronto Hydro', amount:120, day:15, monthsSeen:4, confidence:'high', varies:true }];
  const rules = [{ key:'hydro', status:'confirmed', label:'Toronto Hydro' }]; // no amount on the shared rule
  const configuredMonths = new Set(['2026|7']); // only August has been touched

  // August's hydro bill was corrected to $180 for this month specifically
  const activeOverrides = new Map([
    ['hydro|2026|7', { amount: 180, label: 'Toronto Hydro', day: 15, category: 'rent' }],
  ]);

  const august = applyBillRules(detected, rules, activeOverrides, configuredMonths, 2026, 7);
  const augustBill = august.find(b => b.key === 'hydro');
  if (!augustBill || augustBill.amount !== 180) {
    throw new Error(`expected August's hydro bill to be $180, got ${augustBill?.amount}`);
  }

  // July was never touched — must still show the original detected amount
  // ($120), completely unaffected by August's correction
  const july = applyBillRules(detected, rules, activeOverrides, configuredMonths, 2026, 6);
  const julyBill = july.find(b => b.key === 'hydro');
  if (!julyBill || julyBill.amount !== 120) {
    throw new Error(`editing August's hydro amount also changed July's — expected $120 (the original), got ${julyBill?.amount}`);
  }

  // September, also never touched, must likewise show the original amount
  const september = applyBillRules(detected, rules, activeOverrides, configuredMonths, 2026, 8);
  const septBill = september.find(b => b.key === 'hydro');
  if (!septBill || septBill.amount !== 120) {
    throw new Error(`editing August's hydro amount also changed September's — expected $120 (the original), got ${septBill?.amount}`);
  }
});

// The "Just me / Partner / Combined" toggle. The bug report was that it did
// "nothing at all" — traced to a permissive fallback that let unattributed
// transactions silently count as "mine" too, which made Just me and
// Combined look nearly identical whenever attribution was missing.
check('filterByView: "mine" only includes strictly-matching transactions, no fallback', () => {
  const rows = [
    { id:'1', who:'Jordan Yerbury', amount:50 },
    { id:'2', who:'Mariel Smith', amount:80 },
    { id:'3', who:'', amount:20 },       // unattributed
    { id:'4', amount:15 },               // who missing entirely
  ];
  const mine = filterByView(rows, 'mine', 'jordan', 'mariel');
  if (mine.length !== 1 || mine[0].id !== '1') {
    throw new Error(`expected only Jordan's own transaction in "mine", got ${JSON.stringify(mine.map(r=>r.id))}`);
  }
});

check('filterByView: "partner" only includes the partner\'s transactions', () => {
  const rows = [
    { id:'1', who:'Jordan Yerbury', amount:50 },
    { id:'2', who:'Mariel Smith', amount:80 },
    { id:'3', who:'', amount:20 },
  ];
  const partner = filterByView(rows, 'partner', 'jordan', 'mariel');
  if (partner.length !== 1 || partner[0].id !== '2') {
    throw new Error(`expected only Mariel's transaction in "partner", got ${JSON.stringify(partner.map(r=>r.id))}`);
  }
});

check('filterByView: "combined" includes everyone, attributed or not', () => {
  const rows = [
    { id:'1', who:'Jordan Yerbury', amount:50 },
    { id:'2', who:'Mariel Smith', amount:80 },
    { id:'3', who:'', amount:20 },
  ];
  const combined = filterByView(rows, 'combined', 'jordan', 'mariel');
  if (combined.length !== 3) {
    throw new Error(`expected all 3 transactions in "combined", got ${combined.length}`);
  }
});

// Recording on your partner's behalf. The bug report: AddTab's "Who spent
// this?" picker looked functional but was completely ignored — every entry
// was silently attributed to whoever was logged in, regardless of which
// button was tapped. resolveWho() is the fix, extracted so it can't drift
// out of sync across the three places that now use it (AddTab, receipt
// scanning, manual income).
check('resolveWho: selecting yourself resolves to your own full name', () => {
  const who = resolveWho('jordan', 'Jordan Yerbury', 'Mariel Smith', 'jordan');
  if (who !== 'Jordan Yerbury') throw new Error(`expected "Jordan Yerbury", got "${who}"`);
});

check('resolveWho: selecting your partner resolves to THEIR full name, not yours', () => {
  const who = resolveWho('mariel', 'Jordan Yerbury', 'Mariel Smith', 'jordan');
  if (who !== 'Mariel Smith') throw new Error(`expected "Mariel Smith" (the partner), got "${who}" — recording on a partner's behalf is broken`);
});

check('resolveWho: works with the "mine"/"partner" selection style too (manual income picker)', () => {
  const mine = resolveWho('mine', 'Jordan Yerbury', 'Mariel Smith', 'mine');
  const partner = resolveWho('partner', 'Jordan Yerbury', 'Mariel Smith', 'mine');
  if (mine !== 'Jordan Yerbury') throw new Error(`expected "Jordan Yerbury" for "mine", got "${mine}"`);
  if (partner !== 'Mariel Smith') throw new Error(`expected "Mariel Smith" for "partner", got "${partner}"`);
});

check('resolveWho: falls back sensibly if the partner has no name on file yet', () => {
  const who = resolveWho('partner', 'Jordan Yerbury', '', 'mine');
  if (who === 'unknown' || !who) throw new Error('expected a usable fallback name, not empty/unknown, when partnerFullName is blank');
});

// Bug report: bill payments were always silently attributed to whoever's
// logged in, with no way to mark a bill paid on the other partner's
// behalf. resolveWho() (already tested above) is the actual attribution
// fix, reused directly by the new "Who paid this?" picker. This covers
// the toast-wording half specifically: it should stay personal for your
// own bills and name the person only when it's genuinely on their behalf.
check('describeBillPaidBy: stays personal ("You") when marking your own bill', () => {
  const result = describeBillPaidBy('Jordan Yerbury', 'Jordan Yerbury');
  if (result !== 'You') throw new Error(`expected "You" for a self-attributed payment, got "${result}"`);
});

check('describeBillPaidBy: names the partner when a bill is logged on their behalf', () => {
  const result = describeBillPaidBy('Mariel Smith', 'Jordan Yerbury');
  if (result !== 'Mariel') throw new Error(`expected "Mariel" when Jordan logs a bill on Mariel's behalf, got "${result}"`);
});

// The bug report: "Suggested updates available" kept reappearing on every
// single load, and kept second-guessing budget targets someone had already
// set manually. shouldShowBudgetSuggestions() is the actual gate — one
// showing per real calendar month, only near the start of it, never again
// once shown (applied, dismissed, or just ignored).
check('shouldShowBudgetSuggestions: shows near the start of a new, never-seen month', () => {
  const now = new Date(2026, 7, 3); // August 3rd — within the "start of month" window
  if (!shouldShowBudgetSuggestions(25, now, null)) {
    throw new Error('expected suggestions to show: enough imports, early in the month, never shown before');
  }
});

check('shouldShowBudgetSuggestions: does NOT show again once already shown this month', () => {
  const now = new Date(2026, 7, 3);
  const alreadyShown = '2026-7'; // same year/month as `now`
  if (shouldShowBudgetSuggestions(25, now, alreadyShown)) {
    throw new Error('suggestions reappeared even though this exact month was already shown — this is the reported bug');
  }
});

check('shouldShowBudgetSuggestions: does NOT show mid-month, even if never shown before', () => {
  const now = new Date(2026, 7, 20); // August 20th — well past the start-of-month window
  if (shouldShowBudgetSuggestions(25, now, null)) {
    throw new Error('expected no suggestion mid-month — only near the start of the month');
  }
});

check('shouldShowBudgetSuggestions: shows again once a genuinely new month begins', () => {
  const now = new Date(2026, 8, 2); // September 2nd
  const lastShown = '2026-7'; // last shown in August
  if (!shouldShowBudgetSuggestions(25, now, lastShown)) {
    throw new Error('expected suggestions to show again in a brand new month, even though a previous month was shown');
  }
});

check('shouldShowBudgetSuggestions: requires enough transaction history regardless of timing', () => {
  const now = new Date(2026, 7, 2);
  if (shouldShowBudgetSuggestions(5, now, null)) {
    throw new Error('expected no suggestion with too little transaction history, even at the ideal time');
  }
});

check('HomeTab: Just me / Partner / Combined actually produce different numbers', () => {
  const myTxn = mk({ description:'LOBLAWS 1032', amount:50, category:'groceries', who:'Jordan Yerbury' });
  const partnerTxn = mk({ description:'WALMART', amount:80, category:'groceries', who:'Mariel Smith' });

  const render = (view) => renderToString(React.createElement(HomeTab, {
    txns: [], bankImports: [myTxn, partnerTxn], ccTarget: 0,
    allCats, catTargets: {}, year: 2026, month: 6,
    profile, partnerName: 'Mariel Smith', view, setView: noop,
    history: [], billRules: [], billPayments: [],
    expectedIncome: [], setExpectedIncome: noop, onAddTxn: noop,
    showToast: noop, goals: [], onSaveGoals: noop,
    depositingGoalId: null, setDepositingGoalId: noop,
    setTab: noop, onEditTxnSave: noop, onDeleteTxn: noop
  }));

  const mine = render('mine');
  const partnerView = render('partner');
  const combined = render('combined');

  if (!mine.includes('50.00') || mine.includes('80.00')) {
    throw new Error('"mine" view should show only the $50 Jordan transaction, not the $80 one');
  }
  if (!partnerView.includes('80.00') || partnerView.includes('50.00')) {
    throw new Error('"partner" view should show only the $80 Mariel transaction, not the $50 one');
  }
  if (!combined.includes('130.00')) {
    throw new Error('"combined" view should show both added together ($130)');
  }
  if (mine === combined) {
    throw new Error('"mine" and "combined" rendered identically — the toggle is not actually filtering anything');
  }
});

check('ViewToggle: three distinct options render, each with its own accent when active', () => {
  const render = (view) => renderToString(React.createElement(HomeTab, {
    txns: [], bankImports: [], ccTarget: 0,
    allCats, catTargets: {}, year: 2026, month: 6,
    profile, partnerName: 'Mariel', view, setView: noop,
    history: [], billRules: [], billPayments: [],
    expectedIncome: [], setExpectedIncome: noop, onAddTxn: noop,
    showToast: noop, goals: [], onSaveGoals: noop,
    depositingGoalId: null, setDepositingGoalId: noop,
    setTab: noop, onEditTxnSave: noop, onDeleteTxn: noop
  }));

  const combinedHtml = render('combined');
  if (!combinedHtml.includes('Jordan')) throw new Error('expected "Jordan" as one of the toggle options');
  if (!combinedHtml.includes('Mariel')) throw new Error('expected "Mariel" as one of the toggle options');
  if (!combinedHtml.includes('Combined')) throw new Error('expected "Combined" as one of the toggle options');

  // Each view's own accent color shows up (as the hero background, and the
  // toggle's active-button background) only once that view is selected —
  // proving the coloring is genuinely tied to which view is active, not
  // just three static buttons that happen to mention names.
  const mineHtml = render('mine');
  if (!mineHtml.includes('#1d4ed8')) throw new Error('expected the "mine" accent color (#1d4ed8) when mine is active');

  const partnerHtml = render('partner');
  if (!partnerHtml.includes('#be185d')) throw new Error('expected the "partner" accent color (#be185d) when partner is active');
});

check('BillsTab: shows the copy-or-start-fresh banner for an unconfigured month with existing bills', () => {
  const html = renderToString(React.createElement(BillsTab, {
    history, txns, bankImports: imports, allCats, year: 2026, month: 6,
    ...billProps, billRules: [
      { key:'stela rent', label:'Rent', amount:1900, day:30, status:'confirmed', category:'other' },
    ],
    billActiveKeys: new Map(), billConfiguredMonths: new Set(), // unconfigured
  }));
  if (!html.includes('keep these') && !html.includes('start fresh')) {
    throw new Error('expected the new-month copy-or-start-fresh banner to render for an unconfigured month with bills');
  }
});

check('BillsTab: does not show the copy-or-start-fresh banner once a month is configured', () => {
  const html = renderToString(React.createElement(BillsTab, {
    history, txns, bankImports: imports, allCats, year: 2026, month: 6,
    ...billProps, billRules: [
      { key:'stela rent', label:'Rent', amount:1900, day:30, status:'confirmed', category:'other' },
    ],
    billActiveKeys: new Map([['stela rent|2026|6', {amount:1900,label:'Rent',day:30,category:'other'}]]), billConfiguredMonths: new Set(['2026|6']),
  }));
  if (html.includes('start fresh') || html.includes('Keep these bills')) {
    throw new Error('the one-time banner should not reappear once a month has been configured');
  }
});

check('render BillEditModal (existing)', () => renderToString(React.createElement(BillEditModal, {
  bill: { key:'x', label:'Rent', amount:1900, day:30, category:'other', detected:true, monthsSeen:4 },
  allCats, onSave: noop, onDelete: noop, onDeleteEverywhere: noop, onClose: noop })));

check('BillEditModal: month-scoped delete is primary, "everywhere" is a clearly separate secondary action', () => {
  const html = renderToString(React.createElement(BillEditModal, {
    bill: { key:'x', label:'Rent', amount:1900, day:30, category:'other', detected:true, monthsSeen:4 },
    allCats, onSave: noop, onDelete: noop, onDeleteEverywhere: noop, onClose: noop
  }));
  if (html.includes('Not a bill')) throw new Error('found the old ambiguous "Not a bill" wording');
  if (!html.includes('Remove from this month')) throw new Error('expected the month-scoped delete to be the primary action');
  if (!html.includes('every month')) throw new Error('expected a clearly-labeled "delete from every month" secondary option');
});

check('render BillEditModal (new)', () => renderToString(React.createElement(BillEditModal, {
  bill: null, allCats, onSave: noop, onDelete: noop, onDeleteEverywhere: noop, onClose: noop })));

check('render BillsTab (no history)', () => renderToString(React.createElement(BillsTab, {
  history: [], txns: [], bankImports: [], allCats, year: 2026, month: 6, ...billProps })));

check('render BillsTab (nothing charged yet)', () => renderToString(React.createElement(BillsTab, {
  history, txns: [], bankImports: [], allCats, year: 2026, month: 6, ...billProps })));

check('render BillsTab (future month)', () => renderToString(React.createElement(BillsTab, {
  history, txns, bankImports: imports, allCats, year: 2027, month: 0, ...billProps })));

// Exercise the carried-over-overdue section and the "needs review" banner
// against real today, since getCarriedOverBills only activates for the
// month you're actually currently in.
{
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const back = (n) => { let mm = m - n, yy = y; while (mm < 0) { mm += 12; yy--; } return { yy, mm }; };
  const m1 = back(1), m2 = back(2), m3 = back(3);
  const dynHistory = [
    mk({ year:m3.yy, month:m3.mm, date:`${m3.yy}-${String(m3.mm+1).padStart(2,'0')}-02`, description:'NETFLIX.COM', amount:9.03 }),
    mk({ year:m2.yy, month:m2.mm, date:`${m2.yy}-${String(m2.mm+1).padStart(2,'0')}-02`, description:'NETFLIX.COM', amount:9.03 }),
    // last month: some other charge exists (so we know the statement was uploaded) but NOT Netflix — unpaid
    mk({ year:m1.yy, month:m1.mm, date:`${m1.yy}-${String(m1.mm+1).padStart(2,'0')}-11`, description:'LOBLAWS 1032', amount:70 }),
    // this month: proof of statement data, but still no Netflix charge — Netflix is 'due' this month
    mk({ year:y, month:m, date:`${y}-${String(m+1).padStart(2,'0')}-11`, description:'LOBLAWS 1032', amount:70 }),
  ];
  // history = everything ever, for detection. bankImports (like the real app)
  // must be scoped to ONLY the month being viewed — buildSchedule assumes that.
  const thisMonthOnly = dynHistory.filter(t => t.year === y && t.month === m);
  check('render BillsTab (carried-over overdue + needs review)', () => {
    const html = renderToString(React.createElement(BillsTab, {
      history: dynHistory, txns: [], bankImports: thisMonthOnly, allCats, year: y, month: m,
      ...billProps
    }));
    if (!html.includes('Overdue from earlier months')) throw new Error('expected the carried-over section to render');
    if (!/needs a check|need a check/.test(html)) throw new Error('expected the needs-review banner to render');
    if (!html.toUpperCase().includes('NETFLIX')) throw new Error('expected NETFLIX to appear');
  });
}

check('render HistoryTab', () => renderToString(React.createElement(HistoryTab, {
  txns, bankImports: imports, allCats, profile, partnerName: 'Mariel',
  onDeleteTxn: noop, onDeleteImport: noop, onSaveNote: noop })));

check('render CalendarTab', () => renderToString(React.createElement(CalendarTab, {
  year: 2026, month: 6, txns, bankImports: imports, billRules: [], billPayments: [],
  expectedIncome: [], setExpectedIncome: noop, goals: [], onSaveGoals: noop, allCats,
  history, showToast: noop, onSaveRule: noop, onDeleteRule: noop })));

// Regression guard for a real overflow bug: grid-template-columns:
// repeat(7, 1fr) lets each column grow to fit its widest child. Day-cell
// badges use white-space:nowrap, so their full (unwrapped) text width
// becomes each column's minimum size — on a narrow phone, seven columns of
// "$1,234.56"-width content blows past the screen and the whole calendar
// scrolls sideways. minmax(0, 1fr) is what actually fixes it: it lets
// columns shrink below their content's natural width, so the 1fr equal
// split — and the badges' own overflow:hidden/ellipsis — can actually take
// effect instead of being overridden by the grid's sizing algorithm.
check('CalendarTab: month grid uses minmax(0,1fr) columns, not bare 1fr, to prevent horizontal overflow', () => {
  const html = renderToString(React.createElement(CalendarTab, {
    year: 2026, month: 6, txns, bankImports: imports, billRules: [], billPayments: [],
    expectedIncome: [], setExpectedIncome: noop, goals: [], onSaveGoals: noop, allCats,
    history, showToast: noop, onSaveRule: noop, onDeleteRule: noop
  }));
  const gridDeclarations = (html.match(/grid-template-columns:repeat\(7,\s*[^)]*\)/g) || []);
  if (gridDeclarations.length === 0) {
    throw new Error('expected to find a 7-column grid declaration in the rendered calendar');
  }
  gridDeclarations.forEach(decl => {
    if (!/minmax\(0,\s*1fr\)/.test(decl)) {
      throw new Error(`found a 7-column grid without minmax(0,1fr) — this will overflow on narrow screens: "${decl}"`);
    }
  });
});

// Calendar and Charts were the last two tabs ignoring the view.
check('CalendarTab: personal views show only that person\'s income', () => {
  const jordanPay = mk({ description:'NORR PAYROLL', amount:5000, category:'income', direction:'credit', date:'2026-07-15', who:'Jordan Yerbury' });
  const nessPay   = mk({ description:'CLINIC PAY',   amount:2200, category:'income', direction:'credit', date:'2026-07-16', who:'Mariel Smith' });

  const render = (view) => renderToString(React.createElement(CalendarTab, {
    year: 2026, month: 6, txns: [], bankImports: [jordanPay, nessPay],
    billRules: [], billPayments: [], expectedIncome: [], setExpectedIncome: noop,
    goals: [], onSaveGoals: noop, allCats, history: [], showToast: noop,
    onSaveRule: noop, onDeleteRule: noop,
    profile: { name:'Jordan Yerbury' }, partnerName: 'Mariel Smith',
    view, setView: noop,
  }));

  const combined = render('combined');
  const mine = render('mine');
  const partner = render('partner');

  // Day badges use the compact $Xk format, so assert on those
  if (!combined.includes('$5.0k') || !combined.includes('$2.2k')) {
    throw new Error("Combined should show both partners' income on the calendar");
  }
  if (!mine.includes('$5.0k')) throw new Error("Jordan's calendar should show his own $5,000 income");
  if (mine.includes('$2.2k')) throw new Error("Jordan's calendar is showing Ness's income — Calendar is ignoring the view");
  if (!partner.includes('$2.2k')) throw new Error("Ness's calendar should show her own $2,200 income");
  if (partner.includes('$5.0k')) throw new Error("Ness's calendar is showing Jordan's income — Calendar is ignoring the view");
});

check('ChartsTab: personal views chart only that person\'s spending', () => {
  const jordanTxn = mk({ description:'BIG BUY', amount:300, category:'groceries', date:'2026-07-10', who:'Jordan Yerbury' });
  const nessTxn   = mk({ description:'SMALL BUY', amount:60, category:'groceries', date:'2026-07-11', who:'Mariel Smith' });

  const render = (personView) => renderToString(React.createElement(ChartsTab, {
    txns: [], bankImports: [jordanTxn, nessTxn], allCats, year: 2026, month: 6,
    personView, profile: { name:'Jordan Yerbury' }, partnerName: 'Mariel Smith',
  }));

  const combined = render('combined');
  const mine = render('mine');
  const partner = render('partner');

  if (!combined.includes('360.00')) throw new Error('Combined charts should total both partners ($360)');
  if (!mine.includes('300.00')) throw new Error("Jordan's charts should total his own $300");
  if (!partner.includes('60.00')) throw new Error("Ness's charts should total her own $60");
  if (partner.includes('360.00')) throw new Error("Ness's charts are showing the household total — Charts is ignoring the view");
});

check('render ChartsTab', () => renderToString(React.createElement(ChartsTab, {
  txns, bankImports: imports, allCats, year: 2026, month: 6,
  personView: 'combined', profile })));

check('render UploadTab', () => renderToString(React.createElement(UploadTab, {
  showToast: noop, onImported: noop, allCats, aiOn: true, aiDiag: null,
  profile, partnerName: 'Mariel' })));

check('render UploadTab (no AI)', () => renderToString(React.createElement(UploadTab, {
  showToast: noop, onImported: noop, allCats, aiOn: false,
  profile, partnerName: 'Mariel',
  aiDiag: { present:true, reason:'rejected', length:20, startsWith:'sk-ant-abc…',
            endsWith:'…1234', looksValid:true } })));

check('render AutomationTab', () => renderToString(React.createElement(AutomationTab, {
  txns, bankImports: imports, allCats, year: 2026, month: 6,
  personView: 'combined', profile, partnerName: 'Mariel', showToast: noop, onImported: noop,
  aiOn: true, aiDiag: null })));

// Screens reached only through interaction — still worth rendering once
check('render AuthScreen', () => renderToString(React.createElement(AuthScreen, { onAuth: noop })));

check('render AddTab', () => renderToString(React.createElement(AddTab, {
  profile, partnerName: 'Mariel', allCats, onAdd: noop })));

// Regression guard: the app must work for ANY couple's names, not just
// Jordan & Mariel — this is the whole point of this feature. Render key
// screens with a totally different pair of names and confirm neither
// "Jordan" nor "Ness" (nor the test's own placeholder names) leak in from
// some forgotten hardcoded string.
check('AddTab: works for any names, no hardcoded Jordan/Ness leak in', () => {
  const altProfile = { name: 'Alex Rivera', goal: 'Save for a house' };
  const html = renderToString(React.createElement(AddTab, {
    profile: altProfile, partnerName: 'Sam Okafor', allCats, onAdd: noop
  }));
  if (/jordan/i.test(html)) throw new Error('found hardcoded "Jordan" in AddTab output');
  if (/\bness\b/i.test(html)) throw new Error('found hardcoded "Ness" in AddTab output');
  if (!html.includes('Alex') || !html.includes('Sam')) {
    throw new Error('expected the real names Alex and Sam to appear');
  }
});

check('HomeTab: goal group labels use real names, not Jordan/Mariel', () => {
  const altProfile = { name: 'Alex Rivera', goal: '' };
  const altGoals = [
    { id:'g1', person:'jordan', label:'Short-term Goal', target:0, monthlyContribution:0, description:'', currentBalance:0, deposits:[] },
    { id:'g2', person:'mariel', label:'Short-term Goal', target:0, monthlyContribution:0, description:'', currentBalance:0, deposits:[] },
    { id:'g3', person:'couple', label:'Short-term Goal', target:0, monthlyContribution:0, description:'', currentBalance:0, deposits:[] },
  ];
  const html = renderToString(React.createElement(HomeTab, {
    txns: [], bankImports: [], ccTarget: 0,
    allCats, catTargets: {}, year: 2026, month: 6,
    profile: altProfile, partnerName: 'Sam Okafor', view: 'combined', setView: noop,
    history: [], billRules: [], billPayments: [],
    expectedIncome: [], setExpectedIncome: noop,
    showToast: noop, goals: altGoals, onSaveGoals: noop,
    depositingGoalId: null, setDepositingGoalId: noop
  }));
  if (/jordan/i.test(html)) throw new Error('found hardcoded "Jordan" in goal group labels');
  if (/mariel/i.test(html)) throw new Error('found hardcoded "Mariel" in goal group labels');
  if (!html.includes("Alex&#x27;s Goals")) throw new Error("expected \"Alex's Goals\" (alphabetically first)");
  if (!html.includes("Sam&#x27;s Goals")) throw new Error("expected \"Sam's Goals\"");
});

check('render AddCatModal', () => renderToString(React.createElement(AddCatModal, {
  onSave: noop, onClose: noop })));

check('render ReceiptScanModal (pick stage)', () => renderToString(React.createElement(ReceiptScanModal, {
  allCats, onScan: noop, onConfirm: noop, onClose: noop })));

check('ReceiptScanModal: shows which category a scan is locked to, when scanned from a category\'s "+"', () => {
  const html = renderToString(React.createElement(ReceiptScanModal, {
    allCats, onScan: noop, onConfirm: noop, onClose: noop, presetCategory: 'groceries'
  }));
  const groceriesLabel = allCats.find(c => c.id === 'groceries')?.label;
  if (!html.includes('Adding to')) throw new Error('expected an indicator showing which category this scan is locked to');
  if (!html.includes(groceriesLabel)) throw new Error(`expected the category's real label ("${groceriesLabel}") to appear`);
});

check('render ReceiptScanModal (no preset category — general scan, no lock-in banner)', () => {
  const html = renderToString(React.createElement(ReceiptScanModal, {
    allCats, onScan: noop, onConfirm: noop, onClose: noop
  }));
  if (html.includes('Adding to')) throw new Error('did not expect a category lock-in banner for a general (non-preset) scan');
});

check('render ReceiptHistoryModal', () => renderToString(React.createElement(ReceiptHistoryModal, { onClose: noop })));

// "Print all bills from this month" — buildBillsPrintHtml is the actual
// content generator, kept as a pure string-in/string-out function
// specifically so it's testable without a real browser print dialog.
check('buildBillsPrintHtml: includes every bill, both carried-over and this month\'s, with real numbers', () => {
  const html = buildBillsPrintHtml({
    monthLabel: 'August 2026',
    carriedOver: [{ label:'Toronto Hydro', amount:142.50, categoryLabel:'Home', dateLabel:'Jul 15', statusLabel:'Overdue' }],
    entries: [
      { label:'Netflix', amount:9.03, categoryLabel:'Subscriptions', dateLabel:'Aug 2', statusLabel:'Paid' },
      { label:'Stela Rent', amount:1900, categoryLabel:'Home', dateLabel:'Aug 30', statusLabel:'Upcoming' },
    ],
    totals: { paid: 9.03, outstanding: 2042.50, whole: 2051.53 },
  });
  if (!html.includes('Toronto Hydro')) throw new Error('expected the carried-over bill (Toronto Hydro) to appear');
  if (!html.includes('overdue from earlier')) throw new Error('expected carried-over bills to be visibly tagged as such');
  if (!html.includes('Netflix') || !html.includes('Stela Rent')) throw new Error('expected this month\'s bills to appear');
  if (!html.includes('$2,042.50')) throw new Error('expected the "still to be paid" total to appear');
  if (!html.includes('$2,051.53')) throw new Error('expected the "whole month" total to appear');
  if (!html.includes('August 2026')) throw new Error('expected the month label in the title');
});

check('buildBillsPrintHtml: escapes HTML in bill labels (never inject raw markup into a printed page)', () => {
  const html = buildBillsPrintHtml({
    monthLabel: 'August 2026',
    carriedOver: [],
    entries: [{ label:'<script>alert(1)</script>', amount:10, categoryLabel:'Other', dateLabel:'Aug 1', statusLabel:'Paid' }],
    totals: { paid: 10, outstanding: 0, whole: 10 },
  });
  if (html.includes('<script>alert')) {
    throw new Error('a bill label was written into the printed page as raw HTML — this must be escaped');
  }
  if (!html.includes('&lt;script&gt;')) {
    throw new Error('expected the label to be HTML-escaped, not silently dropped');
  }
});

check('buildBillsPrintHtml: produces a complete, well-formed HTML document', () => {
  const html = buildBillsPrintHtml({
    monthLabel: 'August 2026', carriedOver: [], entries: [],
    totals: { paid: 0, outstanding: 0, whole: 0 },
  });
  if (!html.includes('<!DOCTYPE html>') || !html.includes('</html>')) {
    throw new Error('expected a complete HTML document, since this gets written directly into a new browser window');
  }
});

// Bug report: scanning a receipt reads and categorizes fine, then fails.
// Root cause: HEIC photos (the default iPhone format) were declared to
// Claude's vision API as "image/jpeg" regardless of their real format —
// genuinely mismatched data that Claude can't reliably read. isHeic() is
// the detector that now catches this BEFORE any upload or API call happens.
// Receipt uploads kept crashing. Cause: a 12MP phone photo turned into a
// ~20MB base64 string, and building that on mobile Safari is a memory
// spike big enough to kill the tab. Downscaling first is the fix — it
// also converts HEIC via canvas, so iPhone photos stop being rejected.
check('scaleFactorFor: shrinks an oversized phone photo to the max edge', () => {
  // A typical 12MP iPhone photo
  const f = scaleFactorFor(4032, 3024);
  if (f >= 1) throw new Error('a 4032px photo must be scaled down');
  if (Math.round(4032 * f) !== MAX_EDGE) {
    throw new Error(`expected the long edge to land on ${MAX_EDGE}, got ${Math.round(4032 * f)}`);
  }
});

check('scaleFactorFor: never upscales a photo that is already small', () => {
  if (scaleFactorFor(800, 600) !== 1) throw new Error('a small photo must be left alone, not enlarged');
  if (scaleFactorFor(MAX_EDGE, 900) !== 1) throw new Error('a photo exactly at the limit must be left alone');
});

check('scaleFactorFor: uses the LONGEST edge, so portrait photos shrink too', () => {
  const portrait = scaleFactorFor(3024, 4032); // taller than wide
  if (Math.round(4032 * portrait) !== MAX_EDGE) {
    throw new Error('a portrait photo must be measured by its height, not its width');
  }
});

check('scaleFactorFor: survives missing dimensions without dividing by zero', () => {
  if (scaleFactorFor(0, 0) !== 1) throw new Error('expected a safe 1 when dimensions are unknown');
});

check('isHeic: detects HEIC/HEIF by MIME type', () => {
  if (!isHeic({ type: 'image/heic', name: 'IMG_1234.heic' })) {
    throw new Error('expected image/heic to be detected as HEIC');
  }
  if (!isHeic({ type: 'image/heif', name: 'IMG_1234.heif' })) {
    throw new Error('expected image/heif to be detected as HEIC');
  }
});

check('isHeic: falls back to filename extension when the browser leaves type blank', () => {
  // Some mobile browsers don't populate file.type for HEIC files at all —
  // this is the actual real-world case the extension fallback exists for.
  if (!isHeic({ type: '', name: 'IMG_5678.HEIC' })) {
    throw new Error('expected a blank-type file with a .HEIC extension to still be caught');
  }
});

check('isHeic: does not flag ordinary JPEG/PNG photos', () => {
  if (isHeic({ type: 'image/jpeg', name: 'receipt.jpg' })) {
    throw new Error('a normal JPEG must not be flagged as HEIC');
  }
  if (isHeic({ type: 'image/png', name: 'receipt.png' })) {
    throw new Error('a normal PNG must not be flagged as HEIC');
  }
});

// Bug report: the weekly summary email "wasn't working at all." Two real
// causes found: (1) when profile.email was missing, the code fabricated a
// fake "name@example.com" address and tried to send to it anyway — that
// domain is reserved and can never receive real mail, so this could never
// have worked, and (2) the actual server error was being discarded and
// replaced with a generic "not configured yet" message regardless of what
// really went wrong, making the real problem impossible to diagnose from
// the UI. resolveTestEmailTarget() is the fix for (1); the response-body
// error-surfacing fix for (2) lives directly in sendTestEmail's fetch
// handling and isn't separately unit-testable without a live network mock.
check('resolveTestEmailTarget: never fabricates a fake @example.com address', () => {
  const noEmailProfile = { name: 'Jordan Yerbury' }; // no .email at all
  const result = resolveTestEmailTarget(noEmailProfile);
  if (result && result.includes('@example.com')) {
    throw new Error('fabricated a fake @example.com address — this domain can never receive real mail, so sending to it can never have worked');
  }
  if (result !== null) {
    throw new Error(`expected null when there's no real email on file, got "${result}"`);
  }
});

check('resolveTestEmailTarget: uses the real account email when present', () => {
  const result = resolveTestEmailTarget({ name: 'Jordan Yerbury', email: 'jordan@realaddress.com' });
  if (result !== 'jordan@realaddress.com') {
    throw new Error(`expected the real email to be used, got "${result}"`);
  }
});

// Bug report: "the info on the bill is read but then I can't upload the
// image or store information." The bucket/table "missing" checks only
// caught one failure mode — if the bucket or table already EXISTS but Row
// Level Security is blocking the actual insert/upload (a completely
// different, common Supabase misconfiguration — e.g. the bucket created via
// the dashboard without the accompanying policies), that error has a
// different shape entirely and was falling through as a raw, unexplained
// error instead of a clear "here's what to fix" message.
check('isRlsDenied: recognizes a Postgres RLS denial by error code', () => {
  if (!isRlsDenied({ code: '42501', message: 'permission denied for table receipts' })) {
    throw new Error('expected Postgres code 42501 to be recognized as an RLS denial');
  }
});

check('isRlsDenied: recognizes Supabase\'s "row-level security" and "new row violates" messages', () => {
  if (!isRlsDenied({ message: 'new row violates row-level security policy for table "objects"' })) {
    throw new Error('expected a Storage RLS-denial message to be recognized');
  }
  if (!isRlsDenied({ message: 'permission denied for relation receipts' })) {
    throw new Error('expected a "permission denied" message to be recognized');
  }
});

check('isRlsDenied: does not misclassify an unrelated error as RLS', () => {
  if (isRlsDenied({ message: 'Network request failed' })) {
    throw new Error('a generic network error must not be misclassified as an RLS denial');
  }
  if (isRlsDenied({ code: '23505', message: 'duplicate key value violates unique constraint' })) {
    throw new Error('a duplicate-key error must not be misclassified as an RLS denial');
  }
});

// The sneaky case checkReceiptsBackendReady() was extended to catch: the
// Storage bucket works fine (photos upload, transactions get added — the
// core feature genuinely works), but the receipts TABLE's own permissions
// are broken, so the retrievable record silently never saves. Nothing
// visibly fails, so without a check that looks at the table specifically,
// there's no way to know why "View past scanned receipts" stays empty no
// matter how many photos get scanned.
check('describeReceiptsBackendIssue: distinguishes bucket-broken from the sneaky table-only-broken case', () => {
  const bucketBroken = { ready: false, bucket: { ready: false, reason: 'bucket-missing' }, table: { ready: true } };
  const tableBroken = { ready: false, bucket: { ready: true }, table: { ready: false, reason: 'table-rls-denied' } };

  const bucketMsg = describeReceiptsBackendIssue(bucketBroken);
  const tableMsg = describeReceiptsBackendIssue(tableBroken);

  if (!bucketMsg.includes('storage bucket')) throw new Error('expected the bucket-broken message to mention the storage bucket');
  if (!tableMsg.includes('upload')) throw new Error('expected the table-broken message to acknowledge uploads still work');
  if (!tableMsg.includes("won't actually save") && !tableMsg.includes('receipt record')) {
    throw new Error('expected the table-broken message to explain the record itself is what fails, not the photo');
  }
  if (bucketMsg === tableMsg) {
    throw new Error('bucket-broken and table-broken are different problems with different fixes — they must not share the same message');
  }
});

check('describeReceiptsBackendIssue: returns null when everything is ready', () => {
  if (describeReceiptsBackendIssue({ ready: true }) !== null) {
    throw new Error('expected no message when the backend is fully ready');
  }
  if (describeReceiptsBackendIssue(null) !== null) {
    throw new Error('expected no message (not a crash) when there is no check result yet');
  }
});

check('render WeeklyEmailPreviewModal', () => renderToString(React.createElement(WeeklyEmailPreviewModal, {
  txns, bankImports: imports, billPayments: [], billRules: [], profile,
  year: 2026, month: 6, onClose: noop, showToast: noop, C, SERIF, SANS })));

check('WeeklyEmailPreviewModal: is honest that nothing sends automatically yet', () => {
  const html = renderToString(React.createElement(WeeklyEmailPreviewModal, {
    txns, bankImports: imports, billPayments: [], billRules: [], profile,
    year: 2026, month: 6, onClose: noop, showToast: noop, C, SERIF, SANS
  }));
  // The old copy said "An email will be sent every Friday" as if automatic
  // delivery were already active, when in fact nothing is scheduled unless
  // someone sets up an external cron job — actively misleading given the
  // bug report was about the feature seeming broken.
  if (!html.includes('Nothing is scheduled automatically')) {
    throw new Error('expected the modal to say plainly that nothing sends automatically without an external scheduler');
  }
});

check('render EditTransactionModal', () => renderToString(React.createElement(EditTransactionModal, {
  tx: { id:'t1', date:'2026-07-12', amount:84.2, category:'groceries', note:'Loblaws' },
  allCats, onSave: noop, onClose: noop })));

check('EditTransactionModal: income is never a selectable category', () => {
  const html = renderToString(React.createElement(EditTransactionModal, {
    tx: { id:'t1', date:'2026-07-12', amount:84.2, category:'groceries', note:'Loblaws' },
    allCats, onSave: noop, onClose: noop
  }));
  if (/<option[^>]*>Income<\/option>/i.test(html)) {
    throw new Error('found a selectable "Income" option — this must never be reachable from the transaction editor');
  }
});

check('render OtherReviewModal', () => renderToString(React.createElement(OtherReviewModal, {
  items: imports, allCats, onSave: noop, onClose: noop })));

check('render ActivityPanel', () => renderToString(React.createElement(ActivityPanel, {
  items: [{ id:'1', who:'ness', text:'Ness added $42.10 to Groceries', at: Date.now() }],
  onClose: noop, onClear: noop })));

check('render ActivityPanel (empty)', () => renderToString(React.createElement(ActivityPanel, {
  items: [], onClose: noop, onClear: noop })));

const dupeRows = [
  { id:'d1', date:'2026-04-25', description:'MARCHE LEOS MARKET', amount:18.44,
    source:'CTFS', category:'groceries', year:2026, month:3 },
  { id:'d2', date:'2026-04-25', description:'MARCHE LEOS MARKET', amount:18.44,
    source:'BMO',  category:'groceries', year:2026, month:3 },
  { id:'d3', date:'2026-04-21', description:'RABBA 117',     amount:4.17,
    source:'BMO',  category:'groceries', year:2026, month:3 },
  { id:'d4', date:'2026-04-21', description:'RABBA 117 Q4R', amount:4.17,
    source:'CTFS', category:'other',     year:2026, month:3 },
];

check('render DuplicateModal (with duplicates)', () => renderToString(React.createElement(DuplicateModal, {
  rows: dupeRows, allCats, onDelete: noop, onClose: noop, showToast: noop })));

check('render DuplicateModal (clean)', () => renderToString(React.createElement(DuplicateModal, {
  rows: [dupeRows[0]], allCats, onDelete: noop, onClose: noop, showToast: noop })));

check('render OtherReviewModal with delete', () => renderToString(React.createElement(OtherReviewModal, {
  items: imports, allCats, onSave: noop, onClose: noop, onDeleteRow: noop })));

check('render ResetModal', () => renderToString(React.createElement(ResetModal, {
  year: 2026, month: 6, onClose: noop, onDone: noop, showToast: noop })));

Promise.all(pending).then(() => {
  results.forEach(([s, n]) => console.log(s + '  ' + n));
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log('\n' + (failed ? failed + ' FAILURE(S)' : 'All smoke tests passed'));
  process.exit(failed ? 1 : 0);
});

// ─── Monthly report ───────────────────────────────────────────────────────────
// The old export was three summary cards plus txns.slice(0,20) — an
// arbitrary handful of rows, with a "Total Spent" that didn't even exclude
// income. These cover the questions the report is actually meant to answer.
import { buildMonthlyReport, renderMonthlyReportHtml, isCashWithdrawal,
         isInterPartnerTransfer, describesPerson } from '../src/report.js';

const rptBase = {
  year: 2026, month: 6, myName: 'Jordan Yerbury', partnerName: 'Mariel Ko',
  allCats: [{id:'groceries',label:'Groceries'},{id:'rent',label:'Home'}],
};

check('report: splits spending by person and excludes income from the spend total', () => {
  const r = buildMonthlyReport({ ...rptBase, bankImports: [
    mk({ description:'LOBLAWS', amount:120, category:'groceries', who:'Jordan Yerbury' }),
    mk({ description:'METRO',   amount:80,  category:'groceries', who:'Mariel Ko' }),
    mk({ description:'NORR PAY',amount:5000,category:'income', direction:'credit', who:'Jordan Yerbury' }),
  ]});
  if (r.perPerson.jordan.total !== 120) throw new Error(`Jordan should have spent $120, got ${r.perPerson.jordan.total}`);
  if (r.perPerson.mariel.total !== 80) throw new Error(`Mariel should have spent $80, got ${r.perPerson.mariel.total}`);
  if (r.totals.spent !== 200) throw new Error(`spend total must exclude income; expected 200, got ${r.totals.spent}`);
  if (r.totals.income !== 5000) throw new Error('income should be reported separately');
});

check('report: records who paid which bills', () => {
  const r = buildMonthlyReport({ ...rptBase, billEntries: [
    { label:'Rent', amount:1900, status:'paid', tickedBy:'Jordan Yerbury' },
    { label:'Gym',  amount:60,   status:'paid', tickedBy:'Mariel Ko' },
    { label:'Hydro',amount:140,  status:'due',  tickedBy:null },
  ]});
  if (r.bills.byPayer.jordan.total !== 1900) throw new Error('Jordan should be credited with the $1,900 rent');
  if (r.bills.byPayer.mariel.total !== 60) throw new Error('Mariel should be credited with the $60 gym');
  if (r.totals.billsPaid !== 1960) throw new Error('bills paid should total $1,960');
  if (r.totals.billsOutstanding !== 140) throw new Error('the unpaid $140 hydro should be outstanding, not paid');
});

check('report: identifies transfers between the two partners, in both directions', () => {
  const r = buildMonthlyReport({ ...rptBase, bankImports: [
    mk({ description:'INTERAC ETRNSFR SENT MARIEL KO', amount:450, category:'transfer' }),
    mk({ description:'INTERAC ETRNSFR AD RECVD NESS MARIEL KO', amount:1000, category:'transfer' }),
    mk({ description:'LOBLAWS', amount:50, category:'groceries', who:'Jordan Yerbury' }),
  ]});
  if (r.transfers.rows.length !== 2) throw new Error(`expected 2 inter-partner transfers, got ${r.transfers.rows.length}`);
  if (r.transfers.out !== 450) throw new Error(`expected $450 sent, got ${r.transfers.out}`);
  if (r.transfers.in !== 1000) throw new Error(`expected $1,000 received, got ${r.transfers.in}`);
  if (r.transfers.net !== 550) throw new Error(`expected net +$550, got ${r.transfers.net}`);
  // Transfers must never be counted as spending — the money stayed in the household
  if (r.totals.spent !== 50) throw new Error(`transfers leaked into the spend total: got ${r.totals.spent}, expected 50`);
});

check('report: flags cash withdrawals nobody is assigned to', () => {
  const r = buildMonthlyReport({ ...rptBase, bankImports: [
    mk({ description:'ATM WITHDRAWAL', amount:200, category:'other', who:'Jordan Yerbury' }),
    // The shared mk() fixture defaults who:'jordan', so this must be
    // cleared explicitly — otherwise the "unattributed" case isn't
    // actually being tested at all.
    mk({ description:'ABM CASH WITHDRAWAL', amount:100, category:'other', who:'' }),
  ]});
  if (r.cash.total !== 300) throw new Error(`expected $300 cash out, got ${r.cash.total}`);
  if (r.cash.unattributed !== 100) throw new Error(`expected $100 unattributed cash, got ${r.cash.unattributed}`);
});

check('report: works out who carried more of the household', () => {
  const r = buildMonthlyReport({ ...rptBase,
    bankImports: [ mk({ description:'LOBLAWS', amount:100, category:'groceries', who:'Jordan Yerbury' }) ],
    billEntries: [ { label:'Rent', amount:1900, status:'paid', tickedBy:'Jordan Yerbury' },
                   { label:'Gym', amount:60, status:'paid', tickedBy:'Mariel Ko' } ],
  });
  if (r.contribution.byPerson.jordan.total !== 2000) throw new Error('Jordan: $100 spending + $1,900 bills = $2,000');
  if (r.contribution.byPerson.mariel.total !== 60) throw new Error('Mariel: $60 bills');
  if (r.contribution.aheadBy !== 'jordan') throw new Error('Jordan put in more, so he should be the one ahead');
  if (r.contribution.difference !== 1940) throw new Error(`expected a $1,940 gap, got ${r.contribution.difference}`);
});

check('report: renders a complete HTML document covering every section', () => {
  const r = buildMonthlyReport({ ...rptBase, bankImports: [
    mk({ description:'LOBLAWS', amount:120, category:'groceries', who:'Jordan Yerbury' }) ]});
  const html = renderMonthlyReportHtml(r);
  if (!html.includes('<!DOCTYPE html>') || !html.includes('</html>')) throw new Error('expected a complete HTML document');
  for (const heading of ['What each of you spent','Who paid which bills','Money moved between you','Cash withdrawn','Where the money went','Who carried more']) {
    if (!html.includes(heading)) throw new Error(`report is missing the "${heading}" section`);
  }
});

check('report: escapes HTML so a merchant name can never inject markup', () => {
  const r = buildMonthlyReport({ ...rptBase, bankImports: [
    mk({ description:'<script>alert(1)</script>', amount:10, category:'other', who:'Jordan Yerbury' }) ],
    billEntries: [{ label:'<img onerror=x>', amount:5, status:'paid', tickedBy:'Jordan Yerbury' }] });
  const html = renderMonthlyReportHtml(r);
  if (html.includes('<script>alert')) throw new Error('a description was written into the report as raw HTML');
  if (html.includes('<img onerror=')) throw new Error('a bill label was written into the report as raw HTML');
});

check('isCashWithdrawal / isInterPartnerTransfer / describesPerson behave sensibly', () => {
  if (!isCashWithdrawal({ description:'ATM WITHDRAWAL' })) throw new Error('ATM withdrawal not detected');
  if (isCashWithdrawal({ description:'LOBLAWS GROCERIES' })) throw new Error('a grocery run must not count as cash out');
  if (!isInterPartnerTransfer({ description:'INTERAC ETRNSFR SENT MARIEL KO' }, 'Jordan Yerbury', 'Mariel Ko')) {
    throw new Error('a transfer naming the partner should be detected');
  }
  if (isInterPartnerTransfer({ description:'INTERAC ETRNSFR SENT STELA' }, 'Jordan Yerbury', 'Mariel Ko')) {
    throw new Error('a transfer to a third party must not count as an inter-partner transfer');
  }
  if (describesPerson('SENT JAZMINE YERBURY', 'Mariel Ko')) throw new Error('a different person must not match');
});
