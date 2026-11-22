'use client'

import Link from 'next/link'
import { PrintButton } from '@/components/layout/PrintSupport'
import { SelectField } from '@/components/ui/Select'
import { PRESETS, type Preset } from '@/lib/reports/period'
import type { Account } from '@/types'

/* ── Filter bar: dönem seçici, ‹ › gezinti, fon anahtarı, hesap ───── */
export function ReportFilterBar({
  preset, setPreset, setNavState, canNavigate, presetOffset, setPresetOffset, periodLabel,
  customFrom, setCustomFrom, customTo, setCustomTo, includeInvestmentIncome, setIncludeInvestmentIncome,
  accountId, setAccountId, accounts, resetDrilldown,
}: {
  preset: Preset
  setPreset: (p: Preset) => void
  setNavState: (s: { preset: Preset; offset: number }) => void
  canNavigate: boolean
  presetOffset: number
  setPresetOffset: (offset: number) => void
  periodLabel: string
  customFrom: string
  setCustomFrom: (v: string) => void
  customTo: string
  setCustomTo: (v: string) => void
  includeInvestmentIncome: boolean
  setIncludeInvestmentIncome: (on: boolean) => void
  accountId: string
  setAccountId: (id: string) => void
  accounts: Account[]
  resetDrilldown: () => void
}) {
  return (
    <div className="px-6 py-3 border-b border-border/50 bg-card flex flex-wrap items-center gap-3 flex-shrink-0">

      {/* Telefonda altı aralık tek satıra sığmayıp sayfayı yatay kaydırıyordu:
          sarmalanır (lg'de tek satır). */}
      <div className="flex flex-wrap lg:flex-nowrap gap-0.5 bg-background p-1 rounded-xl">
        {PRESETS.map(p => (
          <button
            key={p.key}
            // Preset'e basmak "bugüne dön" demektir — aynı sekmeye tekrar
            // basıldığında preset değişmediği için türev sıfırlama devreye girmez
            onClick={() => { setPreset(p.key); setNavState({ preset: p.key, offset: 0 }); resetDrilldown() }}
            className={[
              'px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap',
              preset === p.key ? 'bg-secondary text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground rounded-xl',
            ].join(' ')}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Dönem gezintisi — sabit aralıklı presetlerde ('Tüm Zamanlar', 'Özel')
          anlamsız, gizlenir */}
      {canNavigate && (
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => { setPresetOffset(presetOffset - 1); resetDrilldown() }}
            title="Önceki dönem"
            className="w-11 h-11 lg:w-6 lg:h-6 flex-shrink-0 flex items-center justify-center rounded-lg text-sm leading-none text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            ‹
          </button>
          <button
            onClick={() => { setPresetOffset(0); resetDrilldown() }}
            title={presetOffset !== 0 ? 'Bugüne dön' : undefined}
            className={[
              'flex items-center px-2 min-h-11 lg:min-h-0 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
              presetOffset !== 0 ? 'text-primary hover:bg-secondary/60' : 'text-foreground cursor-default',
            ].join(' ')}
          >
            {periodLabel}
          </button>
          <button
            onClick={() => { setPresetOffset(presetOffset + 1); resetDrilldown() }}
            title="Sonraki dönem"
            className="w-11 h-11 lg:w-6 lg:h-6 flex-shrink-0 flex items-center justify-center rounded-lg text-sm leading-none text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            ›
          </button>
        </div>
      )}

      {preset === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={e => { setCustomFrom(e.target.value); resetDrilldown() }}
            className="border border-border rounded-xl px-2 py-1.5 text-xs text-foreground bg-card focus:outline-none focus:border-primary"
          />
          <span className="text-muted-foreground text-xs">—</span>
          <input
            type="date"
            value={customTo}
            onChange={e => { setCustomTo(e.target.value); resetDrilldown() }}
            className="border border-border rounded-xl px-2 py-1.5 text-xs text-foreground bg-card focus:outline-none focus:border-primary"
          />
        </div>
      )}

      <label className="ml-auto flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
        <input
          type="checkbox"
          checked={includeInvestmentIncome}
          onChange={e => setIncludeInvestmentIncome(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-input accent-primary cursor-pointer"
        />
        <span className="text-xs font-medium text-muted-foreground">Fon getirileri dahil</span>
      </label>

      <SelectField
        value={accountId}
        onChange={e => { setAccountId(e.target.value); resetDrilldown() }}
        options={[
          { value: 'all', label: 'Tüm Hesaplar' },
          ...accounts.map(a => ({ value: a.id, label: a.name })),
        ]}
        className="w-fit bg-card text-xs"
      />
      <Link
        href="/reports/monthly"
        className="print:hidden inline-flex items-center px-3 h-8 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        Aylık Özet
      </Link>
      <PrintButton />
    </div>
  )
}
