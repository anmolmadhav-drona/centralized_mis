// ExcelGridController — spreadsheet interaction layer on top of AG Grid
// Community (which ships no range selection / clipboard / fill handle).
//
// Implemented exactly like Excel:
//   • drag over cells to select a range; Shift+Click / Shift+Arrows extend;
//     Ctrl+A selects the rendered block
//   • Ctrl+C / Ctrl+X / Ctrl+V — TSV clipboard, multi-cell paste FROM Excel
//     (formulas preserved for internal paste, like Excel)
//   • fill handle (small square at the selection's bottom-right): drag to
//     fill down / right — copies cells & formulas, continues numeric series
//   • Ctrl+D fill-down, Ctrl+R fill-right, Delete/Backspace clears the range
//   • Ctrl+Z / Ctrl+Y undo & redo via inverse bulk operations
//
// All mutations flow through ONE bulk endpoint (POST /api/records/bulk) with
// per-record optimistic-version guards; rows update in place (no reload, no
// scroll jump) and the undo stack is session-scoped.
import type { GridApi } from 'ag-grid-community'
import type { FieldDef, MisRecordDto } from '@/lib/types'
import { buildTsv, parseTsv, fillSeries, normalizeDateToken, type ClipCell } from '@/lib/client/clipboard'

export interface CellPos {
  rowIndex: number
  colId: string
}

export interface CellOp {
  recordId: string
  version: number
  values?: Record<string, unknown>
  formulas?: Record<string, string | null>
}

export interface BulkResultItem {
  id: string
  ok: boolean
  record?: MisRecordDto
  conflict?: MisRecordDto
  error?: string
}

export type BulkFn = (ops: CellOp[], label: string) => Promise<BulkResultItem[]>
export type NotifyFn = (message: string, description?: string) => void

export interface ExcelGridDeps {
  api: () => GridApi | null
  host: () => HTMLElement | null
  fields: () => FieldDef[]
  canEdit: () => boolean
  bulk: BulkFn
  notify?: NotifyFn
  onInfo?: (info: string | null) => void
}

interface HistoryEntry {
  label: string
  undoOps: CellOp[]
  redoOps: CellOp[]
}

interface PreState {
  id: string
  version: number
  cells: Record<string, { value: unknown; formula: string | null }>
}

interface RectRange {
  r1: number
  c1: number
  r2: number
  c2: number
}

const EDITABLE_TYPES = new Set(['TEXT', 'LONG_TEXT', 'INTEGER', 'DECIMAL', 'DROPDOWN', 'BOOLEAN'])
const FORMULA_CAPABLE = new Set(['TEXT', 'LONG_TEXT', 'INTEGER', 'DECIMAL'])
const UNDO_CAP = 50

interface SrcCell {
  raw: string
  formula?: string
}

export class ExcelGridController {
  private deps: ExcelGridDeps
  private range: { anchor: CellPos; focus: CellPos } | null = null
  private mode: 'idle' | 'selecting' | 'filling' = 'idle'
  private lastPointer: { x: number; y: number } | null = null
  private ghost: RectRange | null = null
  private fillSel: RectRange | null = null
  private fillGhost: RectRange | null = null
  private raf = 0
  private pendingFocusSync = false
  private clip: { rows: ClipCell[][]; tsv: string } | null = null
  private cutPending: PreState[] | null = null
  private cutRange: RectRange | null = null
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private colsCache: string[] | null = null
  /** last batch sent (debug/test surface) */
  private lastOps: CellOp[] = []
  private lastGhost: RectRange | null = null
  private copyEventCount = 0
  private trace: string[] = []

  private log(msg: string) {
    if (this.trace.length < 200) this.trace.push(`${Date.now() % 100000}: ${msg}`)
  }

  // overlay DOM
  private overlay: HTMLDivElement | null = null
  private fillEl: HTMLDivElement | null = null
  private borderEl: HTMLDivElement | null = null
  private handleEl: HTMLDivElement | null = null
  private ghostEl: HTMLDivElement | null = null
  private cutEl: HTMLDivElement | null = null

  private detachApi: (() => void) | null = null
  private disposed = false

  constructor(deps: ExcelGridDeps) {
    this.deps = deps
  }

  // ------------------------------------------------------------------
  // lifecycle
  // ------------------------------------------------------------------
  attach() {
    const host = this.deps.host()
    if (!host || this.overlay?.isConnected) return
    host.classList.add('excel-host')
    this.buildOverlay(host)

    host.addEventListener('mousedown', this.onMouseDown, true)
    host.addEventListener('keydown', this.onKeyDown, true)
    host.addEventListener('copy', this.onCopyEvent as EventListener)
    host.addEventListener('cut', this.onCutEvent as EventListener)
    host.addEventListener('paste', this.onPasteEvent as EventListener)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('mouseup', this.onMouseUp)

    const api = this.deps.api()
    if (api) this.hookApi(api)

    ;(window as unknown as Record<string, unknown>).__misExcel = this
  }

