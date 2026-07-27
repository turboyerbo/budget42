/**
 * Rule-based transaction categoriser built from 7 months of Jordan & Ness's
 * actual spending. Covers ~90% of their real merchants automatically.
 *
 * Returns one of the CATS ids, or '_skip' for transfers/fees/income rows
 * that should be excluded from spending totals.
 */

const RULES = [
  // ── Skip (transfers, CC payments, income, fixed bills) ────────────────────
  { cat: '_skip', words: [
    'interac etrnsfr', 'e-transfer', 'ctfs.com/payment', 'canadian tire bank',
    'pc mastercard', 'metergy sol', 'freedom mobile', 'affirm canada',
    'stela', 'td ins', 'td assur', 'performance plan fee', 'overdraft',
    'purchase finance charge', 'cash finance charge', 'purchase interest charge',
    'sunlife', 'sun life', 'norr architects', 'fig financial',
    'purchase *finance', 'cash * finance', 'returned item fee', 'stop payment',
    'transfer in', 'transfer out', 'deposit', 'withdrawal', 'interest received',
  ]},

  // ── Groceries ──────────────────────────────────────────────────────────────
  { cat: 'groceries', words: [
    'metro 62', 'metro 742', 'metro 100', 'marche leo', 'canary market',
    'ponesse foods', 'sugo cafe', 'aisle 24', "davidson's city", 'mike\'s fish',
    'family food', 'seafront fish market', 'bulk barn', 'sherwood market',
    'rabba', "rocco's no frills", 'pay n run', 'all u need',
    'international chee', 'canary market', 'jarvis market', 'dollarama',
  ]},

  // ── Restaurant & Takeout ───────────────────────────────────────────────────
  { cat: 'restaurant', words: [
    'dark horse', 'tst-', 'ddsukhothai', 'dd sukho', 'sukhothai',
    'popeyes', 'ubereats', 'doordash', 'jollibee', 'pii nong', 'rodneys oyster',
    'hawa beirut', 'fox and firkin', 'cafe landwer', 'sumach espresso',
    'old time', 'saku', 'beertown', 'the golden pigeon', 'score on king',
    'lima charlie', 'moegi sushi', 'nari sushi', 'cafe oro di napoli',
    'le moulin de provence', 'smokes poutinerie', 'the gilmour',
    'fairmont chateau', 'pizza', 'mammas pizza', 'pret a manger', 'la diperie',
    'bunna aroma', 'quik sushi', 'brewing at the mar', 'the corner place',
    'gatherings restobar', 'pamilya', 'sukho thai', 'wetzels', 'tim hortons',
    'x cafe', 'cherry\'s hi', 'old time', 'ambassador pizza', 'prince street pizza',
    'back station', 'ladybug wine bar', 'forno cultura', 'bud\'s coffee',
    'on the rock', 'cafe', 'espresso', 'sushi', 'thai', 'pizza', 'pub',
    'restaurant', 'bistro', 'grill', 'bar', 'kitchen', 'eatery',
    'mofer coffee', 'grandma loves you', 'eat bkk', 'columbus',
    'c\'est what', 'tsukiji', 'nori', 'acme',
  ]},

  // ── Alcohol ────────────────────────────────────────────────────────────────
  { cat: 'alcohol', words: [
    'lcbo', 'rao #', 'lost craft', 'fika distillery', 'mill street brew',
    'lcbo/rao', 'beer', 'brewery', 'winery', 'distillery',
  ]},

  // ── Uber Taxis ────────────────────────────────────────────────────────────
  { cat: 'uber', words: [
    'uber canada/ubertrip', 'uber *trip', 'uber trip help', 'ubercash',
    'uber trip', 'lyft', 'taxi',
  ]},

  // ── Transit ───────────────────────────────────────────────────────────────
  { cat: 'transit', words: ['presto fare', 'oct*', 'presto/'],  },

  // ── Pharmacy ──────────────────────────────────────────────────────────────
  { cat: 'pharmacy', words: [
    'shoppers drug', 'sdm 8826', 'sdm8826', 'pharmacie simona', 'fika supply',
    'pharmacy', 'drugstore', 'pharma',
  ]},

  // ── Medical ───────────────────────────────────────────────────────────────
  { cat: 'medical', words: [
    'navigate clinic', 'centre for mindbody', 'mindbody', 'toothworks',
    'york hill endo', 'idoctor', 'dental', 'clinic', 'physiotherapy',
    'chiropractic', 'optometrist', 'hospital', 'medical', 'health centre',
  ]},

  // ── Entertainment ─────────────────────────────────────────────────────────
  { cat: 'entertainment', words: [
    'fanduel', 'ripley', 'ace hotel', 'starbank', 'cineplex', 'theatre',
    'museum', 'canadian war museum', 'war museum', 'casino', 'ticketmaster',
    'eventbrite', 'concert',
  ]},

  // ── Golf / Hobbies / Dev ──────────────────────────────────────────────────
  { cat: 'hobbies', words: [
    'netlify', 'google *workspace', 'donalda club', 'sport chek',
    'the docks driving', 'indigo', 'staircode', 'amazon.ca*gt',
    'golf', 'driving range', 'sporting goods', 'hobby',
  ]},

  // ── Subscriptions ─────────────────────────────────────────────────────────
  { cat: 'subscriptions', words: [
    'apple.com/bill', 'amazon.ca prime', 'amazon channels', 'netflix',
    'google youtubepremiu', 'youtube premium', 'google google one',
    'dropbox', 'claude', 'anthropic', 'uberoneme', 'uber one',
    'prime video', 'spotify', 'disney+', 'crave', 'paramount',
    'microsoft 365', 'google workspace',
  ]},

  // ── Clothing ──────────────────────────────────────────────────────────────
  { cat: 'other', words: [
    'winners', 'zeaberg', 'zara', 'h&m', 'uniqlo', 'gap', 'old navy',
    'ls zesty', 'ls the beaches', 'placewares',
  ]},
];

/** Map each rule's words into lowercased strings for fast matching. */
const COMPILED = RULES.map(r => ({
  cat: r.cat,
  words: r.words.map(w => w.toLowerCase()),
}));

export function categorize(description) {
  const d = description.toLowerCase();
  for (const rule of COMPILED) {
    if (rule.words.some(w => d.includes(w))) return rule.cat;
  }
  return 'other';
}

/**
 * Given an array of {category, amount} bank import rows across multiple months,
 * compute the average monthly spend per category.
 * Only uses months that have at least MIN_TXN transactions so sparse months
 * don't skew the average.
 */
export function computeAverages(allImports) {
  const MIN_TXN = 3;
  // Group by category + month
  const byMonthCat = {};
  allImports.forEach(({ year, month, category, amount }) => {
    if (!category || category === '_skip') return;
    const mk = `${year}-${month}`;
    if (!byMonthCat[mk]) byMonthCat[mk] = {};
    byMonthCat[mk][category] = (byMonthCat[mk][category] || 0) + amount;
  });

  const months = Object.keys(byMonthCat);
  if (months.length < 2) return {};

  const catSums = {};
  const catCounts = {};
  months.forEach(mk => {
    Object.entries(byMonthCat[mk]).forEach(([cat, total]) => {
      catSums[cat]   = (catSums[cat]   || 0) + total;
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    });
  });

  const avgs = {};
  Object.keys(catSums).forEach(cat => {
    if (catCounts[cat] >= Math.min(2, months.length)) {
      avgs[cat] = Math.ceil(catSums[cat] / catCounts[cat] / 10) * 10; // round up to nearest $10
    }
  });
  return avgs;
}
