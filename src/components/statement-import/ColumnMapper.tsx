'use client'

import { useMemo } from 'react'
import { IconTableColumn } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import {
  applyMapping, DATE_FORMAT_LABELS, mappingProblem, NONE,
  type ColumnMapping, type DateFormat, type StatementTable,
} from '@/lib/statement-import/column-map'

/* ── Tanınmayan ekstre: sütun eşleme adımı ───────────────────────────────────
   Tablo önizlemesi + her alan için sütun seçimi. Eşleme her değişiklikte
   uygulanıp okunan ilk satırlar gösterilir; kullanıcı yanlış ayraç ya da tarih
   biçimini anında görür. Onaylanınca StatementImport, sonucu banka
   ayrıştırıcılarıyla aynı önizleme hattına sokar. */

interface Props {
  table: StatementTable
  mapping: ColumnMapping
  onChange: (m: ColumnMapping) => void
  label: string
  onLabel: (s: string) => void
  fileName: string
  /** Bu imzayla daha önce kaydedilmiş eşlemenin adı */
  remembered: string | null
  onForget: () => void
  onConfirm: () => void
  onCancel: () => void
  error: string
}

const ROLE_BADGE: [keyof ColumnMapping, string][] = [
  ['date', 'Tarih'], ['description', 'Açıklama'], ['amount', 'Tutar'], ['debit', 'Borç'], ['credit', 'Alacak'], ['balance', 'Bakiye'],
]

