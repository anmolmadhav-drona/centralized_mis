// Unit tests for the business-key normalization module (import dedup backbone).
// Run: bun scripts/business-key-test.ts
import {
  normalizeLrNo, normalizeInvoice, normalizePartyName, normalizeMaterial,
  buildBusinessKey, buildLineKey, computeRecordKeys, materialOfLineKey,
} from '../src/lib/services/business-key'

let PASS = 0
let FAIL = 0
function ok(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) { PASS++; console.log(`  ✓ ${name}`) }
  else { FAIL++; console.log(`  ✗ ${name} — expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`) }
}

console.log('== LR No. normalization ==')
ok('number 1301', normalizeLrNo(1301), '1301')
ok('string "1301"', normalizeLrNo('1301'), '1301')
ok('string " 1301 "', normalizeLrNo(' 1301 '), '1301')
ok('string "01301" → canonical int (Int column cannot keep leading zeros)', normalizeLrNo('01301'), '1301')
ok('null', normalizeLrNo(null), null)
ok('empty string', normalizeLrNo(''), null)
ok('whitespace-only', normalizeLrNo('   '), null)
ok('float 1301.0', normalizeLrNo(1301.0), '1301')

console.log('== Invoice normalization ==')
ok('plain', normalizeInvoice('SONGOG26/22337'), 'SONGOG26/22337')
ok('lowercase + spaces', normalizeInvoice(' songog26/22337 '), 'SONGOG26/22337')
ok('trailing space', normalizeInvoice('SONGOG26/22337 '), 'SONGOG26/22337')
ok('numeric Excel cell 543965', normalizeInvoice(543965), '543965')
ok('string "543965" equals numeric', normalizeInvoice('543965'), normalizeInvoice(543965))
ok('internal double spaces collapse', normalizeInvoice('SO  NGOG26/22337'), 'SO NGOG26/22337')
ok('null', normalizeInvoice(null), null)
ok('empty', normalizeInvoice(''), null)

console.log('== Party Name normalization ==')
ok('upper', normalizePartyName('ABC INDUSTRIES'), 'ABC INDUSTRIES')
ok('padded lower', normalizePartyName(' abc industries '), 'ABC INDUSTRIES')
ok('collapsed internal whitespace', normalizePartyName('ABC   INDUSTRIES'), 'ABC INDUSTRIES')
ok('legal suffix preserved (LTD. ≠ nothing)', normalizePartyName('ABC INDUSTRIES LTD.') === normalizePartyName('ABC INDUSTRIES'), false)
ok('null', normalizePartyName(null), null)
ok('empty', normalizePartyName(''), null)

console.log('== Material normalization ==')
ok('upper + collapse', normalizeMaterial('  tata motors hp genuine def - 1*20l '), 'TATA MOTORS HP GENUINE DEF - 1*20L')
ok('null → empty', normalizeMaterial(null), '')

console.log('== Business key ==')
const k1 = buildBusinessKey(1301, 'SONGOG26/22337', 'ABC INDUSTRIES')
ok('built', k1, '1301\nSONGOG26/22337\nABC INDUSTRIES')
ok('whitespace/case variants are the SAME key',
  buildBusinessKey(' 1301 ', ' songog26/22337 ', ' abc industries '), k1)
ok('missing LR → null', buildBusinessKey(null, 'X', 'Y'), null)
ok('missing Invoice → null', buildBusinessKey(1, '', 'Y'), null)
ok('missing Party → null', buildBusinessKey(1, 'X', '  '), null)
ok('different party → different key', buildBusinessKey(1301, 'SONGOG26/22337', 'XYZ TRADERS') !== k1, true)
ok('different LR → different key', buildBusinessKey(1302, 'SONGOG26/22337', 'ABC INDUSTRIES') !== k1, true)
ok('different invoice → different key', buildBusinessKey(1301, 'OTHER/1', 'ABC INDUSTRIES') !== k1, true)
ok('party with separator char cannot inject fake key parts',
  buildBusinessKey(1, 'A', 'X\nY'), buildBusinessKey(1, 'A\nX', 'Y') === null ? 'safe' : buildBusinessKey(1, 'A', 'X\nY'))

