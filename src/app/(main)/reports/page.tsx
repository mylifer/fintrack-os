'use client'

import { useMemo, useState, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { format, parseISO } from 'date-fns'
import { tr } from 'date-fns/locale'
import { comparisonRange, type CompareMode } from '@/lib/utils/period-compare'
import { Header }           from '@/components/layout/Header'
import { useTransactionStore, useAccountStore, useCategoryStore, useInvestmentStore, useSettingsStore, useDebtStore } from '@/store'
import { isReconciliation } from '@/lib/utils/reconciliation'
import { excludeFuture, calcPeriodFlow, isRealizedInvestmentPnlTx } from '@/lib/utils/calculations'
import { collapseInstallments } from '@/lib/utils/installments'
import { txHasCategory } from '@/lib/utils/categorySplits'
import { buildCashFlowData } from '@/lib/utils/cashflow'
import { CashFlowDetailOverlay } from '@/components/reports/CashFlowDetailOverlay'
import type { CategorySlice }       from '@/components/reports/_CategoryDonutChart'
import { PRESET_UNIT, formatPresetLabel, getPresetRange, type Preset } from '@/lib/reports/period'
import {
  buildCategoryData, buildIncomeCategoryData, buildTagExpenseData, buildPeriodComparison, buildCategoryTrendData,
} from '@/lib/reports/report-data'
import { buildTrendData } from '@/lib/reports/balance-trend'
import { useFundPeriodGain } from '@/components/reports/sections/useFundPeriodGain'
import { ReportFilterBar } from '@/components/reports/sections/ReportFilterBar'
import { KpiCards } from '@/components/reports/sections/KpiCards'
import { CashFlowCard } from '@/components/reports/sections/CashFlowCard'
import { CategoryDistributionRow } from '@/components/reports/sections/CategoryDistributionRow'
import { CategoryDrilldowns } from '@/components/reports/sections/CategoryDrilldowns'
import { TagAnalyticsRow } from '@/components/reports/sections/TagAnalyticsRow'
import { BalanceTrendCard } from '@/components/reports/sections/BalanceTrendCard'
import { AdvancedAnalysisCard } from '@/components/reports/sections/AdvancedAnalysisCard'

// Raporlar sayfası orkestratörü: filtre durumu ve türetilmiş veriler burada;
// saf hesaplar lib/reports/ altında, bölümler components/reports/sections/ altında.

/* ── Page ────────────────────────────────────────────────────────── */

export default function ReportsPage() {
  const transactions  = useTransactionStore(s => s.transactions)
  const txsReady      = useTransactionStore(s => s.ready)
  const accountsReady = useAccountStore(s => s.ready)
  const accounts      = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const categories    = useCategoryStore(s => s.categories)
  const debts         = useDebtStore(useShallow(s => s.debts))
  const prices        = useInvestmentStore(s => s.prices)
  const fundPrices    = useInvestmentStore(s => s.fundPrices)
  const investTxs     = useInvestmentStore(s => s.transactions)
  const fetchPrices   = useInvestmentStore(s => s.fetchPrices)

  const [preset,       setPreset]       = useState<Preset>('this-month')
  const [customFrom,   setCustomFrom]   = useState('')
  const [customTo,     setCustomTo]     = useState('')

  // Dönem gezintisi (dashboard/hesap detayı ile aynı ‹ › şeridi): 0 = preset'in
  // kendi dönemi, −1 = bir önceki. Offset ait olduğu preset'le birlikte tutulur;
  // preset değişince türev olarak 0'a döner — "Bu Ay"da Mart'a gidip "Bu Yıl"a
  // geçmek 2021'de bırakmasın.
  const [navState, setNavState] = useState<{ preset: Preset; offset: number }>({ preset: 'this-month', offset: 0 })
  const presetOffset = navState.preset === preset ? navState.offset : 0
  const setPresetOffset = (offset: number) => setNavState({ preset, offset })
  const canNavigate  = PRESET_UNIT[preset] !== undefined
  const periodLabel  = formatPresetLabel(preset, presetOffset)
  // Gezinti dışındayken 'Bugün' preset'i fon getirisinde son-iki-kapanış kısayolunu
  // kullanır; geçmiş bir güne gidildiğinde tarihsel seri gerekir.
  const isTodayPreset = preset === 'today' && presetOffset === 0
  const [accountId,    setAccountId]    = useState('all')
  // Fon getirisi anahtarı, Dashboard'daki "Fon getirileri dahil" ile AYNI kalıcı
  // ayardır (settings.includeFundGain) → iki sayfa aynı dönem için aynı Net'i
  // gösterir; oturumlar arası korunur. Ayrı bir yerel state kullanılmıyor.
  const includeInvestmentIncome = useSettingsStore(s => s.includeFundGain)
  const setIncludeInvestmentIncome = useSettingsStore(s => s.setIncludeFundGain)
  const [selectedCat,   setSelectedCat]   = useState<CategorySlice | null>(null)
  const [activeSliceIdx, setActiveSliceIdx] = useState<number | null>(null)
  // Gelir donut'u kendi drill-down seçimini tutar — gider seçimiyle çakışmasın,
  // ikisi aynı anda açık kalabilsin.
  const [selectedIncomeCat,   setSelectedIncomeCat]   = useState<CategorySlice | null>(null)
  const [activeIncomeSliceIdx, setActiveIncomeSliceIdx] = useState<number | null>(null)
  const [tagSliceIdx,   setTagSliceIdx]   = useState<number | null>(null)
  const [trendCatKey,   setTrendCatKey]   = useState<string>('')  // '' = auto (first in comparison list)

  // Nakit akışı detay overlay'i — dönem geneli ("Detay" butonu) veya tek bir
  // bar kovası (grafiğe tıklama) için aynı panel. `detail` içerik (kapanış
  // animasyonu boyunca korunur), `detailOpen` görünürlük.
  const [detail, setDetail] = useState<{ from: string; to: string; label: string } | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const openDetail = useCallback((d: { from: string; to: string; label: string }) => {
    setDetail(d)
    setDetailOpen(true)
  }, [])

  // Filtre (dönem/hesap) değişince tüm drill-down seçimlerini sıfırla. Filtreyi
  // değiştiren AYNI event handler içinde çağrılır — böylece bayat bir ara render
  // (eski seçim + yeni filtre) hiç oluşmaz.
  const resetDrilldown = useCallback(() => {
    setSelectedCat(null)
    setActiveSliceIdx(null)
    setSelectedIncomeCat(null)
    setActiveIncomeSliceIdx(null)
    setTagSliceIdx(null)
    setTrendCatKey('')
    setDetailOpen(false)
  }, [])

  const dateRange = useMemo(
    () => {
      // "Tüm Zamanlar" → başlangıç en erken işlem tarihi, bitiş BUGÜN. Bitişi son
      // işlem tarihine (max) sabitlemek yanlıştı: aralık kullanıcının son kaydından
      // öteye geçmiyor, dolayısıyla bugüne kadarki fon değeri/dönem güncel fiyatla
      // ölçülmüyordu. Başlangıç için 1970 gibi sabit erken tarih ise cash-flow
      // grafiğinde onlarca boş ay üretirdi → en erken işlemden başlarız. İşlem
      // yoksa (veya hepsi gelecek tarihliyse) getPresetRange varsayılanına düşer.
      if (preset === 'all-time') {
        let min = ''
        for (const t of transactions) {
          const d = t.date.slice(0, 10)
          if (!d) continue
          if (!min || d < min) min = d
        }
        const to = format(new Date(), 'yyyy-MM-dd') // bugüne kadar
        if (min && min <= to) return { from: min, to }
      }
      return getPresetRange(preset, customFrom, customTo, presetOffset)
    },
    [preset, customFrom, customTo, presetOffset, transactions],
  )

  const fundPeriodNet = useFundPeriodGain({ accountId, dateRange, isTodayPreset, investTxs, fundPrices, fetchPrices })

  // Anahtar AÇIKKEN gerçekleşmemiş dönem fon getirisi (pozitif-kapı) Toplam Gelir/
  // Net Tasarruf KPI'larına ve gelir donut'una ("Fon Getirisi" dilimi) eklenir —
  // dashboard ile BİREBİR aynı formül, iki sayfa aynı aylık geliri göstersin.
  // Negatif dönem getirisi eklenmez (fundGain=0); alt-etikette bilgi olarak görünür.
  // Ledger'daki gerçekleşen "Satış Kârı" satırları ayrı yol izler: anahtar açıkken
  // filteredTxs'te kalıp flow.income'a girerler (bkz. buildIncomeCategoryData).
  const fundGain = includeInvestmentIncome && fundPeriodNet > 0 ? fundPeriodNet : 0

  // Taksitli alışverişler raporda BÖLÜNMEZ: tüm taksitler satın alma ayına tek
  // bir toplam gider olarak yazılır (bkz. collapseInstallments). İndirgeme
  // excludeFuture'dan ÖNCE, tüm defter üzerinde yapılmalı — aksi halde henüz
  // gelmemiş taksitler elenir ve toplam eksik çıkar.
  const reportTxs = useMemo(() => collapseInstallments(transactions), [transactions])

  // Analitik akış yüzeylerinin ortak temeli: yalnız İŞLENMİŞ satırlar (isPosted —
  // pending/gelecek tarihli satırlar hiçbir gelir/gider toplamına girmez; bakiye
  // ile aynı kural). Bakiye/net varlık trendleri ham `transactions` okumaya devam
  // eder (kendi excludeFuture'ları var, ghost'ları da bilerek tutarlar; taksitler
  // orada gerçek nakit akışı olarak aya yayılı kalmalı).
  const postedTxs = useMemo(() => excludeFuture(reportTxs), [reportTxs])

  // Base analytic scope: period + account filtered, with ghost balance-
  // reconciliation entries stripped out. Every income/expense aggregate below
  // (KPIs, cash-flow, category & tag donuts, drill-downs) derives from this, so
  // reconciliation never inflates them.
  const filteredTxs = useMemo(() =>
    postedTxs.filter(tx => {
      const d = tx.date.slice(0, 10)
      if (d < dateRange.from || d > dateRange.to) return false
      if (isReconciliation(tx)) return false
      // Satış anaparası ("… Satışı") her durumda akış toplamlarından hariç
      // (isInvestmentPrincipalTx, calcPeriodFlow içinde) — özsermaye geri dönüşü
      // gelir değildir. GERÇEKLEŞEN satış kârı/zararı ("… Satış Kârı/Zararı") ise
      // "Fon getirisi" anahtarı (includeFundGain) KAPALIYKEN gelir/giderden çıkarılır
      // — dashboard ile birebir aynı (isRealizedInvestmentPnlTx); açıkken dahildir.
      if (!includeInvestmentIncome && isRealizedInvestmentPnlTx(tx)) return false
      if (accountId !== 'all') {
        if (tx.accountId !== accountId && tx.toAccountId !== accountId) return false
      }
      return true
    }),
    [postedTxs, dateRange, accountId, includeInvestmentIncome],
  )

  const kpi = useMemo(() => {
    // filteredTxs zaten dönem+hesap filtreli ve mutabakat ayıklanmış; calcPeriodFlow
    // TRY-normalize (baseAmount) + kuruş-exact toplar → dashboard'daki gelir/gider
    // kartlarıyla (calcPeriodFlow/calcMonthlyFlow) birebir aynı sayı.
    //
    // "Toplam Gelir" gerçekleşen nakit geliri gösterir; gerçekleşmemiş fon getirisi
    // (fundGain, mark-to-market) buraya EKLENMEZ — çünkü o dönem-göreceli bir kağıt
    // kazançtır ve "Tüm Zamanlar"da güncel toplam K/Z olduğundan tek bir ayınkinin
    // altında kalabiliyordu (gelir dönem büyüdükçe monoton artmalı). Realize satış
    // kârı/zararı ise anahtar AÇIKKEN dahildir, KAPALIYKEN filteredTxs'te çıkarıldı
    // (dashboard ile aynı aylık gelir). Fon getirisi alt-etikette ayrı gösterilir.
    const flow    = calcPeriodFlow(filteredTxs, dateRange.from, dateRange.to)
    const income  = flow.income
    const expense = flow.expense
    const net     = income - expense
    const rate    = income > 0 ? (net / income) * 100 : 0
    return { income, expense, net, rate }
  }, [filteredTxs, dateRange])

  // Nakit akışı = yalnızca gerçek nakit gelir/gider. Gerçekleşmemiş fon getirisi
  // barlara EKLENMEZ (para hareketi yok) — KPI "Toplam Gelir" değeri de artık
  // yalnız gerçekleşen nakit olduğundan ikisi tam tutarlı.
  const cashFlowData    = useMemo(() => buildCashFlowData(filteredTxs, dateRange), [filteredTxs, dateRange])
  const categoryData    = useMemo(() => buildCategoryData(filteredTxs, categories),                   [filteredTxs, categories])
  const incomeCatData   = useMemo(() => buildIncomeCategoryData(filteredTxs, categories, fundGain),    [filteredTxs, categories, fundGain])
  const tagData         = useMemo(() => buildTagExpenseData(filteredTxs),                             [filteredTxs])
  const topTags         = useMemo(() => tagData.slice(0, 8),                                          [tagData])
  const trendData       = useMemo(
    () => buildTrendData(accounts, transactions, dateRange, accountId, prices, investTxs, fundPrices, debts),
    [accounts, transactions, dateRange, accountId, prices, investTxs, fundPrices, debts],
  )
  // Karşılaştırma: aynı uzunlukta önceki dönem ya da geçen yılın aynı dönemi
  const [compareMode, setCompareMode] = useState<CompareMode>('previous')
  const prevRange       = useMemo(() => comparisonRange(dateRange, compareMode), [dateRange, compareMode])
  const comparisonData  = useMemo(
    () => buildPeriodComparison(postedTxs, categories, dateRange, accountId, prevRange),
    [postedTxs, categories, dateRange, accountId, prevRange],
  )

  const activeTrendCat  = useMemo(() => {
    if (!trendCatKey) return comparisonData[0] ?? null
    return comparisonData.find(r => (r.categoryId ?? '__none__') === trendCatKey) ?? comparisonData[0] ?? null
  }, [trendCatKey, comparisonData])

  const catTrendData    = useMemo(
    () => activeTrendCat ? buildCategoryTrendData(postedTxs, activeTrendCat.categoryId) : [],
    [postedTxs, activeTrendCat],
  )

  const prevPeriodLabel = useMemo(
    () => `${format(parseISO(prevRange.from), 'd MMM', { locale: tr })} – ${format(parseISO(prevRange.to), 'd MMM yy', { locale: tr })}`,
    [prevRange],
  )

  const catFilteredTxs = useMemo(() => {
    if (!selectedCat) return []
    // Bölünmüş satırlar TAM haliyle listelenir (dilim olarak değil): satır
    // gerçek işlemdir, tıklanınca düzenleme açar. Ana tutar seçili kategorinin
    // PAYIDIR, işlemin toplamı altında küçük yazılır (focusCategoryId).
    // tx.icon (yatırım-ikonlu satırlar) donut dilimlerine girmez → listeye de
    // girmez (gelir drill-down'uyla aynı kural).
    return filteredTxs.filter(tx => {
      if (tx.type !== 'expense' || tx.icon) return false
      return selectedCat.categoryId === null
        ? !tx.categoryId
        : txHasCategory(tx, selectedCat.categoryId)
    })
  }, [filteredTxs, selectedCat])

  // Gelir drill-down'u: donut kapsamıyla birebir aynı satırlar — yatırım-ikonlu
  // gelirler (anapara/realize kâr) dilimlere girmediği için listeye de girmez,
  // aksi halde başlıktaki toplam listedekiyle tutmazdı.
  const incomeCatFilteredTxs = useMemo(() => {
    if (!selectedIncomeCat) return []
    return filteredTxs.filter(tx => {
      if (tx.type !== 'income' || tx.icon) return false
      return selectedIncomeCat.categoryId === null
        ? !tx.categoryId
        : txHasCategory(tx, selectedIncomeCat.categoryId)
    })
  }, [filteredTxs, selectedIncomeCat])

  const isLoading = !txsReady || !accountsReady

  // Nakit akışı kartındaki açıklama notu yalnız dönemde taksitli bir satın alma
  // varken gösterilir (aksi halde gereksiz gürültü).
  const hasInstallment = useMemo(() => filteredTxs.some(t => t.isInstallment), [filteredTxs])

  const incomeTotal  = kpi.income + fundGain
  const netTotal     = kpi.net + fundGain
  const rateTotal    = incomeTotal > 0 ? (netTotal / incomeTotal) * 100 : 0
  // Sayaç animasyonu <AnimatedNumber> YAPRAK bileşeninde tutulur; useCountUp bu
  // sayfada DOĞRUDAN çağrılamaz. Hook her karede setState eder: sayfa gövdesinde
  // çağrıldığında 5 sayaç × ~60fps boyunca tüm ReportsPage'i (5 Recharts grafiği,
  // tablolar, TransactionList) yeniden render ediyordu. Grafiklerin kare-başına
  // commit'leri React'in sonsuz-döngü dedektörünü (nested update limiti 50)
  // tetikleyip sayfayı "Maximum update depth exceeded" ile error boundary'ye
  // düşürüyordu — mobilde her genişlikte tekrarlanabilir bir çökme.
  // Yaprak bileşen animasyonu yalnız ilgili <span>'e hapseder.
  // Nakit akışı kartı başlığındaki Net, barlarla (gerçek nakit gelir/gider) tutarlı:
  // gerçekleşmemiş fon getirisi (fundGain) burada YOK — barlar da onu içermez.
  const cashFlowNet     = kpi.net


  return (
    <>
      <Header title="Raporlar" />

      <ReportFilterBar
        preset={preset}
        setPreset={setPreset}
        setNavState={setNavState}
        canNavigate={canNavigate}
        presetOffset={presetOffset}
        setPresetOffset={setPresetOffset}
        periodLabel={periodLabel}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        includeInvestmentIncome={includeInvestmentIncome}
        setIncludeInvestmentIncome={setIncludeInvestmentIncome}
        accountId={accountId}
        setAccountId={setAccountId}
        accounts={accounts}
        resetDrilldown={resetDrilldown}
      />

      <div className="p-6 flex flex-col gap-6 overflow-auto flex-1">

        <KpiCards
          isLoading={isLoading}
          filteredTxs={filteredTxs}
          kpi={kpi}
          incomeTotal={incomeTotal}
          netTotal={netTotal}
          rateTotal={rateTotal}
          includeInvestmentIncome={includeInvestmentIncome}
          fundPeriodNet={fundPeriodNet}
        />

        {/* ── Charts row 1: Cash Flow (tam genişlik) ────────────────── */}
        <div className="grid grid-cols-1 gap-6">

          <CashFlowCard
            isLoading={isLoading}
            cashFlowNet={cashFlowNet}
            cashFlowData={cashFlowData}
            hasInstallment={hasInstallment}
            dateRange={dateRange}
            preset={preset}
            presetOffset={presetOffset}
            periodLabel={periodLabel}
            openDetail={openDetail}
          />

        </div>

        {/* ── Charts row 2: Kategori dağılımları (gider + gelir) ─────── */}
        <CategoryDistributionRow
          isLoading={isLoading}
          categoryData={categoryData}
          incomeCatData={incomeCatData}
          selectedCat={selectedCat}
          setSelectedCat={setSelectedCat}
          activeSliceIdx={activeSliceIdx}
          setActiveSliceIdx={setActiveSliceIdx}
          selectedIncomeCat={selectedIncomeCat}
          setSelectedIncomeCat={setSelectedIncomeCat}
          activeIncomeSliceIdx={activeIncomeSliceIdx}
          setActiveIncomeSliceIdx={setActiveIncomeSliceIdx}
        />

        <CategoryDrilldowns
          isLoading={isLoading}
          selectedCat={selectedCat}
          catFilteredTxs={catFilteredTxs}
          setSelectedCat={setSelectedCat}
          setActiveSliceIdx={setActiveSliceIdx}
          selectedIncomeCat={selectedIncomeCat}
          incomeCatFilteredTxs={incomeCatFilteredTxs}
          setSelectedIncomeCat={setSelectedIncomeCat}
          setActiveIncomeSliceIdx={setActiveIncomeSliceIdx}
        />

        {/* ── Tag Analytics: distribution + top tags ─────────────────── */}
        <TagAnalyticsRow
          isLoading={isLoading}
          tagData={tagData}
          topTags={topTags}
          tagSliceIdx={tagSliceIdx}
          setTagSliceIdx={setTagSliceIdx}
        />

        <BalanceTrendCard isLoading={isLoading} accountId={accountId} trendData={trendData} />

        <AdvancedAnalysisCard
          isLoading={isLoading}
          compareMode={compareMode}
          setCompareMode={setCompareMode}
          prevPeriodLabel={prevPeriodLabel}
          comparisonData={comparisonData}
          trendCatKey={trendCatKey}
          setTrendCatKey={setTrendCatKey}
          activeTrendCat={activeTrendCat}
          catTrendData={catTrendData}
        />

      </div>

      {detail && (
        <CashFlowDetailOverlay
          open={detailOpen}
          from={detail.from}
          to={detail.to}
          label={detail.label}
          transactions={filteredTxs}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  )
}
