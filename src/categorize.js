/**
 * Rule-based transaction categoriser.
 * Built from 7+ months of Jordan & Ness's actual spending.
 * Covers ~90% of Canadian household merchants automatically.
 * Unknown merchants get 'other' → optionally upgraded by Claude API.
 */

const RULES = [
  // ── Skip: transfers, CC payments, income, fixed bills ─────────────────────
  { cat: '_skip', words: [
    'interac etrnsfr', 'e-transfer', 'ctfs.com/payment', 'canadian tire bank',
    'pc mastercard', 'metergy sol', 'freedom mobile', 'affirm canada',
    'stela', 'td ins', 'td assur', 'performance plan fee', 'overdraft',
    'purchase finance charge', 'cash finance charge', 'purchase interest charge',
    'sunlife', 'sun life', 'norr architects', 'fig financial',
    'transfer in', 'transfer out', 'payroll', 'direct deposit', 'e-deposit',
    'returned item', 'stop payment', 'bmo performance', 'service charge',
    'interest earned', 'interest paid', 'government of canada',
    'service ontario', 'cra', 'canada revenue', 'hsbc', 'rbc', 'scotiabank',
    'money transfer', 'e_trfin', 'e_trfout',
  ]},

  // ── Groceries ──────────────────────────────────────────────────────────────
  { cat: 'groceries', words: [
    'metro', 'marche leo', 'canary market', 'ponesse', 'sugo cafe',
    'aisle 24', "davidson's", "mike's fish", 'family food', 'seafront fish',
    'bulk barn', 'sherwood market', 'rabba', "rocco's no frills", 'no frills',
    'pay n run', 'all u need', 'international chee', 'jarvis market',
    'loblaws', 'superstore', 'food basics', 'freshco', 'sobeys',
    'whole foods', 'farm boy', 'longos', "zehrs", 'independent city',
    't&t', 'h mart', 'global foods', 'fortinos', 'nations fresh',
    'dollarama', 'freshmart', 'coppa', 'pusateri',
    "marche d'ali", 'marche ali', 'walmart grocery', 'costco',
  ]},

  // ── Restaurants & Takeout ──────────────────────────────────────────────────
  { cat: 'restaurant', words: [
    'dark horse', 'tst-', 'ddsukhothai', 'dd sukho', 'sukhothai',
    'popeyes', 'ubereats', 'doordash', 'jollibee', 'pii nong', 'rodneys oyster',
    'hawa beirut', 'fox and firkin', 'cafe landwer', 'sumach espresso',
    'old time', 'saku', 'beertown', 'the golden pigeon', 'score on king',
    'lima charlie', 'moegi sushi', 'nari sushi', 'cafe oro di napoli',
    'le moulin de provence', 'smokes poutinerie', 'the gilmour',
    'fairmont', 'pizza', 'mammas', 'pret a manger', 'la diperie',
    'bunna aroma', 'quik sushi', 'brewing at', 'the corner place',
    'gatherings', 'pamilya', 'wetzels', 'tim hortons', 'starbucks',
    'second cup', 'mcdonald', 'a&w', 'burger king', 'harvey',
    'subway', 'chipotle', 'five guys', 'kfc', 'swiss chalet',
    'jack astor', 'boston pizza', 'milestones', 'earls', 'joey',
    'the keg', 'montanas', 'kelsey', 'red lobster',
    'sushi', 'ramen', 'pho', 'thai', 'indian', 'chinese', 'vietnamese',
    'mediterranean', 'greek', 'italian', 'mexican', 'burrito',
    'mofer coffee', 'grandma loves you', 'eat bkk', 'columbus',
    "c'est what", 'on the rock', 'ambassador pizza',
    'cafe', 'espresso', 'coffee', 'restaurant', 'bistro',
    'grill', 'kitchen', 'eatery', 'diner', 'canteen', 'brasserie',
  ]},

  // ── Wine & spirits ────────────────────────────────────────────────────────
  { cat: 'alcohol', words: [
    'lcbo', '/rao #', 'lost craft', 'fika distillery', 'mill street',
    'beer store', 'the beer store', 'lcbo/rao', 'lcbo rao',
    'brewery', 'winery', 'distillery', 'taproom',
  ]},

  // ── Rides (Uber etc.) ─────────────────────────────────────────────────────
  { cat: 'uber', words: [
    'uber canada/ubertrip', 'uber *trip', 'uber trip help', 'ubercash',
    'lyft', 'cab ', 'taxi ', 'beck taxi',
  ]},

  // ── Transit ───────────────────────────────────────────────────────────────
  { cat: 'transit', words: ['presto fare', 'presto/', 'oct*', 'ttc ', 'go transit', 'via rail'] },

  // ── Pharmacy ──────────────────────────────────────────────────────────────
  { cat: 'pharmacy', words: [
    'shoppers drug', 'sdm 8826', 'sdm8826', 'pharmacie', 'fika supply',
    'rexall', 'guardian pharmacy', 'remedy', 'pharma plus', 'mckesson',
    'pharmasave', 'london drugs',
  ]},

  // ── Medical & Dental ──────────────────────────────────────────────────────
  { cat: 'medical', words: [
    'navigate clinic', 'centre for mindbody', 'mindbody',
    'toothworks', 'york hill endo', 'idoctor', 'dental', 'clinic',
    'physiotherapy', 'chiropractic', 'optometrist', 'hospital',
    'medical centre', 'health centre', 'doctor', 'dentist',
    'orthodontic', 'dermatology', 'ophthalmology',
  ]},

  // ── Entertainment ─────────────────────────────────────────────────────────
  { cat: 'entertainment', words: [
    'fanduel', 'ripley', 'ace hotel', 'cineplex', 'theatre', 'theater',
    'museum', 'canadian war museum', 'war museum', 'casino', 'ticketmaster',
    'eventbrite', 'concert', 'live nation', 'stubhub', 'playdium',
    'wonderland', 'legoland', 'attraction', 'trampoline', 'escape room',
  ]},

  // ── Hobbies & Dev ─────────────────────────────────────────────────────────
  { cat: 'hobbies', words: [
    'netlify', 'google *workspace', 'donalda club', 'sport chek',
    'the docks driving range', 'indigo', 'staircode', 'amazon.ca*gt',
    'golf', 'driving range', 'golf town', 'golf course',
    'chapters', 'bookstore', 'hobby', 'michael', 'deserres', 'curry',
    'github', 'digital ocean', 'vercel', 'render.com',
  ]},

  // ── Subscriptions ─────────────────────────────────────────────────────────
  { cat: 'subscriptions', words: [
    'apple.com/bill', 'amazon.ca prime', 'amazon channels', 'netflix',
    'google youtubepremiu', 'youtube premium', 'google google one',
    'dropbox', 'claude', 'anthropic', 'uberoneme', 'uber one',
    'prime video', 'spotify', 'disney+', 'crave', 'paramount',
    'microsoft 365', 'google workspace', 'adobe', 'notion',
    'duolingo', '1password', 'bitwarden', 'nordvpn',
  ]},

  // ── Clothing ──────────────────────────────────────────────────────────────
  { cat: 'clothing', words: [
    'winners', 'zeaberg', 'zara', 'h&m', 'uniqlo', 'gap', 'old navy',
    'ls zesty', 'ls the beaches', 'marshalls', 'tjmaxx', 'banana republic',
    'club monaco', 'aritzia', 'lululemon', 'roots', 'reitmans', 'le chateau',
    'aldo', 'naturalizer', 'shoe carnival', 'softmoc', 'dsw', 'foot locker',
  ]},

  // ── Travel ────────────────────────────────────────────────────────────────
  { cat: 'travel', words: [
    'bkg*hotel', 'booking.com', 'agoda', 'expedia', 'airbnb', 'vrbo',
    'via rail', 'air canada', 'westjet', 'porter airlines', 'swoop',
    'omni king edward', 'fairmont', 'marriott', 'hilton', 'hyatt',
    'best western', 'holiday inn', 'comfort inn', 'days inn',
    'lum hotel', 'hotel', 'motel', 'resort', 'inn ',
  ]},

  // ── Salon & Spa ───────────────────────────────────────────────────────────
  { cat: 'salon', words: [
    'corktown - queen', 'room1six', 'sp ecostems', 'salon', 'spa',
    'hair', 'nails', 'manicure', 'pedicure', 'massage', 'facial',
    'barber', 'waxing', 'threading', 'blowout',
  ]},

  // ── Legal & Professional ──────────────────────────────────────────────────
  { cat: 'legal', words: [
    'affirm canada', 'bam*ont assoc of archi', 'corp canada',
    'nuans', 'ontario association', 'lawyers', 'notary', 'paralegal',
    'mto tsd', 'service ontario', 'government fee',
    'turbotax', 'intuit *turbo', 'h&r block', 'accountant',
  ]},
];

const COMPILED = RULES.map(r => ({
  cat: r.cat,
  words: r.words.map(w => w.toLowerCase()),
}));

export function categorize(description) {
  const d = (description || '').toLowerCase();
  for (const rule of COMPILED) {
    if (rule.words.some(w => d.includes(w))) return rule.cat;
  }
  return 'other';
}