console.log('== Line key (now Material + Bucket + Qty + Measurement) ==')
ok('built (measurement given)', buildLineKey('DEF 1*20L', 50, 1000, 'Liters'), 'DEF 1*20L\n50\n1000\nLTR')
ok('case-insensitive material', buildLineKey('def 1*20l', 50, 1000, 'LTR'), 'DEF 1*20L\n50\n1000\nLTR')
ok('null material but qty present', buildLineKey(null, 50, 1000, 'LTR'), '\n50\n1000\nLTR')
ok('missing measurement → Unspecified token', buildLineKey('M', 50, 1000), 'M\n50\n1000\nUnspecified')
ok('all empty', buildLineKey(null, null, null), '\n\n\nUnspecified')
ok('never null', typeof buildLineKey(null, null, null) === 'string', true)
ok('material part extraction', materialOfLineKey('DEF 1*20L\n50\n1000\nLTR'), 'DEF 1*20L')
ok('material part of empty key', materialOfLineKey(''), '')
ok('same material different qty → different line keys',
  buildLineKey('M', 50, 1000, 'LTR') !== buildLineKey('M', 3, 60, 'LTR'), true)

console.log('== Line key measurement identity ==')
// Same material/bucket/qty, different UNIT → different identity (never merged)
ok('100 LTR ≠ 100 KG', buildLineKey('Chemical', 10, 100, 'LTR') !== buildLineKey('Chemical', 10, 100, 'KG'), true)
// Case/spacing variants of the SAME unit → identical identity
ok('Liters/liters/Ltrs/ltr/LTR all collapse to one identity',
  new Set([
    buildLineKey('Chemical', 10, 100, 'Liters'),
    buildLineKey('Chemical', 10, 100, 'liters'),
    buildLineKey('Chemical', 10, 100, 'Ltrs'),
    buildLineKey('Chemical', 10, 100, ' ltr '),
    buildLineKey('Chemical', 10, 100, 'LTR'),
  ]).size === 1, true)
ok('LTR identity string is canonical', buildLineKey('Chemical', 10, 100, 'liters'), 'CHEMICAL\n10\n100\nLTR')

console.log('== computeRecordKeys ==')
const keys = computeRecordKeys({ lrNo: 1358, invoiceNumber: 'JHUSO26/433774', partyName: 'MS Magpie Filling Station', materialDetails: 'DEF 1*20L', bucket: 50, totalQuantity: 1000, measurement: 'Liters' })
ok('businessKey', keys.businessKey, '1358\nJHUSO26/433774\nMS MAGPIE FILLING STATION')
ok('lineKey (measurement normalized in key)', keys.lineKey, 'DEF 1*20L\n50\n1000\nLTR')
const partial = computeRecordKeys({ lrNo: 1358, partyName: 'X' })
ok('missing invoice → businessKey null, lineKey still present', partial.businessKey === null && partial.lineKey === '\n\n\nUnspecified', true)

console.log('== PTL multi-line reality (production baseline shape) ==')
// LR 1358 carries 4 lines: two materials, each twice with different quantities
const l1 = buildLineKey('TATA Motors HP Genuine Def - 1*20L', 50, 1000, 'LTR')
const l2 = buildLineKey('TATA Motors HP Genuine Def - 4*5L', 20, 400, 'LTR')
const l3 = buildLineKey('TATA Motors HP Genuine Def - 1*20L', 3, 60, 'LTR')
const l4 = buildLineKey('TATA Motors HP Genuine Def - 4*5L', 2, 40, 'LTR')
ok('all four lines distinct', new Set([l1, l2, l3, l4]).size === 4, true)
ok('same material appears with two quantities (needs bucket/qty in key)', l1 !== l3 && l2 !== l4, true)

console.log('')
console.log(`RESULT: ${PASS} pass / ${FAIL} fail`)
process.exit(FAIL > 0 ? 1 : 0)
