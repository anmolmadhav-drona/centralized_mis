// Generic Excel export for in-app sheets. The workbook is derived entirely
// from the sheet's SheetColumn metadata (order / display names / types) and its
// SheetRecord data — no per-sheet code. NPL is exported by the main /api/export.
import ExcelJS from 'exceljs'
import { ApiError } from '@/lib/api'
import { getSheetWithColumns, listSheetRecords } from '@/lib/services/sheets'

const HEADER_FILL = 'FF9FC5E8'
const HEADER_TEXT = 'FF240B55'

export async function buildSheetWorkbook(sheetId: string): Promise<{ buffer: ArrayBuffer; fileName: string }> {
  const { sheet, columns } = await getSheetWithColumns(sheetId)
  if (sheet.isSystem) {
    throw new ApiError(400, 'Use the full MIS export for the NPL sheet.')
  }
  const records = await listSheetRecords(sheetId)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'NPL MIS Portal'
  wb.created = new Date()
  const ws = wb.addWorksheet(sheet.name.slice(0, 31) || 'Sheet', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  // Sr. No. is display-only (generated here), never a stored business field.
  ws.columns = [
    { header: 'Sr. No.', key: '__srno', width: 8 },
    ...columns.map((c) => ({ header: c.displayName, key: c.fieldKey, width: c.width ?? 20 })),
  ]

  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  ws.getRow(1).height = 26

  const numericTypes = new Set(['INTEGER', 'DECIMAL'])
  records.forEach((r, i) => {
    const row: Record<string, unknown> = { __srno: i + 1 }
    for (const c of columns) {
      const v = r.data[c.fieldKey]
      row[c.fieldKey] = v ?? null
    }
    const added = ws.addRow(row)
    // right-align numeric columns for readability
    columns.forEach((c, ci) => {
      if (numericTypes.has(c.dataType)) added.getCell(ci + 2).alignment = { horizontal: 'right' }
    })
  })

  if (records.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + records.length, column: columns.length + 1 } }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const safe = sheet.name.replace(/[^A-Za-z0-9_-]+/g, '_')
  return { buffer: buffer as ArrayBuffer, fileName: `${safe || 'sheet'}.xlsx` }
}
