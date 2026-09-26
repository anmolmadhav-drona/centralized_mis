// Excel export — reproduces the company's MIS workbook format:
//  - Sheet "MIS": row 1 TOTAL row, row 2 styled headers (#9FC5E8 / #240B55),
//    banded data rows (TableStyleMedium2 look), mm-dd-yy dates, original
//    column widths, autofilter, frozen header, and trailing
//    SYS_RECORD_ID / SYS_VERSION columns for lossless round-trip import.
//  - Sheet "Summary": LIVE pivot equivalent (Party → Destination → LR No,
//    Remarks 1 as columns, Sum of TOTAL QUANTITY IN LTRS) — computed from
//    the database, never a stale cache.
import ExcelJS from 'exceljs'
import type { FieldDef, MisRecordDto, SortItem, AgFilterModel } from '@/lib/types'
import { listRecords } from '@/lib/services/records-query'
import { TYPE_TRAITS } from '@/lib/services/fields'

const HEADER_FILL = 'FF9FC5E8' // company workbook header fill
const HEADER_TEXT = 'FF240B55' // company workbook header text
const BAND_FILL = 'FFEFF6FC'
const BORDER = 'FFD9D9D9'
const SYS_FILL = 'FFF2F2F2'


export interface ExportParams {
  fields: FieldDef[]
  search?: string
  filterModel?: AgFilterModel
  sortModel?: SortItem[]
  includeSummary?: boolean
}

async function fetchAllMatching(params: ExportParams, maxRows = 50_000): Promise<MisRecordDto[]> {
  const all: MisRecordDto[] = []
  const chunk = 500
  while (all.length < maxRows) {
    const { rows } = await listRecords({
      start: all.length,
      end: all.length + chunk,
      search: params.search,
      filterModel: params.filterModel,
      sortModel: params.sortModel,
    })
    all.push(...rows)
    if (rows.length < chunk) break
  }
  return all
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const edge = { style: 'thin' as const, color: { argb: BORDER } }
  return { top: edge, left: edge, bottom: edge, right: edge }
}

