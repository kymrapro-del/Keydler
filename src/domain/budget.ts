/**
 * Chrome recommends 1.5 k characters per tool output, with no hard limit: so we fill up to the
 * budget and not up to a count, twelve 240-character excerpts making 6296.
 * Two exemptions: `read_task_detail`, which capped at 1.5 k returned only one or two entries
 * per page as soon as evidence was attached, and `resume_task`, which has its own budget in
 * tokens, that is 1600 characters, 1528 rendered in practice.
 * https://developer.chrome.com/docs/ai/webmcp/secure-tools
 */
export const MAX_TOOL_OUTPUT = 1_500

/**
 * Room set aside up front for the header and the footer, which depend on the
 * number of entries finally kept, so on the result of the loop that picks
 * them. Reserving generously lifts the circularity without complicating the count.
 */
export const OUTPUT_FRAME = 300

/**
 * What is left for the entries themselves.
 */
export const OUTPUT_BODY = MAX_TOOL_OUTPUT - OUTPUT_FRAME

/**
 * Fills up to the budget rather than up to a count, and ALWAYS returns at least
 * one item: an entry bigger than the budget would otherwise return an empty
 * page, and pagination would never advance.
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