export function ColumnMapper({ table, mapping: m, onChange, label, onLabel, fileName, remembered, onForget, onConfirm, onCancel, error }: Props) {
  const set = (patch: Partial<ColumnMapping>) => onChange({ ...m, ...patch })
  const problem = mappingProblem(m, table.headers.length)
  const result = useMemo(() => (problem ? null : applyMapping(table, m)), [problem, table, m])
  const sample = (i: number) => table.rows.find(r => r[i]?.trim())?.[i] ?? ''
  const colOptions = (optional: boolean) => [
    ...(optional ? [{ value: String(NONE), label: 'Yok' }] : []),
    ...table.headers.map((h, i) => ({ value: String(i), label: table.hasHeader ? h : `${h} · ${sample(i).slice(0, 24)}` })),
  ]
  const pick = (key: keyof ColumnMapping, title: string, optional = false) => (
    <SelectField
      label={title}
      value={String(m[key])}
      onChange={e => set({ [key]: Number(e.target.value) } as Partial<ColumnMapping>)}
      options={colOptions(optional)}
      placeholder="Sütun seçin"
    />
  )
  const roleOf = (i: number) => ROLE_BADGE
    .filter(([k]) => (m.amountMode === 'single' ? k !== 'debit' && k !== 'credit' : k !== 'amount'))
    .filter(([k]) => k !== 'balance' || m.statementType === 'checking')
    .find(([k]) => m[k] === i)?.[1]
  const count = result?.rows.length ?? 0
  const isCard = m.statementType === 'credit_card'

  return (
    <div className="max-w-4xl mx-auto w-full flex flex-col gap-4" data-testid="column-mapper">
      <div className="flex items-start gap-3">
        <IconTableColumn className="size-7 text-muted-foreground flex-shrink-0 mt-0.5" stroke={1.5} />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">Sütunları eşleyin</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            <span className="break-all">{fileName}</span> biçimi tanınmadı. Hangi sütunun ne olduğunu seçin; önerilen eşleme işaretlendi.
            Bu biçim bir dahaki sefere hatırlanır.
          </p>
        </div>
      </div>

      {remembered !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-green-600/10 px-4 py-2.5 text-xs font-medium text-green-700 dark:text-green-400">
          <span>Bu biçim daha önce{remembered ? ` “${remembered}” olarak` : ''} eşlenmişti; aynı eşleme uygulandı.</span>
          <button type="button" onClick={onForget} className="underline">Eşlemeyi unut</button>
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField
          label="Ekstre türü"
          value={m.statementType}
          onChange={e => set({ statementType: e.target.value as ColumnMapping['statementType'] })}
          options={[{ value: 'credit_card', label: 'Kredi kartı' }, { value: 'checking', label: 'Vadesiz hesap' }]}
        />
        {pick('date', 'Tarih sütunu')}
        <SelectField
          label="Tarih biçimi"
          value={m.dateFormat}
          onChange={e => set({ dateFormat: e.target.value as DateFormat })}
          options={(Object.keys(DATE_FORMAT_LABELS) as DateFormat[]).map(f => ({ value: f, label: DATE_FORMAT_LABELS[f] }))}
        />
        {pick('description', 'Açıklama sütunu')}
        <SelectField
          label="Tutar"
          value={m.amountMode}
          onChange={e => set({ amountMode: e.target.value as ColumnMapping['amountMode'] })}
          options={[{ value: 'single', label: 'Tek sütun (işaretli)' }, { value: 'split', label: 'Ayrı Borç / Alacak sütunları' }]}
        />
        {m.amountMode === 'single'
          ? pick('amount', 'Tutar sütunu')
          : <>{pick('debit', isCard ? 'Borç (harcama) sütunu' : 'Borç (çıkan) sütunu')}{pick('credit', isCard ? 'Alacak (ödeme/iade) sütunu' : 'Alacak (giren) sütunu')}</>}
        <SelectField
          label="Ondalık ayracı"
          value={m.decimal}
          onChange={e => set({ decimal: e.target.value as ColumnMapping['decimal'] })}
          options={[{ value: 'comma', label: 'Virgül (1.234,56)' }, { value: 'dot', label: 'Nokta (1,234.56)' }]}
        />
        {m.amountMode === 'single' && (
          <SelectField
            label="İşaret yönü"
            value={m.sign}
            onChange={e => set({ sign: e.target.value as ColumnMapping['sign'] })}
            options={[
              { value: 'expense-positive', label: isCard ? 'Harcama artı, ödeme eksi' : 'Çıkan artı, giren eksi' },
              { value: 'expense-negative', label: isCard ? 'Harcama eksi, ödeme artı' : 'Çıkan eksi, giren artı' },
            ]}
          />
        )}
        {!isCard && pick('balance', 'Bakiye sütunu (isteğe bağlı)', true)}
        <Input label="Ad (isteğe bağlı)" value={label} onChange={e => onLabel(e.target.value)} placeholder="ör. Örnek Bank kartı" />
      </section>

      {/* Ham tablo: seçilen sütunlar işaretli */}
      <section className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {table.headers.map((h, i) => {
                const role = roleOf(i)
                return (
                  <th key={i} className={cn('px-3 py-2 text-left font-semibold whitespace-nowrap', role && 'text-primary')}>
                    {h}{role && <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold">{role}</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(0, 8).map((r, ri) => (
              <tr key={ri} className="border-b border-border/50 last:border-0">
                {r.map((c, ci) => <td key={ci} className={cn('px-3 py-1.5 whitespace-nowrap max-w-[18rem] truncate', roleOf(ci) ? 'text-foreground' : 'text-muted-foreground')}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {table.rows.length > 8 && <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-t border-border/50">… {table.rows.length - 8} satır daha</div>}
      </section>

      {/* Okunan sonuç */}
      <section className="rounded-xl border border-border bg-card px-4 py-3 flex flex-col gap-2">
        <div className="text-sm font-semibold">
          {problem
            ? <span className="text-destructive">{problem}</span>
            : <><span className="tabular-nums">{count}</span> işlem okundu{result && result.skipped.length > 0 && <span className="font-normal text-muted-foreground"> · {result.skipped.length} satır atlandı (tarih ya da tutar okunamadı)</span>}</>}
        </div>
        {result && count > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {result.rows.slice(0, 5).map(r => (
              <li key={r.row} className="flex justify-between gap-3">
                <span className="text-muted-foreground tabular-nums w-24 flex-shrink-0">{formatDate(r.date, 'd MMM yyyy')}</span>
                <span className="truncate flex-1">{r.description}</span>
                <span className={cn('tabular-nums whitespace-nowrap', r.amount < 0 && 'text-green-600')}>{r.amount < 0 ? '+' : '−'}{formatCurrency(Math.abs(r.amount))}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          {isCard ? 'Harcamalar “−”, kartınıza ödemeler ve iadeler yeşil “+” görünmeli.' : 'Hesaptan çıkanlar “−”, hesaba girenler yeşil “+” görünmeli.'}{' '}
          Bankanın toplamı bilinmediği için toplam kontrolü yapılamaz.
        </p>
      </section>

      {error && <div className="text-xs text-destructive font-medium px-4 py-2.5 bg-destructive/10 rounded-xl">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onConfirm} disabled={!!problem || count === 0} className="rounded-xl">
          Devam et · {count} işlem
        </Button>
        <Button variant="outline" onClick={onCancel} className="rounded-xl">Vazgeç</Button>
      </div>
    </div>
  )
}
