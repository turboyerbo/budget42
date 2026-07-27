import { MODEL_SMART, MODEL_FAST } from './models.js';
/**
 * Claude API integration for smart transaction categorisation.
 * Called for transactions the rule-based system couldn't categorise
 * (those landing in 'other').
 *
 * Requires VITE_ANTHROPIC_API_KEY in environment variables.
 */

const KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;
export const AI_AVAILABLE = !!KEY;

export async function aiCategorize(transactions, catIds) {
  if (!KEY || transactions.length === 0) return {};

  const catList  = catIds.join(', ');
  const txList   = transactions
    .map((t, i) => `${i}: ${t.description}  $${t.amount.toFixed(2)}`)
    .join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':       'application/json',
      'x-api-key':          KEY,
      'anthropic-version':  '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL_FAST,
      max_tokens: 1024,
      messages: [{
        role:    'user',
        content: `You are a personal finance assistant for a Canadian household budget app.

Categorise each transaction into EXACTLY one of these category IDs:
${catList}

Rules:
- Groceries = supermarkets, delis, fish markets, convenience stores for food
- Dining out = restaurants, cafes, fast food, delivery apps (UberEats, DoorDash)
- Wine & spirits = LCBO, beer stores, taprooms
- Rides = Uber trips, taxis
- Transit = Presto, TTC, GO Transit, OC Transpo
- Pharmacy = Shoppers, SDM, pharmacies, drug stores
- Medical = clinics, dentists, therapy, medical services
- Entertainment = movies, sports, museums, games
- Hobbies = dev tools, golf, art supplies, Netlify, software, books
- Subscriptions = streaming, cloud storage, app subscriptions
- Clothing = clothing stores
- Travel = hotels, flights, trains (VIA Rail), Airbnb
- Salon & spa = hair, nails, massage, spa
- Legal & fees = lawyers, government fees, professional dues
- Other = anything that does not fit above

Return ONLY a JSON array — no explanation, no markdown fences:
[{"i":0,"cat":"groceries"},{"i":1,"cat":"restaurant"}]

Transactions:
${txList}`,
      }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);

  const data  = await res.json();
  const text  = data.content?.[0]?.text || '[]';
  const clean = text.replace(/```json?|```/g, '').trim();
  const arr   = JSON.parse(clean);

  // Map index → category
  const out = {};
  arr.forEach(({ i, cat }) => {
    if (i >= 0 && i < transactions.length) out[transactions[i].id] = cat;
  });
  return out;
}

/**
 * Given all bank_imports, compute the average monthly spend per category
 * across months that have at least MIN_TXN transactions.
 * Returns { categoryId: suggestedTarget } rounded to nearest $10.
 */
export function computeTargets(allImports) {
  const MIN_MONTHS = 2;
  const byMonthCat = {};

  allImports.forEach(({ year, month, category, amount }) => {
    if (!category || category === '_skip' || !amount) return;
    const mk = `${year}-${month}`;
    if (!byMonthCat[mk]) byMonthCat[mk] = {};
    byMonthCat[mk][category] = (byMonthCat[mk][category] || 0) + amount;
  });

  const months  = Object.keys(byMonthCat);
  if (months.length < MIN_MONTHS) return {};

  const sums = {}, counts = {};
  months.forEach(mk => {
    Object.entries(byMonthCat[mk]).forEach(([cat, total]) => {
      sums[cat]   = (sums[cat]   || 0) + total;
      counts[cat] = (counts[cat] || 0) + 1;
    });
  });

  const out = {};
  Object.keys(sums).forEach(cat => {
    if (counts[cat] >= Math.min(MIN_MONTHS, months.length)) {
      const avg = sums[cat] / counts[cat];
      // Round up to nearest $10, minimum $20
      out[cat] = Math.max(20, Math.ceil(avg / 10) * 10);
    }
  });
  return out;
}

/**
 * Suggest a category for a single transaction.
 * Returns { category: string, reason: string } or null on failure.
 */
export async function suggestCategory(description, amount, catIds) {
  if (!KEY) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL_FAST,
        max_tokens: 200,
        messages: [{
          role: 'user',
          content:
            `Categorise this Canadian bank transaction into exactly one of these IDs:\n` +
            `${catIds.join(', ')}\n\n` +
            `Transaction: "${description}"  Amount: $${amount}\n\n` +
            `Reply ONLY with valid JSON, no markdown:\n{"category":"<id>","reason":"<one short sentence>"}`,
        }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content?.[0]?.text || '').replace(/```json?|```/g, '').trim();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * After an import, explain in plain language how this changes the picture.
 * `newRows`    — what was just imported
 * `historical` — all prior bank_imports (year, month, category, amount)
 */
export async function spendingInsight(newRows, historical, catLabels) {
  if (!KEY || !newRows?.length) return null;

  // Summarise locally so we send numbers, not hundreds of raw rows
  const byCat = {};
  newRows.forEach(r => { byCat[r.category] = (byCat[r.category] || 0) + r.amount; });

  const priorByCatMonth = {};
  (historical || []).forEach(r => {
    const k = r.category;
    if (!priorByCatMonth[k]) priorByCatMonth[k] = {};
    const mk = `${r.year}-${r.month}`;
    priorByCatMonth[k][mk] = (priorByCatMonth[k][mk] || 0) + r.amount;
  });

  const compare = Object.entries(byCat).map(([cat, total]) => {
    const months = Object.values(priorByCatMonth[cat] || {});
    const avg = months.length
      ? months.reduce((a, b) => a + b, 0) / months.length
      : null;
    return {
      category: catLabels?.[cat] || cat,
      thisImport: Math.round(total),
      monthlyAverage: avg == null ? null : Math.round(avg),
    };
  }).sort((a, b) => b.thisImport - a.thisImport).slice(0, 10);

  const total = Math.round(newRows.reduce((a, r) => a + r.amount, 0));

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key':KEY,
                 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model: MODEL_SMART,
        max_tokens: 500,
        messages: [{ role:'user', content:
          `A user just imported a bank statement into their household budget app.\n` +
          `Total imported spending: $${total}\n\n` +
          `Category breakdown (thisImport vs their monthlyAverage from past statements, ` +
          `null means no history yet):\n${JSON.stringify(compare, null, 2)}\n\n` +
          `Write 2-4 short observations about what this means for their spending. ` +
          `Be concrete and specific — name categories and dollar figures. ` +
          `Point out anything notably above or below their usual pattern. ` +
          `Be warm and matter-of-fact, never preachy or judgemental about their choices. ` +
          `If there is little history yet, say so plainly and note that accuracy improves ` +
          `with more statements.\n\n` +
          `Reply ONLY with JSON, no markdown:\n` +
          `{"headline":"<one sentence summary>","points":["<observation>","<observation>"]}` }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const txt  = (data.content?.[0]?.text || '').replace(/```json?|```/g,'').trim();
    return JSON.parse(txt);
  } catch {
    return null;
  }
}
