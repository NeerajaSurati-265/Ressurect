import type { Autopsy, Finding } from '@contracts/types'
import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { useId, useState } from 'react'
import { STACK_LABEL } from '../lib/copy'
import { DUR, EASE_OUT_EXPO, STAGGER } from '../styles/motion'
import { SEVERITY_LABEL, SeverityIcon } from './icons'

const ORDER = { block: 0, warn: 1, ok: 2 } as const

const list = { hidden: {}, show: { transition: { staggerChildren: STAGGER, delayChildren: 0.12 } } }
const item = {
  hidden: { opacity: 0, y: 8, filter: 'blur(2px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: DUR.ui, ease: EASE_OUT_EXPO } },
}
const itemStill = { hidden: { opacity: 1 }, show: { opacity: 1 } }

function FindingRow({ f, reduced }: { f: Finding; reduced: boolean }) {
  return (
    <m.li variants={reduced ? itemStill : item} className="flex gap-3 border-t border-parchment/15 py-3 first:border-t-0">
      <SeverityIcon severity={f.severity} className="mt-0.5 h-6 w-6 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold text-bone">
          <span className="sr-only">{SEVERITY_LABEL[f.severity]}: </span>
          {f.title}
        </p>
        <p className="mt-0.5 text-sm text-bone/80">{f.detail}</p>
        {f.fix && (
          <p className="mt-1.5 text-sm text-bone">
            <span className="font-semibold text-ember-300">Fix: </span>
            {f.fix}
          </p>
        )}
        {f.file && (
          <p className="mt-1.5">
            <code className="rounded bg-night-950/60 px-1.5 py-0.5 font-mono text-xs text-parchment">{f.file}</code>
          </p>
        )}
      </div>
    </m.li>
  )
}

/**
 * The autopsy, written on aged parchment: detected stack, summary and findings.
 * Shown on every status. `collapsible` folds the findings away once the result is in.
 */
export function AutopsyReport({ autopsy, collapsible = false }: { autopsy: Autopsy; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible)
  const listId = useId()
  const findings = [...autopsy.findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
  const counts = autopsy.findings.reduce(
    (acc, f) => ({ ...acc, [f.severity]: acc[f.severity] + 1 }),
    { ok: 0, warn: 0, block: 0 },
  )
  const expanded = open || !collapsible
  const reduced = !!useReducedMotion()

  return (
    <section aria-labelledby={`${listId}-h`} className="parchment-glass panel-enter rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-parchment/80">Case file</p>
          <h2 id={`${listId}-h`} className="font-type text-xl text-parchment sm:text-2xl">
            Autopsy report
          </h2>
        </div>
        <span className="rounded-full border border-parchment/35 bg-night-950/40 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-parchment">
          <span className="sr-only">Detected stack: </span>
          {STACK_LABEL[autopsy.stack]}
          {autopsy.app_dir && autopsy.app_dir !== '.' ? ` · ${autopsy.app_dir}/` : ''}
        </span>
      </div>
      <p className="mt-3 italic text-bone">{autopsy.summary}</p>
      <p className="mt-2 text-xs text-bone/70">
        {counts.block > 0 && `${counts.block} blocking · `}
        {counts.warn} {counts.warn === 1 ? 'warning' : 'warnings'} · {counts.ok} ok
        {autopsy.source === 'rules' && ' · rules only (the AI review was unavailable)'}
      </p>

      {collapsible && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-md text-sm font-semibold text-ember-300 underline-offset-4 hover:underline"
        >
          <m.svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: reduced ? 0 : DUR.microSlow, ease: EASE_OUT_EXPO }}
          >
            <path d="M6 3.5L10.5 8 6 12.5" />
          </m.svg>
          {expanded ? 'Hide findings' : `Show ${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}`}
        </button>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <m.div
            key="findings"
            className="overflow-hidden"
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : DUR.ui, ease: EASE_OUT_EXPO }}
          >
            <m.ul id={listId} className="mt-3 border-t border-parchment/20 pt-1" variants={list} initial="hidden" animate="show">
              {findings.map((f) => (
                <FindingRow key={f.id} f={f} reduced={reduced} />
              ))}
            </m.ul>
          </m.div>
        )}
      </AnimatePresence>
    </section>
  )
}
