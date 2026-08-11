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
  AutomationTab, AuthScreen, AddTab, AddCatModal, ReceiptScanModal, EditTransactionModal, OtherReviewModal, ActivityPanel,
  ResetModal, BillEditModal, DuplicateModal, filterByView } from '../src/App.jsx';

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
  if (!html.includes('Bills Paid This Month')) throw new Error('expected a "Bills Paid This Month" stat');
  if (!html.includes('1,900.00')) throw new Error('expected the $1,900 rent to appear as bills paid');
  if (!html.includes('120.00')) throw new Error('expected the $120 groceries to appear as spent this month');
  // Available = 5000 - 120 - 1900 = 2980.00 — must appear once, not some
  // double-subtracted lower figure like 980.00 (5000-120-1900-1900)
  if (!html.includes('2,980.00')) throw new Error('Available Money is wrong — looks like bills were subtracted twice');
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
    if (html.includes('5,984.44')) {
      throw new Error('predicted and actual income were added together into one figure — they must stay separate');
    }
    if (!html.includes('2,000')) throw new Error('expected the $2,000 predicted income to appear on its own');
    if (!html.includes('3,984.44')) throw new Error('expected the $3,984.44 actual income to appear on its own');
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

const billProps = { billRules: [], onSaveRule: noop, onDeleteRule: noop,
  showToast: noop, billsLocal: false, setTab: noop,
  billPayments: [], allBillPayments: [], onTogglePaid: noop, profile: { name:'Jordan' },
  billActiveKeys: new Set(), billConfiguredMonths: new Set(),
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
  const activeKeys = new Set(); // Netflix NOT included for August — it was deleted
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
  const result = applyBillRules(detected, rules, new Set(), new Set(), 2026, 6);
  if (!result.some(b => b.key === 'netflix')) {
    throw new Error('an untouched month should still show existing confirmed bills via the legacy fallback');
  }
});

check('applyBillRules: status "hidden" still means gone from every month (the rare permanent case)', () => {
  const detected = [{ key:'netflix', label:'Netflix', amount:9.03, day:2, monthsSeen:3, confidence:'high', varies:false }];
  const rules = [{ key:'netflix', status:'hidden', label:'Netflix' }];
  const july = applyBillRules(detected, rules, new Set(), new Set(['2026|6']), 2026, 6);
  const august = applyBillRules(detected, rules, new Set(), new Set(['2026|7']), 2026, 7);
  if (july.some(b => b.key === 'netflix') || august.some(b => b.key === 'netflix')) {
    throw new Error('a globally-hidden bill should not appear in any month');
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
    billActiveKeys: new Set(), billConfiguredMonths: new Set(), // unconfigured
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
    billActiveKeys: new Set(['stela rent|2026|6']), billConfiguredMonths: new Set(['2026|6']),
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
