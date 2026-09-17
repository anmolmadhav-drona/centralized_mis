'use client'

// Global floating calculator — Ctrl+Shift+C opens, Escape closes.
// Draggable, keyboard-friendly, session history, consistent with the portal.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Calculator as CalcIcon, Delete, History, X, GripHorizontal } from 'lucide-react'
import { evaluateExpression, formatResult } from '@/components/calculator/evaluate'
import { useAppStore } from '@/lib/client/store'

interface HistoryItem {
  expression: string
  result: string
  at: string
}

export default function Calculator() {
  const open = useAppStore((s) => s.calculatorOpen)
  const setOpen = useAppStore((s) => s.setCalculatorOpen)
  const [expression, setExpression] = useState('')
  const [live, setLive] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  // focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  const compute = useCallback((expr: string): string | null => {
    if (!expr.trim()) return null
    const res = evaluateExpression(expr)
    if (res.ok && res.value !== undefined) return formatResult(res.value)
    return null
  }, [])

  const updateExpr = useCallback((next: string) => {
    setExpression(next)
    const result = compute(next)
    setLive(result)
    setError(result ? null : null)
  }, [compute])

  const submit = useCallback(() => {
    const result = compute(expression)
    if (result == null) {
      const res = evaluateExpression(expression)
      setError(res.error || 'Invalid expression')
      setLive(null)
      return
    }
    setHistory((h) => [
      { expression, result, at: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) },
      ...h.slice(0, 29),
    ])
    setExpression(result.replace(/,/g, ''))
    setLive(null)
    setError(null)
  }, [expression, compute])

  const pressKey = useCallback((k: string) => {
    if (k === 'back') setExpression((e) => e.slice(0, -1))
    else if (k === 'clear') { setExpression(''); setLive(null); setError(null) }
    else if (k === '=') submit()
    else setExpression((e) => e + k)
  }, [submit])

  // keyboard input while calculator focused
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  // drag handling
  const onDragStart = (e: React.PointerEvent) => {
    const panel = (e.currentTarget as HTMLElement).closest('[data-calc-panel]') as HTMLElement
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return
      setPos({
        x: Math.max(8, Math.min(window.innerWidth - 340, ev.clientX - dragRef.current.dx)),
        y: Math.max(8, Math.min(window.innerHeight - 200, ev.clientY - dragRef.current.dy)),
      })
    }
    const up = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const keys: Array<{ k: string; label: React.ReactNode; variant?: 'op' | 'eq' | 'fn' }> = [
    { k: '(', label: '(', variant: 'fn' }, { k: ')', label: ')', variant: 'fn' },
    { k: '%', label: '%', variant: 'fn' }, { k: 'clear', label: 'C', variant: 'fn' },
    { k: '7', label: '7' }, { k: '8', label: '8' }, { k: '9', label: '9' }, { k: '/', label: '÷', variant: 'op' },
    { k: '4', label: '4' }, { k: '5', label: '5' }, { k: '6', label: '6' }, { k: '*', label: '×', variant: 'op' },
    { k: '1', label: '1' }, { k: '2', label: '2' }, { k: '3', label: '3' }, { k: '-', label: '−', variant: 'op' },
    { k: '0', label: '0' }, { k: '.', label: '.' }, { k: 'back', label: <Delete className="mx-auto h-4 w-4" />, variant: 'fn' }, { k: '+', label: '+', variant: 'op' },
  ]

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-calc-panel
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="fixed z-50 w-[312px] overflow-hidden rounded-xl border bg-card shadow-2xl"
          style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : { right: 24, bottom: 88 }}
        >
          {/* header (drag handle) */}
          <div
            onPointerDown={onDragStart}
            className="flex cursor-grab select-none items-center gap-2 border-b bg-secondary/60 px-3 py-2 active:cursor-grabbing"
          >
            <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground/50" />
            <CalcIcon className="h-3.5 w-3.5 text-primary" />
            <span className="flex-1 text-xs font-medium text-muted-foreground">Calculator</span>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={`rounded p-1 transition-colors hover:bg-accent ${showHistory ? 'text-primary' : 'text-muted-foreground'}`}
              aria-label="Toggle history"
            >
              <History className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent"
              aria-label="Close calculator (Esc)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* display */}
          <div className="px-3 pb-2 pt-3">
            <input
              ref={inputRef}
              value={expression}
              onChange={(e) => updateExpr(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="e.g. 120 * 15"
              className="w-full bg-transparent text-right text-lg font-medium tabular-nums outline-none placeholder:text-muted-foreground/40"
              aria-label="Calculator expression"
              inputMode="decimal"
              autoComplete="off"
            />
            <div className="mt-0.5 h-6 text-right text-sm tabular-nums">
              {error ? (
                <span className="text-destructive">{error}</span>
              ) : live != null ? (
                <span className="text-primary">= {live}</span>
              ) : (
                <span className="text-muted-foreground/40">Enter = to evaluate</span>
              )}
            </div>
          </div>

          {/* history */}
          {showHistory && (
            <div className="nice-scroll max-h-40 overflow-y-auto border-t bg-muted/40 px-3 py-2">
              {history.length === 0 ? (
                <p className="py-3 text-center text-xs text-muted-foreground">No calculations yet</p>
              ) : (
                <ul className="space-y-1">
                  {history.map((h, i) => (
                    <li key={i}>
                      <button
                        onClick={() => updateExpr(h.expression)}
                        className="w-full rounded px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
                      >
                        <p className="text-xs tabular-nums text-muted-foreground">{h.expression}</p>
                        <p className="text-[13px] font-medium tabular-nums">{h.result}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* keypad */}
          <div className="grid grid-cols-4 gap-1 p-2">
            {keys.map((key) => (
              <button
                key={key.k}
                onClick={() => pressKey(key.k)}
                className={`h-10 rounded-lg text-[15px] font-medium transition-colors active:scale-[0.97] ${
                  key.variant === 'op'
                    ? 'bg-primary/10 text-primary hover:bg-primary/20'
                    : key.variant === 'fn'
                      ? 'bg-secondary text-secondary-foreground hover:bg-secondary/70'
                      : 'bg-background text-foreground ring-1 ring-border hover:bg-accent/50'
                }`}
              >
                {key.label}
              </button>
            ))}
            <button
              onClick={submit}
              className="col-span-4 h-10 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.99]"
            >
              =
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
