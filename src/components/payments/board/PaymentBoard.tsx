'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { EmptyState } from '@/components/ui/EmptyState'
import { usePaymentsView } from '@/components/layout/PaymentsViewProvider'
import {
  useAccountStore, useDebtStore, useInvestmentStore, usePaymentsStore, useTransactionStore,
} from '@/store'
import { PAYMENTS_VIEWS } from '@/lib/payments-view'
import { formatCurrency } from '@/lib/utils/currency'
import { today } from '@/lib/utils/date'
import { addMoney } from '@/lib/utils/money'
import { isPosted } from '@/lib/utils/calculations'
import {
  assignCardPayments, buildSchedule, buildTargets, monthKeys, monthOf, shiftMonth, summarizeRows,
  type MonthKey, type PaymentRow, type PaymentTarget,
} from '@/lib/payments/schedule'
import { EmptyBox, MonthNav, Segmented, SumItem, TargetMark, dayMonth, fmtAmount, monthTitle } from './bits'
import { ListView } from './views/ListView'
import { MatrixView } from './views/MatrixView'
import { PaymentEditModal } from '../PaymentEditModal'
import { PayModal } from '../PayModal'
import { PlanSettingsModal } from '../PlanSettingsModal'
import { TrackingManagerModal } from '../TrackingManagerModal'

/* ── Ödeme Takibi tahtası ────────────────────────────────────────────────────
 * Tahta kalıbı (board-pages-pattern): kabuk her şeyi tutar — ay seçici, kapsam,
 * özet şeridi, görünüm seçici, düzenle/öde/ayarlar pencereleri. Görünümler saf
 * sunumdur ve AYNI satır kümesini (lib/payments/schedule.ts) basar; görünüm
 * değiştirmek tutarları değiştirmez.
 *
 * İki görünüm (tercih çerezde — lib/payments-view.ts):
 *   Liste       — seçili ay, aciliyete göre bölümlü tablo
 *   Yıllık Plan — kart/borç × 12 ay matrisi, hücreden aylık düzenleme
 * Takvim ve Hesap Akışı alternatifleri kullanıcı seçiminde elendi (2026-09-11).
 *
 * Ödeme günü girilmemiş kartlar satır üretmez (varsayım yok); Liste'de üstte
 * kurulum şeridiyle, Yıllık Plan'da kendi satırında kurulum düğmesiyle görünür.
 * ------------------------------------------------------------------------- */

type KindFilter = 'all' | 'card' | 'debt'

const KIND_OPTIONS: { key: KindFilter; label: string }[] = [
  { key: 'all',  label: 'Tümü' },
  { key: 'card', label: 'Kartlar' },
  { key: 'debt', label: 'Borçlar' },
]

// Yıllık Plan penceresi: seçili ayın 3 ay öncesi → 8 ay sonrası (12 sütun).
const MATRIX_BEFORE = 3
const MATRIX_AFTER = 8

/** Pencereler satırı kimlikle değil hedef + ay ile tutar: ilk kayıttan sonra
 *  satırın id'si değişir, açık pencere yine aynı satırı bulsun. */
interface RowRef { targetKey: string; month: MonthKey }

const refOf = (r: PaymentRow): RowRef => ({ targetKey: r.target.key, month: r.month })

