/**
 * Chrome recommends 1.5 k characters per tool output, with no hard limit.
 * Filling to the budget rather than to a count: twelve 240-character excerpts
 * make 6296. Two exemptions: `read_task_detail`, which capped at 1.5 k returned
 * one or two entries per page once evidence was attached, and `resume_task`,
 * which has its own budget in tokens, 1600 characters, 1528 in practice.
 * https://developer.chrome.com/docs/ai/webmcp/secure-tools
 */
export const MAX_TOOL_OUTPUT = 1_500

/**
 * Room set aside for the header and footer, which depend on how many entries
 * the loop keeps. Reserving generously breaks the circularity.
 */
export const OUTPUT_FRAME = 300

/**
 * What is left for the entries themselves.
 */
export const OUTPUT_BODY = MAX_TOOL_OUTPUT - OUTPUT_FRAME

/**
 * Fills to the budget rather than to a count, and always returns at least one
 * item: an entry bigger than the budget would return an empty page, and
 * pagination would never advance.
 */
export function fitting<T>(items: readonly T[], cost: (item: T) => number): T[] {
  const kept: T[] = []
  let used = 0
  for (const item of items) {
    const price = cost(item)
    if (kept.length > 0 && used + price > OUTPUT_BODY) break
    kept.push(item)
    used += price
  }
  return kept
}