export async function buildExportWorkbook(params: ExportParams): Promise<ExcelJS.Buffer> {
  const { fields } = params
  // include ALL active fields in registry order (SR. NO. regenerated as 1..N)
  const dataFields = fields
  const records = await fetchAllMatching(params)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'NPL MIS Portal'
  wb.created = new Date()

  // ==========================================================
  // Sheet 1 — MIS
  // ==========================================================
  const ws = wb.addWorksheet('MIS', {
    views: [{
      state: 'frozen',
      ySplit: 2,
      topLeftCell: 'A3',
      activeCell: 'A3',
    }],
    // exceljs runtime supports sheetFormat (default row height) but its
    // typings omit it — spread through an untyped escape hatch
    ...({ sheetFormat: { defaultRowHeight: 16 } } as Record<string, unknown> as object),
  })

  const totalCols = dataFields.length
  const totalBucket = records.reduce((s, r) => s + (Number(r.bucket) || 0), 0)
  const totalQty = records.reduce((s, r) => s + (Number(r.totalQuantity) || 0), 0)

  // --- Row 1: TOTAL row (mirrors the workbook's SUBTOTAL row, above Bucket/Qty) ---
  const bucketIdx = dataFields.findIndex((f) => f.fieldKey === 'bucket') // 0-based col index
  const qtyIdx = dataFields.findIndex((f) => f.fieldKey === 'totalQuantity')
  const r1 = ws.getRow(1)
  if (bucketIdx >= 0) r1.getCell(bucketIdx).value = 'TOTAL=' // column J — above TRANSPOTER NAME, like the original
  if (bucketIdx >= 0) r1.getCell(bucketIdx + 1).value = totalBucket
  if (qtyIdx >= 0 && qtyIdx + 1 !== bucketIdx + 1) r1.getCell(qtyIdx + 1).value = totalQty
  r1.font = { bold: true, color: { argb: HEADER_TEXT }, size: 11 }
  r1.height = 18

  // --- Row 2: header row ---
  const headerRow = ws.getRow(2)
  dataFields.forEach((f, i) => {
    const cell = headerRow.getCell(i + 1)

    // Prefer the original Excel header, but never export a blank header.
    const headerText =
      String(f.fieldName ?? '').trim() ||
      String(f.displayName ?? '').trim() ||
      String(f.fieldKey ?? '').trim()

    cell.value = headerText

    cell.font = {
      bold: true,
      color: { argb: HEADER_TEXT },
      size: 10,
    }

    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL },
    }

    cell.border = thinBorder()

    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    }

    // Respect the configured field width, but make sure long headers
    // have enough room to render properly.
    const configuredWidth = Number(f.width) || 18
    const headerWidth = Math.ceil(headerText.length * 0.9) + 4

    ws.getColumn(i + 1).width = Math.min(
      40,
      Math.max(10, configuredWidth, headerWidth),
    )
  })
  headerRow.height = 36

  // --- data rows ---
  const dateNumFmt = 'mm-dd-yy'
  records.forEach((rec, ri) => {
    const row = ws.getRow(3 + ri)
    dataFields.forEach((f, i) => {
      const cell = row.getCell(i + 1)
      // SR. NO. — regenerated sequence 1..N (matches the workbook's formula column)
      if (f.isSystem && f.fieldKey === 'srNo') {
        cell.value = ri + 1
        cell.alignment = { horizontal: 'center' }
        cell.font = { size: 10 }
        if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_FILL } }
        cell.border = thinBorder()
        return
      }
      const raw = rec[f.fieldKey]
      const isDateTime = f.dataType === 'DATETIME'
      let v: string | number | boolean | Date | null
      if (raw == null || raw === '') {
        v = null
      } else if (TYPE_TRAITS[f.dataType].date) {
        // DATE → UTC midnight; DATETIME → full timestamp (lossless round-trip)
        if (raw instanceof Date) {
          v = raw
        } else if (isDateTime) {
          const d = new Date(String(raw))
          v = isNaN(d.getTime()) ? null : d
        } else {
          v = new Date(`${String(raw).slice(0, 10)}T00:00:00.000Z`)
        }
      } else if (raw instanceof Date) {
        v = raw
      } else {
        v = raw as string | number | boolean
      }
      // ---- formula cell? write the live Excel formula + cached result ----
      const formulaText = rec._formulas?.[f.fieldKey]
      if (formulaText && !f.isSystem) {
        // Export the calculated value only — never export the Excel formula.
        cell.value = v !== null && v !== undefined ? v : null
      } else if (v !== null && v !== undefined) {
        cell.value = v
      }
      if (TYPE_TRAITS[f.dataType].date) {
        cell.numFmt = isDateTime ? 'mm-dd-yy hh:mm' : dateNumFmt
        cell.alignment = { horizontal: 'center' }
      } else if (TYPE_TRAITS[f.dataType].numeric) {
        cell.alignment = { horizontal: 'right' }
      }
      cell.font = { size: 10 }
      if (ri % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_FILL } }
      }
      cell.border = thinBorder()
    })
    row.height = 16
  })

  // autofilter across the header (like the workbook's _FilterDatabase)
  if (records.length > 0) {
    ws.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2 + records.length, column: totalCols },
    }
  }

  // ==========================================================
  // Sheet 2 — Summary (LIVE pivot, never stale)
  // ==========================================================
  if (params.includeSummary) {
    const sum = wb.addWorksheet('Summary', {
      views: [{
        state: 'frozen',
        ySplit: 2,
        topLeftCell: 'A3',
        activeCell: 'A3',
      }],
    })

    // group by party → destination → LR No
    const groups = new Map<string, Map<string, Map<number, { qty: number; byRemark: Map<string, number> }>>>()
    for (const rec of records) {
      const party = String(rec.partyName ?? '(blank)')
      const dest = String(rec.destination ?? '(blank)')
      const lr = Number(rec.lrNo ?? 0)
      const qty = Number(rec.totalQuantity) || 0
      const remark = String(rec.remarks1 ?? '(blank)')
      let byDest = groups.get(party)
      if (!byDest) { byDest = new Map(); groups.set(party, byDest) }
      let byLr = byDest.get(dest)
      if (!byLr) { byLr = new Map(); byDest.set(dest, byLr) }
      let g = byLr.get(lr)
      if (!g) { g = { qty: 0, byRemark: new Map() }; byLr.set(lr, g) }
      g.qty += qty
      g.byRemark.set(remark, (g.byRemark.get(remark) || 0) + qty)
    }
    const remarkValues = [...new Set(records.map((r) => String(r.remarks1 ?? '(blank)')))].sort()

    // title row (like the original pivot title)
    sum.getCell(1, 1).value = 'Sum of TOTAL QUANTITY IN LTRS  (live — generated by NPL MIS Portal)'
    sum.getCell(1, 1).font = { bold: true, size: 11, color: { argb: HEADER_TEXT } }
    sum.mergeCells(1, 1, 1, 3 + remarkValues.length + 1)

    // header
    const hRow = sum.getRow(2)
    const headers = ['PARTY NAME', 'DESTINATION', 'LR. NO.', ...remarkValues, 'Grand Total']
    headers.forEach((h, i) => {
      const cell = hRow.getCell(i + 1)
      cell.value = h
      cell.font = { bold: true, size: 10, color: { argb: HEADER_TEXT } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
      cell.border = thinBorder()
    })
    sum.getColumn(1).width = 34
    sum.getColumn(2).width = 22
    sum.getColumn(3).width = 12
    for (let i = 4; i <= headers.length; i++) sum.getColumn(i).width = 15

    // data
    let rowIdx = 3
    const colTotals = new Array(remarkValues.length).fill(0)
    let grandTotal = 0
    const sortedParties = [...groups.keys()].sort((a, b) => a.localeCompare(b))
    for (const party of sortedParties) {
      const byDest = groups.get(party)!
      const sortedDests = [...byDest.keys()].sort((a, b) => a.localeCompare(b))
      for (const dest of sortedDests) {
        const byLr = byDest.get(dest)!
        const sortedLrs = [...byLr.keys()].sort((a, b) => a - b)
        for (const lr of sortedLrs) {
          const g = byLr.get(lr)!
          const row = sum.getRow(rowIdx)
          row.getCell(1).value = party
          row.getCell(2).value = dest
          row.getCell(3).value = lr || null
          remarkValues.forEach((rv, i) => {
            const v = g.byRemark.get(rv) || null
            row.getCell(4 + i).value = v
            if (v) colTotals[i] += v
          })
          row.getCell(4 + remarkValues.length).value = g.qty
          grandTotal += g.qty
          for (let c = 1; c <= headers.length; c++) {
            const cell = row.getCell(c)
            cell.font = { size: 10 }
            cell.border = thinBorder()
            if (c >= 4) cell.alignment = { horizontal: 'right' }
            if (rowIdx % 2 === 1) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_FILL } }
            }
          }
          rowIdx++
        }
      }
    }
    // grand total row
    const gtRow = sum.getRow(rowIdx)
    gtRow.getCell(1).value = 'Grand Total'
    gtRow.getCell(1).font = { bold: true, size: 10 }
    remarkValues.forEach((_, i) => { gtRow.getCell(4 + i).value = colTotals[i] || null })
    gtRow.getCell(4 + remarkValues.length).value = grandTotal
    for (let c = 1; c <= headers.length; c++) {
      const cell = gtRow.getCell(c)
      cell.font = { bold: true, size: 10 }
      cell.border = thinBorder()
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } }
      if (c >= 4) cell.alignment = { horizontal: 'right' }
    }
  }

  return wb.xlsx.writeBuffer()
}
