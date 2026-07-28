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

/**
 * Rules for the categories taken from the user's own budget. Applied before the
 * older merchant list, so these win where both match.
 *
 * The point is to get transactions into the right bucket at import time rather
 * than dumping hundreds of rows into "Other" for someone to sort by hand.
 */
const BUDGET_RULES = [
  ['banking',          /finance charge|performance plan|overdraft|o\/d per item|monthly plan fee|interest charge|nsf|service charge|annual fee|foreign (currency )?(conversion|transaction)/i],
  ['phone',            /freedom mobile|rogers|telus|bell canada|fido|koodo|virgin plus|chatr/i],
  ['electricity',      /metergy|toronto hydro|hydro one|alectra|enbridge|energy|utilit/i],
  ['rent',             /\bstela\b|\brent\b|landlord|property manage/i],
  ['rental_insurance', /td ins|td assur|insurance|assurance|intact|belair|sonnet/i],
  ['cleaning',         /cleaners|dry clean|laundr|housekeep|corktown cleaners/i],
  ['subscriptions',    /netflix|spotify|disney|crave|prime video|youtubepremiu|youtube premium|dropbox|icloud|google one|google play|apple\.com\/bill|claude\.ai|anthropic|openai|adobe|microsoft 365|patreon|substack|nytimes|globe and mail|uber ?one|amazon.*prime member|netlify|github|figma/i],
  ['alcohol',          /lcbo|beer store|wine rack|liquor|brewery|brewing|distiller|cigar|tobacco|vape/i],
  ['transit',          /presto|ttc|go transit|metrolinx|via rail|transit/i],
  ['uber',             /uber ?(canada|trip|\*|eats)?|lyft|taxi|beck taxi|co-?op cabs/i],
  ['pharmacy',         /shoppers drug|pharmaprix|rexall|pharmacy|drug mart|guardian drug/i],
  ['medical',          /clinic|dental|dentist|physio|chiro|massage|therapy|therapist|mindbody|navigate clinic|toothworks|optometr|medical|hospital|lab ?test/i],
  ['groceries',        /loblaw|no frills|metro |sobeys|food basics|freshco|farm boy|rabba|marche|marché|fortinos|longo|costco|walmart.*(grocer|superc)|canary market|ponesse|aisle 24|convenience|nofrills|independent/i],
  ['restaurant',       /restaurant|resto|cafe|caf\u00e9|coffee|espresso|bar\b|pizza|sushi|ramen|burger|kitchen|bistro|tavern|pub\b|grill|bakery|doordash|skip ?the ?dishes|foodora|tim hortons|starbucks|mcdonald|subway|chipotle/i],
  ['salon',            /salon|spa\b|barber|hair|nails|aesthetic|esthetic/i],
  ['clothing',         /winners|zara|uniqlo|h&m|gap\b|old navy|lululemon|nordstrom|simons|sport ?chek|foot locker|zeaberg|clothing|apparel/i],
  ['travel',           /airbnb|agoda|booking\.com|expedia|hotel|air canada|westjet|porter air|flight|vrbo|hostel|resort/i],
  ['entertainment',    /cineplex|cinema|theatre|theater|concert|ticketmaster|museum|gallery|steam ?games|nintendo|playstation|xbox/i],
  ['hobbies',          /golf|donalda|club\b|gym|fitness|goodlife|yoga|pilates|sport|hobby|craft/i],
  ['legal',            /legal|lawyer|solicitor|notary|accountant|oaa\b|licen[cs]e fee|professional fee|affirm canada/i],
  ['gifts',            /gift|florist|flowers/i],
];

export function categorizeBudget(description) {
  const d = String(description || '');
  for (const [cat, re] of BUDGET_RULES) {
    if (re.test(d)) return cat;
  }
  return null;
}