export function PaymentBoard() {
  const accounts      = useAccountStore(s => s.accounts)
  const accountsReady = useAccountStore(s => s.ready)
  const debts         = useDebtStore(s => s.debts)
  const transactions  = useTransactionStore(s => s.transactions)
  const txReady       = useTransactionStore(s => s.ready)
  const plans         = usePaymentsStore(s => s.plans)
  const occurrences   = usePaymentsStore(s => s.occurrences)
  const paymentsReady = usePaymentsStore(s => s.ready)
  // toBaseTry modül seviyesindeki kurları okur; kurlar gelince satır memo'su
  // yenilenmeli (bkz. fx-prices-memo-dep — yabancı para kart/hesap toplamları).
  const prices        = useInvestmentStore(s => s.prices)
  const { view, setView } = usePaymentsView()

  const todayStr = today()
  const currentMonth = monthOf(todayStr)

  const [month, setMonth]             = useState<MonthKey>(currentMonth)
  const [kind, setKind]               = useState<KindFilter>('all')
  const [editRef, setEditRef]         = useState<RowRef | null>(null)
  const [payRef, setPayRef]           = useState<RowRef | null>(null)
  const [settingsKey, setSettingsKey] = useState<string | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)

  const targets = useMemo(() => buildTargets({ accounts, debts, plans }), [accounts, debts, plans])
  const shown = useMemo(
    () => targets.filter(t => t.isActive && (kind === 'all' || t.kind === kind)),
    [targets, kind],
  )
  const setupTargets = useMemo(() => shown.filter(t => t.needsSetup), [shown])

  // Kart ödemesi tespiti TÜM hesaplardan yapılır: kapsam filtresi "tek kart"
  // kuralını bozmasın (bkz. assignCardPayments).
  const cardPayments = useMemo(() => assignCardPayments(accounts, transactions), [accounts, transactions])
  // Günü girilmemiş kartlarda bulunan geçmiş ödeme sayısı — kurulum çağrısında gösterilir.
  const detectedCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const t of targets) {
      if (t.needsSetup) out[t.key] = (cardPayments.get(t.id) ?? []).filter(x => isPosted(x, todayStr)).length
    }
    return out
  }, [targets, cardPayments, todayStr])

  const matrixMonths = useMemo(
    () => monthKeys(shiftMonth(month, -MATRIX_BEFORE), shiftMonth(month, MATRIX_AFTER)),
    [month],
  )

  // Satırlar takip başlangıcından itibaren üretilir: önceki aylardan kalan
  // gecikmişler Liste'de "devreden" olarak görünsün.
  const from = useMemo(() => {
    const first = view === 'matrix' ? matrixMonths[0] : month
    return shown.reduce((m, t) => (t.startMonth < m ? t.startMonth : m), first)
  }, [shown, view, matrixMonths, month])
  const to = view === 'matrix' ? matrixMonths[matrixMonths.length - 1] : month

  const rows = useMemo(
    () => buildSchedule({ targets: shown, occurrences, transactions, from, to, todayStr, cardPayments }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, occurrences, transactions, from, to, todayStr, cardPayments, prices],
  )
  const monthRows = useMemo(() => rows.filter(r => r.month === month), [rows, month])
  const carryRows = useMemo(() => rows.filter(r => r.month < month && r.timing === 'overdue'), [rows, month])
  const summary   = useMemo(() => summarizeRows(monthRows), [monthRows])
  const carry     = useMemo(() => summarizeRows(carryRows), [carryRows])

  const findRow = (ref: RowRef | null) =>
    ref ? rows.find(r => r.target.key === ref.targetKey && r.month === ref.month) ?? null : null
  const editRow = findRow(editRef)
  const payRow  = findRow(payRef)
  const settingsTarget = targets.find(t => t.key === settingsKey) ?? null

  const openEdit = (r: PaymentRow) => setEditRef(refOf(r))
  const openPay  = (r: PaymentRow) => { setEditRef(null); setPayRef(refOf(r)) }
  const openSettings = (t: PaymentTarget) => { setEditRef(null); setManagerOpen(false); setSettingsKey(t.key) }

  const loading = !accountsReady || !txReady || !paymentsReady
  const overdueCount = summary.overdueCount + carry.overdueCount
  const overdueTry = addMoney(summary.overdueTry, carry.overdueTry)
  const paidPct = summary.totalTry > 0 ? Math.min(100, (summary.paidTry / summary.totalTry) * 100) : 0
  const activeView = PAYMENTS_VIEWS.find(v => v.key === view) ?? PAYMENTS_VIEWS[0]
  const cardCount = targets.filter(t => t.kind === 'card' && t.isActive).length
  const debtCount = targets.filter(t => t.kind === 'debt' && t.isActive).length

  return (
    <>
      <Header title="Ödeme Takibi" />

      <div className="p-4 sm:p-6 flex flex-col gap-5">
        {loading ? (
          <EmptyBox>Yükleniyor…</EmptyBox>
        ) : targets.length === 0 ? (
          <EmptyState
            icon="💳"
            title="Takip edilecek ödeme yok"
            description="Kredi kartı hesabı ya da borç eklediğinde aylık ödemeleri burada otomatik olarak görünür."
            action={
              <div className="flex gap-2">
                <Link href="/accounts" className="h-9 px-4 inline-flex items-center rounded-xl bg-secondary text-sm font-semibold hover:bg-secondary/70">Hesaplar</Link>
                <Link href="/debts" className="h-9 px-4 inline-flex items-center rounded-xl bg-secondary text-sm font-semibold hover:bg-secondary/70">Borçlar</Link>
              </div>
            }
          />
        ) : (
          <>
            {/* ── Özet şeridi ─────────────────────────────────────────── */}
            <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
              <div className="px-5 py-3.5 flex flex-wrap items-center gap-x-8 gap-y-3">
                <SumItem label={`${monthTitle(month)} ödemeleri`} value={formatCurrency(summary.totalTry)} strong />
                <SumItem label="Ödenen" value={formatCurrency(summary.paidTry)} className="text-green-600" />
                <SumItem
                  label="Kalan"
                  value={formatCurrency(summary.remainingTry)}
                  note={summary.unknownCount ? `${summary.unknownCount} ödemenin tutarı girilmedi` : undefined}
                />
                <SumItem
                  label="Gecikmiş"
                  value={overdueCount
                    ? overdueTry > 0 ? `${overdueCount} · ${formatCurrency(overdueTry)}` : `${overdueCount} ödeme`
                    : 'Yok'}
                  className={overdueCount ? 'text-destructive' : 'text-muted-foreground'}
                />
                <SumItem
                  label="Sıradaki"
                  value={summary.next ? summary.next.target.name : '—'}
                  note={summary.next ? `${dayMonth(summary.next.dueDate)} · ${fmtAmount(summary.next)}` : undefined}
                />
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  {cardCount} kart · {debtCount} borç takipte
                </span>
              </div>
              <div className="h-1 bg-secondary" aria-hidden>
                <div className="h-full bg-green-500 transition-[width]" style={{ width: `${paidPct}%` }} />
              </div>
            </div>

            {/* ── Araç çubuğu ─────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
              <MonthNav month={month} current={currentMonth} onChange={setMonth} />
              <Segmented ariaLabel="Kapsam" options={KIND_OPTIONS} value={kind} onChange={setKind} />
              <Segmented
                ariaLabel="Görünüm"
                options={PAYMENTS_VIEWS.map(v => ({ key: v.key, label: v.label, title: v.hint }))}
                value={view}
                onChange={setView}
              />
              <button
                type="button"
                onClick={() => setManagerOpen(true)}
                className="ml-auto h-9 px-3 rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                Takip ayarları
              </button>
            </div>

            <p className="text-[11px] text-muted-foreground -mt-2 px-1">{activeView.hint}</p>

            {/* ── Kurulum bekleyen kartlar (Liste) ────────────────────── */}
            {view === 'list' && setupTargets.length > 0 && (
              <div className="rounded-xl border border-dashed border-amber-500/50 bg-card px-4 py-3 flex flex-col gap-2.5">
                <p className="text-[12.5px]">
                  <span className="font-semibold text-amber-600">
                    {setupTargets.length} kartın son ödeme günü girilmedi.
                  </span>{' '}
                  <span className="text-muted-foreground">
                    Gün girilene kadar bu kartlar listeye, gecikme uyarılarına ve toplamlara katılmaz; bulunan geçmiş
                    ödemeler de aylara işlenemez.
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {setupTargets.map(t => {
                    const found = detectedCounts[t.key] ?? 0
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => openSettings(t)}
                        className="inline-flex items-center gap-2 h-8 pl-1.5 pr-3 rounded-lg border border-border bg-background text-[12.5px] font-medium hover:bg-secondary transition-colors"
                      >
                        <TargetMark target={t} size="xs" />
                        {t.name}
                        {found > 0 && <span className="text-muted-foreground">· {found} ödeme bulundu</span>}
                        <span className="text-amber-600">· ödeme gününü gir</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Görünüm ─────────────────────────────────────────────── */}
            {shown.length === 0 ? (
              <EmptyBox>
                {kind === 'card' ? 'Takipte kredi kartı yok.'
                  : kind === 'debt' ? 'Takipte borç yok.'
                    : 'Tüm kalemler takipten çıkarılmış. "Takip ayarları"ndan geri açabilirsin.'}
              </EmptyBox>
            ) : view === 'matrix' ? (
              <MatrixView
                months={matrixMonths} selectedMonth={month} currentMonth={currentMonth}
                targets={shown} rows={rows} accounts={accounts} detectedCounts={detectedCounts}
                onEdit={openEdit} onSelectMonth={setMonth} onSettings={openSettings}
              />
            ) : (
              <ListView rows={monthRows} carryRows={carryRows} accounts={accounts} onEdit={openEdit} onPay={openPay} />
            )}
          </>
        )}
      </div>

      <PaymentEditModal
        row={editRow}
        accounts={accounts}
        transactions={transactions}
        onClose={() => setEditRef(null)}
        onPay={openPay}
        onSettings={openSettings}
      />
      <PayModal row={payRow} accounts={accounts} onClose={() => setPayRef(null)} />
      <PlanSettingsModal target={settingsTarget} accounts={accounts} onClose={() => setSettingsKey(null)} />
      <TrackingManagerModal
        open={managerOpen}
        targets={targets}
        accounts={accounts}
        onClose={() => setManagerOpen(false)}
        onSettings={openSettings}
      />
    </>
  )
}
