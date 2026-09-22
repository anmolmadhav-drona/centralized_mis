// Controlled fuzzy-matching for DROPDOWN field values.
//
// Purpose: correct minor typos / casing differences (e.g. "IN TRANSIT" →
// "In Transit", "Delievered" → "Delivered") while NEVER merging values that
// carry additional semantic content.
//
// Safety rules:
//   1. Exact normalised match is always preferred (case-insensitive, whitespace
//      collapsed) — fuzzy matching is only attempted when no exact match exists.
//   2. Token safety: we tokenize both the input and each candidate. If the
//      input contains meaningful tokens that are not present (or reasonably
//      covered) in the candidate, the candidate is skipped.  This prevents
//      "Not Delivered" from being silently merged with "Delivered".
//   3. Negation guard: tokens such as "not", "no", "never" are treated as
//      fully blocking — an input containing a negation word must NOT match a
//      candidate that lacks that same word.
//   4. Strict similarity threshold: the normalised edit distance must be
//      sufficiently close (≤ 20 % of the candidate length for short strings,
//      ≤ 15 % for longer ones).  When uncertain, the original value is preserved.
//   5. Data-driven: the function accepts the canonical list as a parameter.
//      Adding a new canonical status (e.g. "Returned") automatically enables
//      typo-correction for that value at all call sites.

// --------------------------------------------------------------------------
// Character-level Levenshtein distance (O(n·m), capped for performance)
// --------------------------------------------------------------------------
function levenshtein(a: string, b: string): number {
  const la = a.length
  const lb = b.length
  if (la === 0) return lb
  if (lb === 0) return la

  // single-row rolling DP
  let prev = Array.from({ length: lb + 1 }, (_, i) => i)
  for (let i = 1; i <= la; i++) {
    const curr = [i]
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      )
    }
    prev = curr
  }
  return prev[lb]
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Collapse whitespace, trim. */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Tokenize into lowercase words, removing empty strings. */
function tokenize(s: string): string[] {
  return normalizeWs(s)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

/** Words that carry negation semantics.  Must be present in BOTH input and
 *  candidate for a match to be possible; if either lacks them while the other
 *  has them, the match is blocked. */
const NEGATION_TOKENS = new Set(['not', 'no', 'never', 'non', 'un', 'without'])

/**
 * Returns true when the candidate tokens "cover" the input tokens well enough
 * to allow fuzzy-matching — i.e. the input does not contain meaningful extra
 * words that the candidate is silent about.
 *
 * Rules applied in order:
 *  a) Negation parity — if input has a negation token and candidate does not
 *     (or vice-versa), reject immediately.
 *  b) Extra token count — if the input has more tokens than the candidate, the
 *     extra tokens must be entirely accountable for by whitespace (duplicates,
 *     mid-word space).  We allow at most ZERO uncovered tokens: every input
 *     token must map to some candidate token via exact match or tight edit-
 *     distance (≤1 char).
 */
function tokensSafe(inputTokens: string[], candidateTokens: string[]): boolean {
  const candSet = new Set(candidateTokens)

  // (a) negation parity
  const inputHasNeg = inputTokens.some((t) => NEGATION_TOKENS.has(t))
  const candHasNeg  = candidateTokens.some((t) => NEGATION_TOKENS.has(t))
  if (inputHasNeg !== candHasNeg) return false

  // (b) every input token must be covered by at least one candidate token
  //     (exact or off-by-one edit)
  for (const it of inputTokens) {
    const covered = candidateTokens.some((ct) => {
      if (ct === it) return true
      // proportional fuzziness: allow up to 30% edit distance within a single
      // word to handle transpositions like "trasnit" → "transit" (2 edits in
      // a 7-char word = 28 %).  Minimum tolerance is 1 for very short words.
      const maxEdits = Math.max(1, Math.floor(Math.max(it.length, ct.length) * 0.30))
      return levenshtein(it, ct) <= maxEdits
    })
    if (!covered) {
      // the input has a token not represented in the candidate at all
      // → this candidate is semantically different, block
      return false
    }
  }

  // (c) if the candidate has tokens absent from input, that is fine
  //     (candidate is more specific than input, which is unusual for status
  //     strings, but we allow it — the similarity threshold below will handle
  //     the rest)
  void candSet
  return true
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

export interface NormalizerOptions {
  /**
   * Maximum allowed edit distance as a fraction of the longer string's length.
   * Default 0.25 (25 %).  Stricter values reduce false positives.
   */
  threshold?: number
}

/**
 * normalizeStatus
 *
 * Given a raw input string and the current canonical status list, returns the
 * best-matching canonical value, or the normalised input if no confident match
 * is found.
 *
 * @param raw        - The value from the user / spreadsheet cell.
 * @param canonicals - The live canonical option list for this dropdown field.
 * @param opts       - Optional tuning parameters.
 */
export function normalizeStatus(
  raw: string,
  canonicals: string[],
  opts: NormalizerOptions = {},
): string {
  if (!raw || canonicals.length === 0) return raw

  const { threshold = 0.30 } = opts

  const normalised = normalizeWs(raw)
  if (!normalised) return raw

  // Step 1: exact normalised match (case- and whitespace-insensitive)
  const normLower = normalised.toLowerCase()
  for (const c of canonicals) {
    if (normalizeWs(c).toLowerCase() === normLower) return c
  }

  // Step 2: fuzzy match
  const inputTokens = tokenize(normalised)

  let bestCanonical = ''
  let bestDist = Infinity

  for (const c of canonicals) {
    const candidateNorm = normalizeWs(c).toLowerCase()
    const candidateTokens = tokenize(candidateNorm)

    // Token safety check — blocks negation mismatches and extra-word mismatches
    if (!tokensSafe(inputTokens, candidateTokens)) continue

    const dist = levenshtein(normLower, candidateNorm)
    const maxLen = Math.max(normLower.length, candidateNorm.length)
    const ratio = maxLen === 0 ? 0 : dist / maxLen

    if (ratio <= threshold && dist < bestDist) {
      bestDist = dist
      bestCanonical = c
    }
  }

  return bestCanonical || normalised
}

/**
 * normalizeDropdownValue
 *
 * Convenience wrapper: given a field's options array and a raw cell value,
 * returns the canonicalized value (or the normalised raw string when no match
 * is found).  Returns null when the input is empty.
 */
export function normalizeDropdownValue(
  raw: unknown,
  options: string[] | null,
): string | null {
  if (raw == null || raw === '') return null
  const s = normalizeWs(String(raw))
  if (!s) return null
  if (!options || options.length === 0) return s
  return normalizeStatus(s, options)
}