  destroy() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    const host = this.deps.host()
    if (host) {
      host.removeEventListener('mousedown', this.onMouseDown, true)
      host.removeEventListener('keydown', this.onKeyDown, true)
      host.removeEventListener('copy', this.onCopyEvent as EventListener)
      host.removeEventListener('cut', this.onCutEvent as EventListener)
      host.removeEventListener('paste', this.onPasteEvent as EventListener)
    }
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('mouseup', this.onMouseUp)
    this.detachApi?.()
    this.overlay?.remove()
    this.overlay = null
    if ((window as unknown as Record<string, unknown>).__misExcel === this) {
      delete (window as unknown as Record<string, unknown>).__misExcel
    }
  }

  /** (re)bind when the grid api becomes available (grid ready) */
  hookApi(api: GridApi) {
    if (this.disposed) return
    this.detachApi?.()
    this.colsCache = null
    const invalidate = () => { this.colsCache = null; this.redraw() }
    const events = ['bodyScroll', 'modelUpdated', 'displayedColumnsChanged', 'columnResized', 'columnMoved', 'columnVisible', 'gridSizeChanged'] as const
    for (const ev of events) {
      try { api.addEventListener(ev, invalidate) } catch { /* guard older builds */ }
    }
    api.addEventListener('cellFocused', this.onCellFocused)
    this.detachApi = () => {
      for (const ev of events) {
        try { api.removeEventListener(ev, invalidate) } catch { /* ignore */ }
      }
      api.removeEventListener('cellFocused', this.onCellFocused)
    }
  }

  private buildOverlay(host: HTMLElement) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'excel-overlay'
    this.fillEl = document.createElement('div')
    this.fillEl.className = 'excel-range-fill'
    this.borderEl = document.createElement('div')
    this.borderEl.className = 'excel-range-border'
    this.ghostEl = document.createElement('div')
    this.ghostEl.className = 'excel-ghost-fill'
    this.cutEl = document.createElement('div')
    this.cutEl.className = 'excel-cut-border'
    this.handleEl = document.createElement('div')
    this.handleEl.className = 'excel-fill-handle'
    this.handleEl.title = 'Drag to fill — copies cells and formulas, continues number series'
    this.handleEl.addEventListener('mousedown', this.onHandleMouseDown)
    this.overlay.append(this.fillEl, this.borderEl, this.ghostEl, this.cutEl, this.handleEl)
    host.appendChild(this.overlay)
  }

  // ------------------------------------------------------------------
  // coordinate helpers
  // ------------------------------------------------------------------
  private api(): GridApi | null { return this.deps.api() }
  private host(): HTMLElement | null { return this.deps.host() }

  private displayedCols(): string[] {
    if (this.colsCache) return this.colsCache
    const api = this.api()
    if (!api) return []
    try {
      this.colsCache = api.getAllDisplayedColumns().map((c) => c.getId())
      return this.colsCache
    } catch {
      return []
    }
  }

  private cellEl(rowIndex: number, colId: string): HTMLElement | null {
    const host = this.host()
    if (!host) return null
    // AG Grid v36: `row-index` lives on the .ag-row wrapper, `col-id` on the cell
    return host.querySelector(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`)
  }

  private posFromPoint(x: number, y: number): CellPos | null {
    const host = this.host()
    if (!host) return null
    const el = document.elementFromPoint(x, y)?.closest('.ag-cell') as HTMLElement | null
    if (!el || !host.contains(el)) return null
    const colId = el.getAttribute('col-id')
    const row = el.closest('.ag-row') as HTMLElement | null
    const rowIndex = Number(row?.getAttribute('row-index'))
    if (!colId || !row || !Number.isInteger(rowIndex)) return null
    return { rowIndex, colId }
  }

  private nodeAt(rowIndex: number): MisRecordDto | null {
    const api = this.api()
    if (!api) return null
    try {
      for (const n of api.getRenderedNodes()) {
        if (n.rowIndex === rowIndex && n.data) return n.data as MisRecordDto
      }
    } catch { /* ignore */ }
    return null
  }

  private fieldOf(colId: string): FieldDef | null {
    return this.deps.fields().find((f) => f.fieldKey === colId) ?? null
  }

  private isEditableCol(colId: string): boolean {
    const f = this.fieldOf(colId)
    return !!f && !f.isSystem && !!f.active && EDITABLE_TYPES.has(f.dataType) && this.deps.canEdit()
  }

  private isFormulaCapable(colId: string): boolean {
    const f = this.fieldOf(colId)
    return !!f && FORMULA_CAPABLE.has(f.dataType)
  }

  // ------------------------------------------------------------------
  // range helpers
  // ------------------------------------------------------------------
  /** normalized rect { r1<=r2, c1<=c2 } in display coordinates, or null */
  private norm(): RectRange | null {
    if (!this.range) return null
    const cols = this.displayedCols()
    const a = this.range.anchor
    const f = this.range.focus
    let c1 = cols.indexOf(a.colId)
    let c2 = cols.indexOf(f.colId)
    if (c1 === -1 && c2 === -1) return null
    if (c1 === -1) c1 = c2
    if (c2 === -1) c2 = c1
    return {
      r1: Math.min(a.rowIndex, f.rowIndex),
      r2: Math.max(a.rowIndex, f.rowIndex),
      c1: Math.min(c1, c2),
      c2: Math.max(c1, c2),
    }
  }

  private hasSelection(): boolean {
    return this.norm() !== null
  }

  private info() {
    const n = this.norm()
    if (!n || !this.deps.onInfo) return
    const rows = n.r2 - n.r1 + 1
    const cols = n.c2 - n.c1 + 1
    this.deps.onInfo(rows === 1 && cols === 1 ? null : `${rows} × ${cols} cells selected (${rows * cols})`)
  }

  // ------------------------------------------------------------------
  // overlay drawing
  // ------------------------------------------------------------------
  redraw() {
    if (this.disposed || !this.overlay?.isConnected) return
    const host = this.host()
    if (!host) return
    const hostRect = host.getBoundingClientRect()
    const vp = host.querySelector('.ag-body-viewport') as HTMLElement | null
    const vpRect = vp ? vp.getBoundingClientRect() : hostRect

    const set = (el: HTMLElement | null, l: number, t: number, w: number, h: number, visible: boolean) => {
      if (!el) return
      el.style.display = visible ? 'block' : 'none'
      if (!visible) return
      el.style.left = `${l - hostRect.left}px`
      el.style.top = `${t - hostRect.top}px`
      el.style.width = `${Math.max(0, w)}px`
      el.style.height = `${Math.max(0, h)}px`
    }

    // ---- active selection ----
    const n = this.norm()
    if (!n) {
      set(this.fillEl, 0, 0, 0, 0, false)
      set(this.borderEl, 0, 0, 0, 0, false)
      set(this.handleEl, 0, 0, 0, 0, false)
    } else {
      const cols = this.displayedCols()
      const tl = this.cellEl(n.r1, cols[n.c1])
      const br = this.cellEl(n.r2, cols[n.c2])
      const left = tl ? tl.getBoundingClientRect().left : vpRect.left
      const top = tl ? tl.getBoundingClientRect().top : vpRect.top
      const right = br ? br.getBoundingClientRect().right : vpRect.right
      const bottom = br ? br.getBoundingClientRect().bottom : vpRect.bottom
      set(this.fillEl, left, top, right - left, bottom - top, true)
      set(this.borderEl, left, top, right - left, bottom - top, true)
      const handleVisible = this.deps.canEdit() && this.mode === 'idle'
      set(this.handleEl, right - 7, bottom - 7, 14, 14, handleVisible)
    }

    // ---- fill ghost ----
    if (this.ghost && this.mode === 'filling') {
      const cols = this.displayedCols()
      const tl = this.cellEl(this.ghost.r1, cols[this.ghost.c1])
      const br = this.cellEl(this.ghost.r2, cols[this.ghost.c2])
      const left = tl ? tl.getBoundingClientRect().left : vpRect.left
      const top = tl ? tl.getBoundingClientRect().top : vpRect.top
      const right = br ? br.getBoundingClientRect().right : vpRect.right
      const bottom = br ? br.getBoundingClientRect().bottom : vpRect.bottom
      set(this.ghostEl, left, top, right - left, bottom - top, true)
    } else {
      set(this.ghostEl, 0, 0, 0, 0, false)
    }

    // ---- cut-mode dashed border ----
    if (this.cutRange) {
      const cols = this.displayedCols()
      const tl = this.cellEl(this.cutRange.r1, cols[this.cutRange.c1])
      const br = this.cellEl(this.cutRange.r2, cols[this.cutRange.c2])
      if (tl && br) {
        const a = tl.getBoundingClientRect()
        const b = br.getBoundingClientRect()
        set(this.cutEl, a.left, a.top, b.right - a.left, b.bottom - a.top, true)
      } else {
        set(this.cutEl, 0, 0, 0, 0, false)
      }
    } else {
      set(this.cutEl, 0, 0, 0, 0, false)
    }
  }

  // ------------------------------------------------------------------
  // mouse: range selection
  // ------------------------------------------------------------------
  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    const api = this.api()
    if (api && api.getEditingCells && api.getEditingCells().length > 0) { this.log('mousedown ignored (editor open)'); return }
    const pos = this.posFromPoint(e.clientX, e.clientY)
    this.log(`mousedown (${e.clientX},${e.clientY}) → ${pos ? `${pos.rowIndex},${pos.colId}` : 'null'} shift=${e.shiftKey}`)
    if (!pos) return
    if (e.shiftKey && this.range) {
      this.range = { anchor: this.range.anchor, focus: pos }
    } else {
      this.range = { anchor: pos, focus: pos }
      // NOTE: a plain click does NOT cancel cut mode (Excel keeps the
      // marching-ants until paste / Esc / a new copy)
    }
    this.mode = 'selecting'
    this.lastPointer = { x: e.clientX, y: e.clientY }
    this.startAutoscroll()
    this.info()
    this.redraw()
  }

  private onMouseMove = (e: MouseEvent) => {
    if (this.mode === 'idle') return
    this.lastPointer = { x: e.clientX, y: e.clientY }
    const pos = this.posFromPoint(e.clientX, e.clientY)
    if (!pos) return
    if (this.mode === 'selecting' && this.range) {
      if (pos.rowIndex !== this.range.focus.rowIndex || pos.colId !== this.range.focus.colId) {
        this.log(`mousemove extend → ${pos.rowIndex},${pos.colId}`)
        this.range = { anchor: this.range.anchor, focus: pos }
        this.info()
        this.redraw()
      }
    } else if (this.mode === 'filling' && this.fillSel) {
      const cols = this.displayedCols()
      const ci = cols.indexOf(pos.colId)
      if (ci !== -1) {
        const sel = this.fillSel
        // fill extends only right/down from the selection (Excel corner drag)
        this.ghost = {
          r1: sel.r1,
          c1: sel.c1,
          r2: Math.max(sel.r2, pos.rowIndex),
          c2: Math.max(sel.c2, ci),
        }
        this.redraw()
      }
    }
  }

  private onMouseUp = () => {
    this.log(`mouseup mode=${this.mode} range=${JSON.stringify(this.norm())}`)
    if (this.mode === 'filling') {
      const sel = this.fillSel
      const ghost = this.ghost
      this.mode = 'idle'
      this.stopAutoscroll()
      this.fillSel = null
      this.ghost = null
      if (sel && ghost) void this.applyFill(sel, ghost)
    } else if (this.mode === 'selecting') {
      this.mode = 'idle'
      this.stopAutoscroll()
      this.pendingFocusSync = true
      setTimeout(() => { this.pendingFocusSync = false }, 150)
    }
    this.redraw()
  }

  /** AG Grid moved the cell focus (click / arrow keys) — track like Excel:
   *  plain focus moves collapse the selection to the focused cell. */
  private onCellFocused = () => {
    if (this.mode !== 'idle' || this.pendingFocusSync) { this.log(`cellFocused skipped (mode=${this.mode}, pending=${this.pendingFocusSync})`); return }
    const api = this.api()
    if (!api) return
    try {
      if (api.getEditingCells && api.getEditingCells().length > 0) return
      const focused = api.getFocusedCell()
      if (!focused) return
      const colId = typeof focused.column === 'string'
        ? focused.column
        : focused.column?.getId?.() ?? (focused.column as unknown as { colId?: string })?.colId
      if (!colId) return
      this.log(`cellFocused collapse → ${focused.rowIndex},${colId}`)
      if (this.range && this.range.focus.rowIndex === focused.rowIndex && this.range.focus.colId === colId) return
      this.range = { anchor: { rowIndex: focused.rowIndex, colId }, focus: { rowIndex: focused.rowIndex, colId } }
      this.info()
      this.redraw()
    } catch { /* focus API variance */ }
  }

  // ------------------------------------------------------------------
  // mouse: fill handle
  // ------------------------------------------------------------------
  private onHandleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    const n = this.norm()
    if (!n) return
    e.preventDefault()
    e.stopPropagation()
    this.fillSel = { ...n }
    this.mode = 'filling'
    this.lastPointer = { x: e.clientX, y: e.clientY }
    this.ghost = { ...n }
    this.startAutoscroll()
    this.redraw()
  }

  private async applyFill(sel: RectRange, ghost: RectRange) {
    const cols = this.displayedCols()
    this.lastGhost = ghost
    const target: { row: number; col: number }[] = []
    for (let r = sel.r1; r <= ghost.r2; r++) {
      for (let c = sel.c1; c <= ghost.c2; c++) {
        if (r <= sel.r2 && c <= sel.c2) continue // source block
        target.push({ row: r, col: c })
      }
    }
    if (target.length === 0 || !this.deps.canEdit()) return

    const verticalOnly = ghost.c2 === sel.c2
    const horizontalOnly = ghost.r2 === sel.r2
    const rowsFilled = ghost.r2 - sel.r2
    const colsFilled = ghost.c2 - sel.c2

    // source tokens per column (vertical fill) and per row (horizontal fill)
    const srcByCol: SrcCell[][] = []
    for (let c = sel.c1; c <= sel.c2; c++) {
      const colCells: SrcCell[] = []
      for (let r = sel.r1; r <= sel.r2; r++) colCells.push(this.sourceCell(r, cols[c]))
      srcByCol.push(colCells)
    }
    const srcByRow: SrcCell[][] = []
    for (let r = sel.r1; r <= sel.r2; r++) {
      const rowCells: SrcCell[] = []
      for (let c = sel.c1; c <= sel.c2; c++) rowCells.push(this.sourceCell(r, cols[c]))
      srcByRow.push(rowCells)
    }

    const { ops, pre } = this.newOpBuilder()
    for (const t of target) {
      const colId = cols[t.col]
      const rec = this.nodeAt(t.row)
      if (!colId || !rec) continue
      if (!this.isEditableCol(colId)) continue
      let src: SrcCell | null = null
      if (verticalOnly) {
        // per-column series for values; formulas tile
        const series = srcByCol[t.col - sel.c1]
        const s = series[(t.row - sel.r1) % Math.max(1, series.length)]
        if (s?.formula) {
          src = { raw: s.formula, formula: s.formula }
        } else {
          const filled = fillSeries(series.map((x) => x.raw), rowsFilled)
          src = { raw: filled[t.row - sel.r2 - 1] ?? series[0]?.raw ?? '' }
        }
      } else if (horizontalOnly) {
        // per-row series for values; formulas tile
        const series = srcByRow[t.row - sel.r1]
        const s = series[(t.col - sel.c1) % Math.max(1, series.length)]
        if (s?.formula) {
          src = { raw: s.formula, formula: s.formula }
        } else {
          const filled = fillSeries(series.map((x) => x.raw), colsFilled)
          src = { raw: filled[t.col - sel.c2 - 1] ?? series[0]?.raw ?? '' }
        }
      } else {
        // rectangular fill — plain tiling (copy; formulas copy as formulas)
        const s = this.sourceCell(
          sel.r1 + ((t.row - sel.r1) % (sel.r2 - sel.r1 + 1)),
          cols[sel.c1 + ((t.col - sel.c1) % (sel.c2 - sel.c1 + 1))],
        )
        src = s ? { raw: s.formula ?? s.raw, formula: s.formula } : null
      }
      if (!src) continue
      this.pushCellOp(ops, pre, rec, colId, src.raw, !!src.formula)
    }
    await this.runOps(ops, pre, 'Fill')

    // select the filled block (Excel behaviour)
    this.range = {
      anchor: { rowIndex: sel.r1, colId: cols[sel.c1] },
      focus: { rowIndex: ghost.r2, colId: cols[ghost.c2] },
    }
    this.info()
    this.redraw()
  }

  /** read one cell as a fill/copy source: value token + optional formula */
  private sourceCell(row: number, colId: string): SrcCell {
    const rec = this.nodeAt(row)
    if (!rec || !colId) return { raw: '' }
    const formula = rec._formulas?.[colId]
    const v = rec[colId]
    const raw = v == null ? '' : String(v)
    return formula ? { raw, formula } : { raw }
  }

  // ------------------------------------------------------------------
  // autoscroll during drags
  // ------------------------------------------------------------------
  private startAutoscroll() {
    if (this.raf) return
    const tick = () => {
      if (this.mode === 'idle' || !this.lastPointer) { this.raf = 0; return }
      const host = this.host()
      if (!host) { this.raf = 0; return }
      const vp = host.querySelector('.ag-body-viewport') as HTMLElement | null
      const hv = host.querySelector('.ag-body-horizontal-scroll-viewport') as HTMLElement | null
      let scrolled = false
      if (vp) {
        const rect = vp.getBoundingClientRect()
        const m = 38
        if (this.lastPointer.y < rect.top + m) { vp.scrollTop -= 16; scrolled = true }
        else if (this.lastPointer.y > rect.bottom - m) { vp.scrollTop += 16; scrolled = true }
      }
      // horizontal autoscroll ONLY for range selection — during a fill drag it
      // would shift content under the stationary pointer and silently extend
      // the fill into neighbouring columns (reproduced & disabled on purpose)
      if (hv && this.mode === 'selecting') {
        const rect = hv.getBoundingClientRect()
        const m = 38
        if (this.lastPointer.x < rect.left + m) { hv.scrollLeft -= 16; scrolled = true }
        else if (this.lastPointer.x > rect.right - m) { hv.scrollLeft += 16; scrolled = true }
      }
      if (scrolled) {
        const pos = this.posFromPoint(this.lastPointer.x, this.lastPointer.y)
        if (pos) this.onMouseMove({ clientX: this.lastPointer.x, clientY: this.lastPointer.y } as MouseEvent)
      }
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  private stopAutoscroll() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  // ------------------------------------------------------------------
  // keyboard
  // ------------------------------------------------------------------
  private onKeyDown = (e: KeyboardEvent) => {
    const key = e.key
    const mod = e.ctrlKey || e.metaKey
    const api = this.api()
    if (!api) return

    // never hijack keys meant for inputs (floating filters / formula bar)
    const t = e.target as HTMLElement | null
    if (t && t !== e.currentTarget && t.closest('input, textarea, select, [contenteditable="true"]')) return
    // let open cell editors handle their own keys
    if (api.getEditingCells && api.getEditingCells().length > 0) return

    // ---- undo / redo (work without a selection) ----
    if (mod && (key === 'z' || key === 'Z')) {
      e.preventDefault(); e.stopPropagation()
      if (e.shiftKey) void this.redo()
      else void this.undo()
      return
    }
    if (mod && (key === 'y' || key === 'Y')) {
      e.preventDefault(); e.stopPropagation()
      void this.redo()
      return
    }

    // ---- Ctrl+A works even before any selection exists ----
    if (mod && (key === 'a' || key === 'A') && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation()
      this.selectAll()
      return
    }

    if (!this.hasSelection()) return

    // ---- clipboard (Ctrl+V is delivered by the native paste event) ----
    if (mod && (key === 'c' || key === 'C')) {
      this.prepareCopy() // best-effort write; the copy event is authoritative
      return
    }
    if (mod && (key === 'x' || key === 'X')) {
      this.prepareCopy(true)
      return
    }

    // ---- range edits ----
    if (mod && (key === 'd' || key === 'D')) {
      e.preventDefault(); e.stopPropagation()
      void this.fillDown()
      return
    }
    if (mod && (key === 'r' || key === 'R')) {
      e.preventDefault(); e.stopPropagation()
      void this.fillRight()
      return
    }
    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault(); e.stopPropagation()
      void this.clearRange()
      return
    }
    if (key === 'Escape') {
      if (this.cutRange || this.cutPending) {
        e.preventDefault(); e.stopPropagation()
        this.cancelCut()
        this.redraw()
      }
      return
    }

    // ---- range extension (Shift+Arrows, Shift+Home/End) ----
    if (e.shiftKey && (key.startsWith('Arrow') || key === 'Home' || key === 'End')) {
      const n = this.norm()
      if (!n || !this.range) return
      e.preventDefault(); e.stopPropagation()
      const cols = this.displayedCols()
      let { rowIndex } = this.range.focus
      const { colId } = this.range.focus
      let ci = cols.indexOf(colId)
      if (mod && key.startsWith('Arrow')) {
        // Ctrl+Shift+Arrow → extend to the edge
        if (key === 'ArrowUp') rowIndex = this.firstRenderedRow()
        if (key === 'ArrowDown') rowIndex = this.lastRenderedRow()
        if (key === 'ArrowLeft') ci = 0
        if (key === 'ArrowRight') ci = cols.length - 1
      } else {
        switch (key) {
          case 'ArrowUp': rowIndex = Math.max(0, rowIndex - 1); break
          case 'ArrowDown': rowIndex = rowIndex + 1; break
          case 'ArrowLeft': ci = Math.max(0, ci - 1); break
          case 'ArrowRight': ci = Math.min(cols.length - 1, ci + 1); break
          case 'Home': ci = 0; if (mod) rowIndex = this.firstRenderedRow(); break
          case 'End': ci = cols.length - 1; if (mod) rowIndex = this.lastRenderedRow(); break
        }
      }
      ci = Math.max(0, Math.min(cols.length - 1, ci))
      const nextCol = cols[ci] ?? colId
      this.range = { anchor: this.range.anchor, focus: { rowIndex, colId: nextCol } }
      this.ensureVisible(rowIndex, nextCol)
      this.info()
      this.redraw()
    }
  }

  private firstRenderedRow(): number {
    const api = this.api()
    let min: number | null = null
    try {
      for (const n of api?.getRenderedNodes() ?? []) {
        if (n.rowIndex != null && (min === null || n.rowIndex < min)) min = n.rowIndex
      }
    } catch { /* ignore */ }
    return min ?? 0
  }

  private lastRenderedRow(): number {
    const api = this.api()
    let max = 0
    try {
      for (const n of api?.getRenderedNodes() ?? []) {
        if (n.rowIndex != null && n.rowIndex > max) max = n.rowIndex
      }
    } catch { /* ignore */ }
    return max
  }

  private ensureVisible(rowIndex: number, colId: string) {
    const api = this.api()
    if (!api) return
    try {
      api.ensureIndexVisible(rowIndex)
      api.ensureColumnVisible(colId)
    } catch { /* ignore */ }
  }

  // ------------------------------------------------------------------
  // clipboard: copy / cut / paste
  // ------------------------------------------------------------------
  private prepareCopy(isCut = false): string | null {
    const n = this.norm()
    if (!n) return null
    const cols = this.displayedCols()
    const rows: ClipCell[][] = []
    for (let r = n.r1; r <= n.r2; r++) {
      const row: ClipCell[] = []
      for (let c = n.c1; c <= n.c2; c++) {
        const s = this.sourceCell(r, cols[c])
        row.push({ text: s.raw, formula: s.formula })
      }
      rows.push(row)
    }
    const tsv = buildTsv(rows)
    this.clip = { rows, tsv }
    // best-effort write to the system clipboard (also set by the copy event)
    try { void navigator.clipboard?.writeText(tsv).catch(() => undefined) } catch { /* ignore */ }
    if (isCut) {
      this.cutRange = { ...n }
      this.cutPending = this.captureRangePreState(n)
    } else {
      this.cancelCut()
    }
    this.redraw()
    return tsv
  }

  private onCopyEvent = (e: ClipboardEvent) => {
    this.copyEventCount++
    this.log(`copy event (hasSelection=${this.hasSelection()})`)
    if (!this.hasSelection()) return
    const t = e.target as HTMLElement | null
    if (t && t.closest('input, textarea, select, [contenteditable="true"]')) return
    const tsv = this.prepareCopy()
    if (tsv && e.clipboardData) {
      e.clipboardData.setData('text/plain', tsv)
      e.preventDefault()
    }
  }

  private onCutEvent = (e: ClipboardEvent) => {
    if (!this.hasSelection()) return
    const t = e.target as HTMLElement | null
    if (t && t.closest('input, textarea, select, [contenteditable="true"]')) return
    const tsv = this.prepareCopy(true)
    if (tsv && e.clipboardData) {
      e.clipboardData.setData('text/plain', tsv)
      e.preventDefault()
    }
  }

  private onPasteEvent = (e: ClipboardEvent) => {
    this.log(`paste event (hasSelection=${this.hasSelection()})`)
    if (!this.hasSelection()) return
    const t = e.target as HTMLElement | null
    if (t && t.closest('input, textarea, select, [contenteditable="true"]')) return
    const text = e.clipboardData?.getData('text/plain')
    if (!text) return
    e.preventDefault()
    void this.pasteText(text)
  }

  /** paste a TSV block (internal paste keeps formulas) */
  async pasteText(text: string) {
    this.log(`pasteText (${JSON.stringify(text).slice(0, 60)}) canEdit=${this.deps.canEdit()}`)
    if (!this.deps.canEdit()) return
    let n = this.norm()
    if (!n) {
      // paste at the focused cell even when no explicit selection exists yet
      const api = this.api()
      const focused = api?.getFocusedCell?.()
      const cols = this.displayedCols()
      const colId = focused
        ? (typeof focused.column === 'string' ? focused.column : focused.column?.getId?.() ?? undefined)
        : undefined
      if (!focused || !colId || !cols.includes(colId)) return
      this.range = { anchor: { rowIndex: focused.rowIndex, colId }, focus: { rowIndex: focused.rowIndex, colId } }
      n = this.norm()
      if (!n) return
    }

    // decide internal vs external: identical TSV → reuse internal formulas
    const internal = this.clip && this.clip.tsv === text ? this.clip : null
    const rawGrid = internal ? internal.rows.map((r) => r.map((c) => c.formula ?? c.text)) : parseTsv(text)
    if (rawGrid.length === 0 || rawGrid.some((r) => r.length === 0)) return

    // paste target: single-cell selection → full block; multi-cell → tile
    // inside the selection (Excel / Google-Sheets compatible)
    const selRows = n.r2 - n.r1 + 1
    const selCols = n.c2 - n.c1 + 1
    const cols = this.displayedCols()
    let rows = rawGrid.length
    let ccols = Math.max(...rawGrid.map((r) => r.length))
    if (selRows > 1 || selCols > 1) {
      rows = selRows
      ccols = selCols
    }

    const { ops, pre } = this.newOpBuilder()
    for (let dr = 0; dr < rows; dr++) {
      for (let dc = 0; dc < ccols; dc++) {
        const r = n.r1 + dr
        const colId = cols[n.c1 + dc]
        const rec = this.nodeAt(r)
        if (!rec || !colId) continue
        if (!this.isEditableCol(colId)) continue
        const srcRow = rawGrid[dr % rawGrid.length]
        const raw = srcRow[dc % srcRow.length] ?? ''
        this.pushCellOp(ops, pre, rec, colId, raw, raw.trim().startsWith('='))
      }
    }

    // Ctrl+X then Ctrl+V = MOVE: clear the source in the same batch/undo step
    const cutPre = this.cutPending
    this.cutPending = null
    this.cutRange = null
    if (cutPre) {
      for (const ps of cutPre) {
        let op = ops.find((o) => o.recordId === ps.id)
        if (!op) {
          op = { recordId: ps.id, version: ps.version, values: {}, formulas: {} }
          ops.push(op)
        }
        for (const [f] of Object.entries(ps.cells)) {
          op.values![f] = null // cut-clear wins on overlap (simple, predictable)
          op.formulas![f] = null
        }
      }
    }

    await this.runOps(ops, pre, cutPre ? 'Move' : 'Paste')

    // select what was pasted
    this.range = {
      anchor: { rowIndex: n.r1, colId: cols[n.c1] },
      focus: { rowIndex: n.r1 + rows - 1, colId: cols[Math.min(cols.length - 1, n.c1 + ccols - 1)] },
    }
    this.info()
    this.redraw()
  }

  private cancelCut() {
    this.cutPending = null
    this.cutRange = null
    if (this.cutEl) this.cutEl.style.display = 'none'
  }

  // ------------------------------------------------------------------
  // fill down / fill right / clear
  // ------------------------------------------------------------------
  async fillDown() {
    const n = this.norm()
    if (!n || !this.deps.canEdit()) return
    const cols = this.displayedCols()
    // Excel semantics: multi-row selection → top row fills the rest;
    // single-row selection → the row ABOVE fills into the selection
    let srcR = n.r1
    let dstR1 = n.r1 + 1
    let dstR2 = n.r2
    if (n.r1 === n.r2) {
      srcR = n.r1 - 1
      dstR1 = n.r1
    }
    if (srcR < 0) return
    const { ops, pre } = this.newOpBuilder()
    for (let c = n.c1; c <= n.c2; c++) {
      const colId = cols[c]
      const src = this.sourceCell(srcR, colId)
      for (let r = dstR1; r <= dstR2; r++) {
        const rec = this.nodeAt(r)
        if (!rec || !colId) continue
        if (!this.isEditableCol(colId)) continue
        this.pushCellOp(ops, pre, rec, colId, src.formula ?? src.raw, !!src.formula)
      }
    }
    await this.runOps(ops, pre, 'Fill down')
  }

  async fillRight() {
    const n = this.norm()
    if (!n || !this.deps.canEdit()) return
    const cols = this.displayedCols()
    // Excel semantics: multi-col selection → left col fills the rest;
    // single-col selection → the column to the LEFT fills into the selection
    let srcC = n.c1
    let dstC1 = n.c1 + 1
    if (n.c1 === n.c2) {
      srcC = n.c1 - 1
      dstC1 = n.c1
    }
    if (srcC < 0) return
    const { ops, pre } = this.newOpBuilder()
    for (let r = n.r1; r <= n.r2; r++) {
      const rec = this.nodeAt(r)
      if (!rec) continue
      const src = this.sourceCell(r, cols[srcC])
      for (let c = dstC1; c <= n.c2; c++) {
        const colId = cols[c]
        if (!colId || !this.isEditableCol(colId)) continue
        this.pushCellOp(ops, pre, rec, colId, src.formula ?? src.raw, !!src.formula)
      }
    }
    await this.runOps(ops, pre, 'Fill right')
  }

  async clearRange() {
    const n = this.norm()
    if (!n || !this.deps.canEdit()) return
    const cols = this.displayedCols()
    const { ops, pre } = this.newOpBuilder()
    for (let r = n.r1; r <= n.r2; r++) {
      const rec = this.nodeAt(r)
      if (!rec) continue
      for (let c = n.c1; c <= n.c2; c++) {
        const colId = cols[c]
        if (!colId || !this.isEditableCol(colId)) continue
        this.pushCellOp(ops, pre, rec, colId, '', false)
      }
    }
    await this.runOps(ops, pre, 'Clear')
  }

  selectAll() {
    const cols = this.displayedCols()
    if (cols.length === 0) return
    const r1 = this.firstRenderedRow()
    const r2 = this.lastRenderedRow()
    this.range = { anchor: { rowIndex: r1, colId: cols[0] }, focus: { rowIndex: r2, colId: cols[cols.length - 1] } }
    this.info()
    this.redraw()
  }

  // ------------------------------------------------------------------
  // op building + undo/redo
  // ------------------------------------------------------------------
  private newOpBuilder(): { ops: CellOp[]; pre: PreState[] } {
    return { ops: [], pre: [] }
  }

  private preFor(pre: PreState[], rec: MisRecordDto): PreState {
    let ps = pre.find((p) => p.id === rec.id)
    if (!ps) {
      ps = { id: rec.id, version: rec.version, cells: {} }
      pre.push(ps)
    }
    return ps
  }

  /** interpret a raw token for one cell and add it to the batch */
  private pushCellOp(ops: CellOp[], pre: PreState[], rec: MisRecordDto, colId: string, raw: string, isFormula: boolean) {
    const field = this.fieldOf(colId)
    if (!field) return
    const ps = this.preFor(pre, rec)
    if (!(colId in ps.cells)) {
      ps.cells[colId] = {
        value: rec[colId] == null ? null : rec[colId],
        formula: rec._formulas?.[colId] ?? null,
      }
    }
    let op = ops.find((o) => o.recordId === rec.id)
    if (!op) {
      op = { recordId: rec.id, version: rec.version, values: {}, formulas: {} }
      ops.push(op)
    }
    const hadFormula = !!rec._formulas?.[colId]
    const token = raw.trim()
    if (isFormula && token.startsWith('=') && this.isFormulaCapable(colId)) {
      op.formulas![colId] = token
      return
    }
    if (token === '') {
      op.values![colId] = null
      if (hadFormula) op.formulas![colId] = null
      return
    }
    // type-aware value interpretation (server coerces again — double safety)
    switch (field.dataType) {
      case 'INTEGER':
      case 'DECIMAL': {
        const n = Number(token.replace(/[, ]/g, ''))
        op.values![colId] = Number.isFinite(n) ? n : token
        break
      }
      case 'DATE':
      case 'DATETIME':
        op.values![colId] = normalizeDateToken(token)
        break
      default:
        op.values![colId] = token
    }
    if (hadFormula) op.formulas![colId] = null // overwriting a formula with a value (Excel semantics)
  }

  /** capture pre-state of every editable cell in a range (for cut) */
  private captureRangePreState(n: RectRange): PreState[] {
    const cols = this.displayedCols()
    const pre: PreState[] = []
    for (let r = n.r1; r <= n.r2; r++) {
      const rec = this.nodeAt(r)
      if (!rec) continue
      const ps = this.preFor(pre, rec)
      for (let c = n.c1; c <= n.c2; c++) {
        const colId = cols[c]
        if (!colId || !this.isEditableCol(colId)) continue
        if (!(colId in ps.cells)) {
          ps.cells[colId] = {
            value: rec[colId] == null ? null : rec[colId],
            formula: rec._formulas?.[colId] ?? null,
          }
        }
      }
    }
    return pre
  }

  /** merge sequential ops for the same record (paste + cut-clear) so each
   *  record is sent exactly once with its correct optimistic version */
  private mergeOps(ops: CellOp[]): CellOp[] {
    const merged = new Map<string, CellOp>()
    for (const op of ops) {
      const cur = merged.get(op.recordId)
      if (!cur) {
        merged.set(op.recordId, { ...op, values: { ...(op.values ?? {}) }, formulas: { ...(op.formulas ?? {}) } })
        continue
      }
      for (const [k, v] of Object.entries(op.values ?? {})) cur.values![k] = v
      for (const [k, v] of Object.entries(op.formulas ?? {})) cur.formulas![k] = v
    }
    return [...merged.values()]
  }

  /** execute a batch, keep undo history, return applied count */
  private async runOps(ops: CellOp[], pre: PreState[], label: string): Promise<number> {
    // drop no-op records (nothing actually changed)
    const real0 = this.mergeOps(ops).filter(
      (o) => Object.keys(o.values ?? {}).length > 0 || Object.keys(o.formulas ?? {}).length > 0,
    )
    if (real0.length === 0) return 0
    this.lastOps = real0
    const results = await this.deps.bulk(real0, label)
    const okResults = results.filter((r) => r.ok && r.record)
    if (okResults.length > 0) {
      // build the inverse from the server-returned (post-op) versions
      const byId = new Map(okResults.map((r) => [r.id, r.record!]))
      const undoOps: CellOp[] = []
      const redoOps: CellOp[] = []
      for (const ps of pre) {
        const after = byId.get(ps.id)
        if (!after) continue // record failed — nothing to undo
        const u: CellOp = { recordId: ps.id, version: after.version, values: {}, formulas: {} }
        for (const [colId, cell] of Object.entries(ps.cells)) {
          u.values![colId] = cell.value
          u.formulas![colId] = cell.formula
        }
        const fwd = real0.find((o) => o.recordId === ps.id)
        const f: CellOp = { recordId: ps.id, version: ps.version, values: { ...(fwd?.values ?? {}) }, formulas: { ...(fwd?.formulas ?? {}) } }
        undoOps.push(u)
        redoOps.push(f)
      }
      if (undoOps.length > 0) {
        this.undoStack.push({ label, undoOps, redoOps })
        if (this.undoStack.length > UNDO_CAP) this.undoStack.shift()
        this.redoStack.length = 0
      }
    }
    return okResults.length
  }

  async undo(): Promise<void> {
    const entry = this.undoStack.pop()
    if (!entry) {
      this.deps.notify?.('Nothing to undo', 'Cell edit history for this session is empty.')
      return
    }
    const results = await this.deps.bulk(entry.undoOps, `Undo ${entry.label}`)
    const okResults = results.filter((r) => r.ok && r.record)
    if (okResults.length > 0) {
      const byId = new Map(okResults.map((r) => [r.id, r.record!]))
      for (const op of entry.redoOps) {
        const after = byId.get(op.recordId)
        if (after) op.version = after.version
      }
      this.redoStack.push(entry)
    }
  }

  async redo(): Promise<void> {
    const entry = this.redoStack.pop()
    if (!entry) {
      this.deps.notify?.('Nothing to redo')
      return
    }
    const results = await this.deps.bulk(entry.redoOps, `Redo ${entry.label}`)
    const okResults = results.filter((r) => r.ok && r.record)
    if (okResults.length > 0) {
      const byId = new Map(okResults.map((r) => [r.id, r.record!]))
      for (const op of entry.undoOps) {
        const after = byId.get(op.recordId)
        if (after) op.version = after.version
      }
      this.undoStack.push(entry)
    }
  }

  // ------------------------------------------------------------------
  // debug / test surface
  // ------------------------------------------------------------------
  getDebug() {
    return {
      hasSelection: this.hasSelection(),
      range: this.norm(),
      mode: this.mode,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      clipboardTsv: this.clip?.tsv ?? null,
      cutMode: !!this.cutRange,
      copyEventCount: this.copyEventCount,
      lastGhost: this.lastGhost,
      lastOps: this.lastOps,
      trace: this.trace,
      nodeDataSample: (() => {
        const api = this.api()
        try {
          const n = api?.getRenderedNodes()?.find((x) => x.rowIndex === 0)
          const d = n?.data as MisRecordDto | undefined
          return d ? { id: d.id, version: d.version, formulas: d._formulas ?? null, bucket: d.bucket ?? null } : null
        } catch { return null }
      })(),
    }
  }

  /** test hook: simulate a native paste event with TSV text */
  testPaste(tsv: string) {
    if (typeof DataTransfer === 'undefined' || typeof ClipboardEvent === 'undefined') {
      void this.pasteText(tsv)
      return
    }
    const dt = new DataTransfer()
    dt.setData('text/plain', tsv)
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    const host = this.host()
    const cell = host?.querySelector('.ag-cell') as HTMLElement | null
    ;(cell ?? host)?.dispatchEvent(ev)
  }
}
