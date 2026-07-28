/**
 * Regression tests for real bank layouts.
 *
 * Every case here comes from an actual export that the parser once got wrong:
 * BMO's separator-less dates, Canadian Tire's inverted signs, Wealthsimple's
 * missing description column, and bank names appearing inside transaction text.
 */
import fs from 'node:fs';
import path from 'node:path';

const { parseStatementCSV, parseDate } = await import('../src/parse.js');
const { fingerprintBank } = await import('../src/detect.js');

const dir = path.join(import.meta.dirname, 'fixtures');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

let failed = 0;
function assert(name, cond, detail = '') {
  if (cond) { console.log('ok    ' + name); }
  else { console.log('FAIL  ' + name + (detail ? '  →  ' + detail : '')); failed++; }
}

// ── Dates ──
assert('BMO compact date 20260102',
  parseDate('20260102')?.toISOString().slice(0,10) === '2026-01-02',
  String(parseDate('20260102')));
assert('ISO date', parseDate('2026-04-12')?.toISOString().slice(0,10) === '2026-04-12');
assert('US slash date', parseDate('04/30/2026')?.toISOString().slice(0,10) === '2026-04-30');
assert('CIBC month name', parseDate('Jul. 03/2026')?.toISOString().slice(0,10) === '2026-07-03');
assert('garbage date rejected', parseDate('not a date') === null);

// ── Bank detection is structural, not textual ──
const cases = [
  ['bmo_classic.csv',   'BMO'],
  ['bmo_enriched.csv',  'BMO'],
  ['ctfs.csv',          'CTFS'],
  ['pc_mc.csv',         'PC_MC'],
  ['ws_monthly.csv',    'WS_PERS'],
  ['ws_sixmonth.csv',   'WS_PERS'],
];
for (const [file, want] of cases) {
  const got = fingerprintBank(read(file)).id;
  assert(`detect ${file} → ${want}`, got === want, 'got ' + got);
}

// A BMO file mentioning CANADIAN TIRE BANK in a transaction must stay BMO
assert('bank name inside a transaction does not fool detection',
  fingerprintBank(read('bmo_classic.csv')).id === 'BMO');
// A PC file with a "Payment BMO" row must stay PC_MC
assert('"Payment BMO" row does not make it a BMO file',
  fingerprintBank(read('pc_mc.csv')).id === 'PC_MC');

// ── Every fixture yields rows ──
for (const [file] of cases) {
  const r = parseStatementCSV(read(file), fingerprintBank(read(file)).id);
  assert(`parse ${file}`, !r.error && r.rows.length > 0,
    r.error ? r.error.split('\n')[0] : 'zero rows');
}

// ── Direction, the part that silently corrupts totals ──
const bmo = parseStatementCSV(read('bmo_classic.csv'), 'BMO').rows;
assert('BMO purchase is a debit',
  bmo.find(r => r.description.includes('CORNER GROCER'))?._type === 'debit');
assert('BMO e-transfer received is a credit',
  bmo.find(r => r.description.includes('RECVD'))?._type === 'credit');

const ctfs = parseStatementCSV(read('ctfs.csv'), 'CTFS').rows;
assert('CTFS purchase (positive amount) is a debit',
  ctfs.find(r => r.description.includes('CLINIC'))?._type === 'debit',
  'sign convention is inverted on this card');
assert('CTFS payment (negative amount) is a credit',
  ctfs.find(r => r.description.includes('PAYMENTS'))?._type === 'credit');
assert('CTFS payment lands in cc_payment, not spending',
  ctfs.find(r => r.description.includes('PAYMENTS'))?.category === 'cc_payment');

const pc = parseStatementCSV(read('pc_mc.csv'), 'PC_MC').rows;
assert('PC purchase (negative amount) is a debit',
  pc.find(r => r.description.includes('RESTOBAR'))?._type === 'debit');
assert('PC payment (positive amount) is a credit',
  pc.find(r => r.description.includes('Payment'))?._type === 'credit');
assert('PC refund is a credit',
  pc.find(r => r.description.includes('POINTS'))?._type === 'credit');

// ── Wealthsimple quirks ──
const wsm = parseStatementCSV(read('ws_monthly.csv'), 'WS_JOINT').rows;
assert('WS monthly export parses without a description column', wsm.length === 4, String(wsm.length));
assert('WS falls back to activity sub-type for the description',
  wsm.some(r => r.description === 'SPEND'));
assert('WS joint account id maps to WS_JOINT',
  wsm.find(r => r.amount === 22.81)?.source === 'WS_JOINT');
assert('WS personal account id maps to WS_PERS',
  wsm.find(r => r.amount === 61.78)?.source === 'WS_PERS');

const wss = parseStatementCSV(read('ws_sixmonth.csv'), 'WS_JOINT').rows;
assert('WS six-month export prefers the real description',
  wss.some(r => r.description.includes('Interest received')));
assert('WS splits two accounts in one file',
  new Set(wss.map(r => r.source)).size === 2);

// ── Amounts are always positive, direction carries the meaning ──
const all = [...bmo, ...ctfs, ...pc, ...wsm, ...wss];
assert('no negative amounts survive parsing', all.every(r => r.amount > 0));
assert('every row has a direction', all.every(r => r._type === 'debit' || r._type === 'credit'));
assert('every row has a valid date', all.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date)));

console.log('\n' + (failed ? failed + ' FAILURE(S)' : 'All parser tests passed'));
process.exit(failed ? 1 : 0);
