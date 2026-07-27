/**
 * Model choices, in one place.
 *
 * Reading a multi-page PDF and reasoning about spending patterns needs the
 * stronger model. Sorting a merchant name into one of fifteen buckets does not,
 * and those calls happen in bulk — so they use the cheap fast one.
 */
export const MODEL_SMART = 'claude-sonnet-5';            // PDF vision, insight
export const MODEL_FAST  = 'claude-haiku-4-5-20251001';  // categorising, bank ID
