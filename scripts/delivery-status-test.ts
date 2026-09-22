// Unit tests for the controlled fuzzy delivery-status normalizer.
// Run: bun scripts/delivery-status-test.ts
import { normalizeStatus, normalizeDropdownValue } from '../src/lib/services/status-normalizer'

// The canonical list is intentionally kept here (not imported from the DB) so
// these tests are self-contained and match the real dropdown options exactly.
const CANONICALS = [
  'In Transit',
  'Delivered',
  'Pending',
]

let PASS = 0
let FAIL = 0

function ok(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    PASS++
    console.log(`  ✓ ${name}`)
  } else {
    FAIL++
    console.log(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      got:      ${JSON.stringify(actual)}`)
  }
}

// ---------------------------------------------------------------------------
// Exact match (case-insensitive, whitespace-collapsed)
// ---------------------------------------------------------------------------
console.log('== Exact / canonical input (should pass through unchanged) ==')
ok('In Transit',  normalizeStatus('In Transit',  CANONICALS), 'In Transit')
ok('Delivered',   normalizeStatus('Delivered',   CANONICALS), 'Delivered')
ok('Pending',     normalizeStatus('Pending',     CANONICALS), 'Pending')

// ---------------------------------------------------------------------------
// ALL-CAPS variants
// ---------------------------------------------------------------------------
console.log('== UPPER CASE inputs ==')
ok('IN TRANSIT → In Transit',  normalizeStatus('IN TRANSIT',  CANONICALS), 'In Transit')
ok('DELIVERED → Delivered',    normalizeStatus('DELIVERED',   CANONICALS), 'Delivered')
ok('PENDING → Pending',        normalizeStatus('PENDING',     CANONICALS), 'Pending')

// ---------------------------------------------------------------------------
// Lower case variants
// ---------------------------------------------------------------------------
console.log('== lower case inputs ==')
ok('in transit → In Transit',  normalizeStatus('in transit',  CANONICALS), 'In Transit')
ok('delivered → Delivered',    normalizeStatus('delivered',   CANONICALS), 'Delivered')
ok('pending → Pending',        normalizeStatus('pending',     CANONICALS), 'Pending')

// ---------------------------------------------------------------------------
// Extra / collapsed whitespace
// ---------------------------------------------------------------------------
console.log('== Extra whitespace ==')
ok('"In  Transit" (double space) → In Transit', normalizeStatus('In  Transit', CANONICALS), 'In Transit')
ok('"  Delivered  " → Delivered',               normalizeStatus('  Delivered  ', CANONICALS), 'Delivered')

// ---------------------------------------------------------------------------
// Typo corrections (should fuzzy-match)
// ---------------------------------------------------------------------------
console.log('== Typo correction ==')
ok('In Trasnit → In Transit',  normalizeStatus('In Trasnit',  CANONICALS), 'In Transit')
ok('Delievered → Delivered',   normalizeStatus('Delievered',  CANONICALS), 'Delivered')
ok('Deliverd → Delivered',     normalizeStatus('Deliverd',    CANONICALS), 'Delivered')
ok('In Tranist → In Transit',  normalizeStatus('In Tranist',  CANONICALS), 'In Transit')
ok('Penidng → Pending',        normalizeStatus('Penidng',     CANONICALS), 'Pending')

// ---------------------------------------------------------------------------
// SAFETY: Negated values MUST NOT match their positive counterparts
// ---------------------------------------------------------------------------
console.log('== SAFETY — negated inputs must NOT merge ==')
ok('Not Delivered ≠ Delivered',  normalizeStatus('Not Delivered',  CANONICALS), 'Not Delivered')
ok('Not In Transit ≠ In Transit', normalizeStatus('Not In Transit', CANONICALS), 'Not In Transit')
ok('NOT DELIVERED ≠ Delivered',  normalizeStatus('NOT DELIVERED',  CANONICALS), 'NOT DELIVERED')
ok('not delivered ≠ Delivered',  normalizeStatus('not delivered',  CANONICALS), 'not delivered')
ok('No Transit ≠ In Transit',    normalizeStatus('No Transit',     CANONICALS), 'No Transit')

// ---------------------------------------------------------------------------
// SAFETY: Semantically distinct values MUST NOT be merged
// ---------------------------------------------------------------------------
console.log('== SAFETY — distinct statuses must not collide ==')
ok('"Return" stays as-is',        normalizeStatus('Return',        CANONICALS), 'Return')
ok('"Return to WH" stays as-is',  normalizeStatus('Return to WH',  CANONICALS), 'Return to WH')

// ---------------------------------------------------------------------------
// normalizeDropdownValue (null / empty handling)
// ---------------------------------------------------------------------------
console.log('== normalizeDropdownValue helper ==')
ok('null input → null',   normalizeDropdownValue(null, CANONICALS), null)
ok('"" input → null',     normalizeDropdownValue('', CANONICALS),   null)
ok('"  " input → null',   normalizeDropdownValue('  ', CANONICALS), null)
ok('DELIVERED → Delivered',  normalizeDropdownValue('DELIVERED', CANONICALS), 'Delivered')
ok('no options list → pass-through', normalizeDropdownValue('DELIVERED', []), 'DELIVERED')
ok('null options → pass-through', normalizeDropdownValue('DELIVERED', null), 'DELIVERED')

// ---------------------------------------------------------------------------
// Future-status proofing: adding a new canonical auto-enables its correction
// ---------------------------------------------------------------------------
console.log('== Future status extensibility ==')
const EXTENDED = [...CANONICALS, 'Returned to Sender']
ok('"Returnd to Sender" → Returned to Sender',
  normalizeStatus('Returnd to Sender', EXTENDED), 'Returned to Sender')
ok('"Not Returned to Sender" is NOT merged',
  normalizeStatus('Not Returned to Sender', EXTENDED), 'Not Returned to Sender')

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
console.log('')
console.log(`RESULT: ${PASS} pass / ${FAIL} fail`)
process.exit(FAIL > 0 ? 1 : 0)
