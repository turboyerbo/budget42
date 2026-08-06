import { MODEL_FAST } from './models.js';
import { callClaude, textOf } from './claude.js';

/**
 * "Should we spend the money sitting available right now, or hold off?"
 *
 * A small, focused question — not a general financial advisor — so this
 * uses the fast/cheap model and a tight prompt, and always degrades to a
 * plain-rules answer if Claude isn't available or the call fails. The
 * person should never see a blank state just because AI is unreachable.
 */

function ruleBasedAdvice(snapshot) {
  const { availableMoney, billsNotChargedYet, predictedIncomeTotal,
          budgetedForSpending, spentSoFar } = snapshot;

  if (availableMoney <= 0) {
    return "There's nothing free to spend right now — income minus what's gone out is already at or below zero.";
  }
  if (billsNotChargedYet > availableMoney) {
    return `${fmtLocal(billsNotChargedYet)} in bills hasn't been charged yet, which is more than the ${fmtLocal(availableMoney)} available — it may be safer to hold off on extra spending until those clear.`;
  }
  if (predictedIncomeTotal > 0 && budgetedForSpending > predictedIncomeTotal) {
    return `The budget (${fmtLocal(budgetedForSpending)}) is higher than what's predicted to come in this month (${fmtLocal(predictedIncomeTotal)}) — worth trimming a category or two, or confirming more income is on the way.`;
  }
  if (spentSoFar > budgetedForSpending * 0.8 && budgetedForSpending > 0) {
    return "Spending is already close to the budgeted amount for the month — the remaining available money might be better saved than spent.";
  }
  return `${fmtLocal(availableMoney)} is genuinely free right now, with bills accounted for — a reasonable amount to put toward spending, a goal, or just leave as a cushion.`;
}

function fmtLocal(n) {
  return '$' + Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/**
 * @param snapshot {
 *   availableMoney, actualIncome, predictedIncomeTotal, spentSoFar,
 *   billsNotChargedYet, budgetedForSpending, goalsMonthlyTotal
 * }
 * @returns {Promise<{advice: string, source: 'ai'|'rules'}>}
 */
export async function getBudgetAdvice(snapshot) {
  try {
    const data = await callClaude({
      model: MODEL_FAST,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content:
          `You're a calm, practical household budget assistant. Here is this month's snapshot ` +
          `for a couple sharing a budget app, in dollars:\n\n` +
          `Available money right now (income minus what's already been spent): $${Math.round(snapshot.availableMoney)}\n` +
          `Actual income landed so far this month: $${Math.round(snapshot.actualIncome)}\n` +
          `Predicted income for the month: $${Math.round(snapshot.predictedIncomeTotal)}\n` +
          `Spent so far this month: $${Math.round(snapshot.spentSoFar)}\n` +
          `Budgeted for spending this month: $${Math.round(snapshot.budgetedForSpending)}\n` +
          `Bills recognised but not yet charged: $${Math.round(snapshot.billsNotChargedYet)}\n` +
          `Monthly goal contributions committed: $${Math.round(snapshot.goalsMonthlyTotal || 0)}\n\n` +
          `In ONE short sentence (under 30 words), give a specific, practical suggestion about ` +
          `whether it makes sense to spend the available money now, save it, or hold off because ` +
          `of upcoming bills — reference the actual numbers. Be warm, not preachy. Never say ` +
          `"consult a financial advisor."\n\n` +
          `Reply with ONLY the sentence, no quotes, no markdown, no preamble.`,
      }],
    });
    const text = textOf(data);
    if (text) return { advice: text, source: 'ai' };
    throw new Error('empty response');
  } catch {
    return { advice: ruleBasedAdvice(snapshot), source: 'rules' };
  }
}
