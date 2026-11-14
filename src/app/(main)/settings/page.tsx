'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { BackupManager }  from '@/components/backup/BackupManager'
import { TransactionImportModal } from '@/components/settings/TransactionImportModal'
import { WorkspaceManager } from '@/components/settings/WorkspaceManager'
import { SharingSettings } from '@/components/settings/SharingSettings'
import { AccountSettings } from '@/components/settings/AccountSettings'
import { PrivacySettings } from '@/components/settings/PrivacySettings'
import { AppearanceSettings } from '@/components/settings/AppearanceSettings'
import { InvestmentsViewSettings } from '@/components/settings/InvestmentsViewSettings'
import { FundTaxSettings } from '@/components/settings/FundTaxSettings'
import { loadDemoData, clearAllData } from '@/lib/seed'
import { scanDemoData, removeDemoData, type DemoScan } from '@/lib/demo-cleanup'
import { SelectField } from '@/components/ui/Select'
import { transactionsToCsvString, downloadCsv, csvFilenameSlug } from '@/lib/utils/csv'
import { txTouchesAccount } from '@/lib/utils/calculations'
import { useTransactionStore, useCategoryStore, useAccountStore } from '@/store'
import { findInstallmentRoundingFixes, type InstallmentRoundingFix } from '@/lib/utils/installments'
import { formatCurrency } from '@/lib/utils/currency'

const ALL_ACCOUNTS = ''

