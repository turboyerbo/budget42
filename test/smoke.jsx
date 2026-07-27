/**
 * Renders the real components with mock data.
 *
 * A build only proves the code parses. These three bugs all parsed fine and
 * then threw on first render: a missing constant, a stale variable reference,
 * and a temporal dead zone. Rendering catches that class.
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { detectRecurring, splitRecurring } from '../src/recurring.js';
import { findSharedMoments, summariseTogether } from '../src/together.js';
import { buildValidationReport } from '../src/validate.js';
import { detectPartnerTransfers } from '../src/together.js';
import App, { HomeTab, BillsTab, HistoryTab, ChartsTab, UploadTab,
  AuthScreen, AddTab, AddCatModal, OtherReviewModal, ActivityPanel } from '../src/App.jsx';

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
function check(name, fn) {
  try { fn(); results.push(['ok  ', name]); }
  catch (e) { results.push(['FAIL', name + '  →  ' + e.message]); }
}

check('detectRecurring',   () => detectRecurring(history));
check('splitRecurring',    () => splitRecurring(detectRecurring(history), imports));
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

['mine','combined'].forEach(v => {
  check('render HomeTab (' + v + ')', () => renderToString(React.createElement(HomeTab, {
    txns, bankImports: imports, ccTarget: 500, setCcTarget: noop,
    allCats, onSaveSettings: noop, catTargets: {}, suggested: {},
    onAcceptSuggested: noop, onAddCat: noop, onDeleteCat: noop,
    profile, onReviewOther: noop, otherCount: 0, onChangeCategory: noop,
    view: v, setView: noop, history,
  })));
});

check('render HomeTab (no history)', () => renderToString(React.createElement(HomeTab, {
  txns: [], bankImports: [], ccTarget: 0, setCcTarget: noop,
  allCats, onSaveSettings: noop, catTargets: {}, suggested: {},
  onAcceptSuggested: noop, onAddCat: noop, onDeleteCat: noop,
  profile, onReviewOther: noop, otherCount: 0, onChangeCategory: noop,
  view: 'combined', setView: noop, history: [],
})));

check('render BillsTab', () => renderToString(React.createElement(BillsTab, {
  history, txns, bankImports: imports, allCats })));

check('render BillsTab (no history)', () => renderToString(React.createElement(BillsTab, {
  history: [], txns: [], bankImports: [], allCats })));

check('render HistoryTab', () => renderToString(React.createElement(HistoryTab, {
  txns, bankImports: imports, allCats,
  onDeleteTxn: noop, onDeleteImport: noop, onSaveNote: noop })));

check('render ChartsTab', () => renderToString(React.createElement(ChartsTab, {
  txns, bankImports: imports, allCats, year: 2026, month: 6,
  personView: 'combined', profile })));

check('render UploadTab', () => renderToString(React.createElement(UploadTab, {
  showToast: noop, onImported: noop, allCats, aiOn: true, aiDiag: null })));

check('render UploadTab (no AI)', () => renderToString(React.createElement(UploadTab, {
  showToast: noop, onImported: noop, allCats, aiOn: false,
  aiDiag: { present:true, reason:'rejected', length:20, startsWith:'sk-ant-abc…',
            endsWith:'…1234', looksValid:true } })));

// Screens reached only through interaction — still worth rendering once
check('render AuthScreen', () => renderToString(React.createElement(AuthScreen, { onAuth: noop })));

check('render AddTab', () => renderToString(React.createElement(AddTab, {
  profile, allCats, onAdd: noop })));

check('render AddCatModal', () => renderToString(React.createElement(AddCatModal, {
  onSave: noop, onClose: noop })));

check('render OtherReviewModal', () => renderToString(React.createElement(OtherReviewModal, {
  items: imports, allCats, onSave: noop, onClose: noop })));

check('render ActivityPanel', () => renderToString(React.createElement(ActivityPanel, {
  items: [{ id:'1', who:'ness', text:'Ness added $42.10 to Groceries', at: Date.now() }],
  onClose: noop, onClear: noop })));

check('render ActivityPanel (empty)', () => renderToString(React.createElement(ActivityPanel, {
  items: [], onClose: noop, onClear: noop })));

results.forEach(([s, n]) => console.log(s + '  ' + n));
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log('\n' + (failed ? failed + ' FAILURE(S)' : 'All smoke tests passed'));
process.exit(failed ? 1 : 0);