export default function SettingsPage() {
  const [demoLoading, setDemoLoading]   = useState(false)
  const [confirmDemo, setConfirmDemo]   = useState(false)
  const [clearLoading, setClearLoading] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearPhrase, setClearPhrase]   = useState('')
  const [clearError, setClearError]     = useState<string | null>(null)
  const [importOpen, setImportOpen]     = useState(false)
  const [exportAccountId, setExportAccountId] = useState<string>(ALL_ACCOUNTS)

  const transactions = useTransactionStore(s => s.transactions)
  const categories   = useCategoryStore(s => s.categories)
  const accounts     = useAccountStore(s => s.accounts)

  // Arşiv hesapların işlemleri de dışa aktarılabilir olmalı; listede sona
  // alınıp etiketlenir.
  const exportAccounts = useMemo(
    () => [...accounts].sort((a, b) =>
      Number(a.isArchived) - Number(b.isArchived) || a.name.localeCompare(b.name, 'tr-TR'),
    ),
    [accounts],
  )

  // Transferin iki bacağı da ilgili hesaba sayılır (txTouchesAccount).
  const txCountByAccount = useMemo(() => {
    const counts = new Map<string, number>()
    for (const tx of transactions) {
      counts.set(tx.accountId, (counts.get(tx.accountId) ?? 0) + 1)
      if (tx.toAccountId && tx.toAccountId !== tx.accountId) {
        counts.set(tx.toAccountId, (counts.get(tx.toAccountId) ?? 0) + 1)
      }
    }
    return counts
  }, [transactions])

  const exportOptions = useMemo(() => [
    { value: ALL_ACCOUNTS, label: `Tüm hesaplar (${transactions.length} işlem)` },
    ...exportAccounts.map(a => ({
      value: a.id,
      label: `${a.name}${a.isArchived ? ' (arşiv)' : ''} — ${txCountByAccount.get(a.id) ?? 0} işlem`,
    })),
  ], [exportAccounts, txCountByAccount, transactions.length])

  const exportCount = exportAccountId === ALL_ACCOUNTS
    ? transactions.length
    : txCountByAccount.get(exportAccountId) ?? 0

  function handleExportCsv() {
    const account = exportAccountId === ALL_ACCOUNTS
      ? undefined
      : accounts.find(a => a.id === exportAccountId)
    // Seçilen hesap silinmiş/değişmişse tüm işlemlere düşmek yerine iptal et.
    if (exportAccountId !== ALL_ACCOUNTS && !account) return

    const rows = account
      ? transactions.filter(tx => txTouchesAccount(tx, account.id))
      : transactions
    if (rows.length === 0) return

    const csv  = transactionsToCsvString(rows, categories, accounts)
    const date = new Date().toISOString().slice(0, 10)
    downloadCsv(
      csv,
      account ? `islemler-${csvFilenameSlug(account.name)}-${date}.csv` : `tum-islemler-${date}.csv`,
    )
  }

  async function handleLoadDemo() {
    setDemoLoading(true)
    try {
      await loadDemoData()
      window.location.reload()
    } catch (err) {
      console.error('[settings:load-demo]', err)
      setDemoLoading(false)
      setConfirmDemo(false)
    }
  }

  // Taksit kuruş düzeltmesi: eski yuvarlamayla (kalan ilk taksitlere dağıtılmış)
  // bölünmüş grupları bankanın kuralına (kalan tamamen 1. taksite) çevirir.
  const fixInstallmentRounding = useTransactionStore(s => s.fixInstallmentRounding)
  const [roundingFixes, setRoundingFixes] = useState<InstallmentRoundingFix[] | null>(null)
  const [roundingFixing, setRoundingFixing] = useState(false)
  const [roundingDone, setRoundingDone]   = useState<number | null>(null)

  function handleRoundingScan() {
    setRoundingDone(null)
    setRoundingFixes(findInstallmentRoundingFixes(transactions))
  }

  async function handleRoundingFix() {
    setRoundingFixing(true)
    try {
      const n = await fixInstallmentRounding()
      setRoundingDone(n)
      setRoundingFixes(null)
    } catch (err) {
      console.error('[settings:installment-rounding]', err)
    } finally {
      setRoundingFixing(false)
    }
  }

  const [demoScan, setDemoScan]           = useState<DemoScan | null>(null)
  const [demoScanLoading, setScanLoading] = useState(false)
  const [demoRemoving, setDemoRemoving]   = useState(false)

  async function handleDemoScan() {
    setScanLoading(true)
    try {
      setDemoScan(await scanDemoData())
    } catch (err) {
      console.error('[settings:demo-scan]', err)
    } finally {
      setScanLoading(false)
    }
  }

  async function handleDemoRemove() {
    if (!demoScan || demoScan.total === 0) return
    setDemoRemoving(true)
    try {
      await removeDemoData(demoScan)
      window.location.reload()
    } catch (err) {
      console.error('[settings:demo-remove]', err)
      setDemoRemoving(false)
    }
  }

  async function handleClearAll() {
    if (clearPhrase.trim().toLocaleUpperCase('tr-TR') !== 'SİL') return
    setClearLoading(true)
    setClearError(null)
    try {
      await clearAllData()
      window.location.reload()
    } catch (err) {
      // clearAllData silmeden ÖNCE güvenlik yedeği alır; yedek başarısızsa
      // hiçbir şey silinmeden buraya düşer — kullanıcıya nedenini göster.
      console.error('[settings:clear-all]', err)
      setClearError(err instanceof Error ? err.message : 'Silme başarısız — hiçbir veri silinmedi.')
      setClearLoading(false)
    }
  }

  return (
    <>
      <Header title="Ayarlar" />

      <div className="p-6 flex flex-col gap-6 max-w-2xl mx-auto">

        {/* App info */}
        <Card>
          <CardContent>
            <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-3">Uygulama</div>
            <div className="text-2xl font-semibold mb-1">
              FINTRACK<span className="text-primary">.</span>OS
            </div>
            <div className="text-xs text-muted-foreground">Kişisel Bütçe & Finans Takip Platformu · v1.0</div>
            <div className="text-xs text-muted-foreground mt-1">Veri yerel depolama (IndexedDB) üzerinde saklanır.</div>
          </CardContent>
        </Card>

        {/* Hesap — şifre, e-posta, iki adımlı doğrulama, hesap silme */}
        <AccountSettings />

        {/* Gizlilik — tutarları gizle, çevrimiçi logo, PIN kilidi */}
        <PrivacySettings />

        {/* Görünüm — kenar çubuğu varyantı */}
        <AppearanceSettings />

        {/* Görünüm — Yatırımlar sayfası düzeni */}
        <InvestmentsViewSettings />

        {/* İşlem Kuralları — yönetim ekranı Kategoriler altında */}
        <Card>
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-2">İşlem Kuralları</div>
                <div className="text-xs text-muted-foreground">
                  Açıklamaya (ve isteğe bağlı hesap/tutara) göre işlemlere otomatik kategori, etiket ve alıcı önerir —
                  işlem formunda ve ekstre içe aktarmada.
                </div>
              </div>
              <Link
                href="/categories/rules"
                className={`${buttonVariants({ variant: 'secondary', size: 'sm' })} flex-shrink-0 rounded-xl px-4 h-9`}
              >
                Kuralları yönet
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* ── TEFAS fon stopajı ───────────────────────────────── */}
        <FundTaxSettings />

        {/* Çalışma Alanları */}
        <WorkspaceManager />
        <SharingSettings />

        {/* Demo & Reset */}
        <Card>
          <CardContent>
            <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-4">Demo & Sıfırlama</div>

            <div className="flex flex-col gap-4">
              {/* Load demo */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold">Demo Veri Yükle</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    6 aylık örnek işlem, hesap, bütçe ve borç yükler (Ocak–Haziran 2026)
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {confirmDemo ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmDemo(false)} className="rounded-xl">
                        İptal
                      </Button>
                      <Button size="sm" onClick={handleLoadDemo} loading={demoLoading} className="rounded-xl px-4 h-9">
                        Evet, Yükle
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setConfirmDemo(true)}
                      className="rounded-xl px-4 h-9"
                    >
                      Yükle
                    </Button>
                  )}
                </div>
              </div>

              {/* Demo leftovers scan & remove */}
              <div className="pt-4 border-t border-border">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">Demo Kalıntılarını Temizle</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Geçmişte yüklenmiş demo kayıtlarını (Garanti BBVA Vadesiz vb.) bulur;
                      onayınla hem bu cihazdan hem buluttan kaldırır. Kendi kayıtlarına dokunmaz.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleDemoScan}
                    loading={demoScanLoading}
                    className="flex-shrink-0 rounded-xl px-4 h-9"
                  >
                    Tara
                  </Button>
                </div>
                {demoScan && (
                  demoScan.total === 0 ? (
                    <div className="mt-3 text-xs text-muted-foreground bg-background rounded-lg px-3 py-2">
                      Demo kalıntısı bulunamadı.
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center justify-between gap-3 bg-background rounded-lg px-3 py-2">
                      <div className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{demoScan.total} demo kaydı bulundu: </span>
                        {[
                          demoScan.accounts     && `${demoScan.accounts} hesap`,
                          demoScan.people       && `${demoScan.people} kişi`,
                          demoScan.transactions && `${demoScan.transactions} işlem`,
                          demoScan.budgets      && `${demoScan.budgets} bütçe`,
                          demoScan.debts        && `${demoScan.debts} borç`,
                          demoScan.recurring    && `${demoScan.recurring} tekrarlayan`,
                          demoScan.investments  && `${demoScan.investments} yatırım`,
                        ].filter(Boolean).join(', ')}
                      </div>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={handleDemoRemove}
                        loading={demoRemoving}
                        className="flex-shrink-0 rounded-xl"
                      >
                        Kaldır
                      </Button>
                    </div>
                  )
                )}
              </div>

              {/* Clear all — yazılı onay ister; silmeden önce otomatik güvenlik yedeği alınır */}
              <div className="pt-4 border-t border-border">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-destructive">Tüm Veriyi Sil</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Tüm hesap, işlem, bütçe ve borçları kalıcı olarak siler. Kategoriler korunur.
                      Silmeden önce buluta otomatik güvenlik yedeği alınır.
                    </div>
                  </div>
                  {!confirmClear && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => { setConfirmClear(true); setClearPhrase(''); setClearError(null) }}
                      className="rounded-xl flex-shrink-0"
                    >
                      Sıfırla
                    </Button>
                  )}
                </div>
                {confirmClear && (
                  <div className="mt-3 bg-background rounded-lg px-3 py-3">
                    <div className="text-xs text-muted-foreground mb-2">
                      Onaylamak için <span className="font-mono font-bold text-destructive">SİL</span> yazın:
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={clearPhrase}
                        onChange={e => setClearPhrase(e.target.value)}
                        placeholder="SİL"
                        className="w-24 border border-border px-2 py-1.5 text-sm bg-card text-foreground focus:border-destructive outline-none rounded-lg font-mono"
                      />
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={handleClearAll}
                        loading={clearLoading}
                        disabled={clearPhrase.trim().toLocaleUpperCase('tr-TR') !== 'SİL'}
                        className="rounded-xl"
                      >
                        Kalıcı Olarak Sil
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => { setConfirmClear(false); setClearPhrase(''); setClearError(null) }} className="rounded-xl">
                        İptal
                      </Button>
                    </div>
                    {clearError && (
                      <div className="mt-2 text-xs text-destructive">
                        {clearError} — hiçbir veri silinmedi.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Data Management */}
        <Card>
          <CardContent>
            <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-4">Veri Yönetimi</div>

            <div className="flex flex-col gap-4">
              {/* Export — tüm işlemler ya da tek hesap */}
              <div>
                <div className="text-sm font-semibold">İşlemleri Dışa Aktar</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Tüm işlemlerinizi ya da tek bir hesabın işlemlerini CSV dosyası olarak indirin.
                  Excel veya başka bir uygulamada açabilirsiniz.
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <SelectField
                    value={exportAccountId}
                    onChange={e => setExportAccountId(e.target.value)}
                    options={exportOptions}
                    className="flex-1 min-w-0"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleExportCsv}
                    disabled={exportCount === 0}
                    className="flex-shrink-0 rounded-xl px-4 h-9"
                  >
                    ↓ CSV İndir
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  {exportCount === 0
                    ? 'Bu seçimde dışa aktarılacak işlem yok.'
                    : exportAccountId === ALL_ACCOUNTS
                      ? `${exportCount} işlem indirilecek.`
                      : `${exportCount} işlem indirilecek — hesaplar arası transferlerin her iki bacağı da dahildir.`}
                </div>
              </div>

              {/* Taksit kuruşlarını bankayla eşitle */}
              <div className="pt-4 border-t border-border">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">Taksit Kuruşlarını Bankayla Eşitle</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Bankalar artan kuruşun tamamını 1. taksite ekler (ör. 15.413 TL / 9 → 1.712,60 + 8 × 1.712,55).
                      Eski kayıtlarda kuruşlar ilk taksitlere dağıtılmıştı; bu, ekstreyle birkaç kuruş fark yaratır.
                      Toplam tutarlar değişmez, elle girdiğin özel tutarlara dokunulmaz.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleRoundingScan}
                    className="flex-shrink-0 rounded-xl px-4 h-9"
                  >
                    Tara
                  </Button>
                </div>
                {roundingDone !== null && (
                  <div className="mt-3 text-xs text-muted-foreground bg-background rounded-lg px-3 py-2">
                    {roundingDone} taksitli işlem düzeltildi. Hemen ardından çıkan bildirimdeki “Geri al” ile birkaç saniye içinde geri alabilirsin.
                  </div>
                )}
                {roundingFixes && (
                  roundingFixes.length === 0 ? (
                    <div className="mt-3 text-xs text-muted-foreground bg-background rounded-lg px-3 py-2">
                      Düzeltilecek taksitli işlem yok — hepsi banka kuralıyla bölünmüş.
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-col gap-2 bg-background rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">{roundingFixes.length} taksitli işlem</span>
                          {' '}({roundingFixes.reduce((s, f) => s + f.changes.length, 0)} taksit satırı) düzeltilecek.
                        </div>
                        <Button
                          size="sm"
                          onClick={handleRoundingFix}
                          loading={roundingFixing}
                          className="flex-shrink-0 rounded-xl"
                        >
                          Düzelt
                        </Button>
                      </div>
                      <ul className="max-h-40 overflow-y-auto flex flex-col gap-1 text-xs">
                        {roundingFixes.map(f => {
                          const first = f.changes.find(c => c.tx.installIndex === 1)
                          return (
                            <li key={f.groupId} className="flex items-center justify-between gap-3">
                              <span className="truncate">{f.description || 'Taksitli işlem'}</span>
                              <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                                {formatCurrency(f.total, f.changes[0].tx.currency)} / {f.changes[0].tx.installTotal}
                                {first && <> · 1. taksit {formatCurrency(first.tx.amount, first.tx.currency)} → {formatCurrency(first.amount, first.tx.currency)}</>}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                )}
              </div>

              {/* Import */}
              <div className="flex items-start justify-between gap-4 pt-4 border-t border-border">
                <div>
                  <div className="text-sm font-semibold">İşlemleri İçe Aktar</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Banka dökümü ya da kart ekstresi yükleyin (CSV veya Excel .xlsx). Sütunları eşleştirip satırları gözden geçirdikten sonra içe aktarılır.
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setImportOpen(true)}
                  className="flex-shrink-0 rounded-xl px-4 h-9"
                >
                  ↑ Dosya Yükle
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Backup */}
        <BackupManager />

      </div>

      <TransactionImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  )
}
