'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { BackupManager }  from '@/components/backup/BackupManager'
import { TransactionImportModal } from '@/components/settings/TransactionImportModal'
import { loadDemoData, clearAllData } from '@/lib/seed'
import { scanDemoData, removeDemoData, type DemoScan } from '@/lib/demo-cleanup'
import { transactionsToCsvString, downloadCsv } from '@/lib/utils/csv'
import { useTransactionStore, useCategoryStore } from '@/store'

export default function SettingsPage() {
  const [demoLoading, setDemoLoading]   = useState(false)
  const [clearLoading, setClearLoading] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [importOpen, setImportOpen]     = useState(false)

  const transactions = useTransactionStore(s => s.transactions)
  const categories   = useCategoryStore(s => s.categories)

  function handleExportAllCsv() {
    const csv  = transactionsToCsvString(transactions, categories)
    const date = new Date().toISOString().slice(0, 10)
    downloadCsv(csv, `tum-islemler-${date}.csv`)
  }

  async function handleLoadDemo() {
    setDemoLoading(true)
    try {
      await loadDemoData()
      window.location.reload()
    } catch (err) {
      console.error('[settings:load-demo]', err)
      setDemoLoading(false)
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
    setClearLoading(true)
    try {
      await clearAllData()
      window.location.reload()
    } catch (err) {
      console.error('[settings:clear-all]', err)
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
                <Button
                  size="sm"
                  onClick={handleLoadDemo}
                  loading={demoLoading}
                  className="flex-shrink-0 rounded-xl px-4 h-9"
                >
                  Yükle
                </Button>
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

              {/* Clear all */}
              <div className="flex items-start justify-between gap-4 pt-4 border-t border-border">
                <div>
                  <div className="text-sm font-semibold text-destructive">Tüm Veriyi Sil</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Tüm hesap, işlem, bütçe ve borçları kalıcı olarak siler. Kategoriler korunur.
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {confirmClear ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmClear(false)} className="rounded-xl">
                        İptal
                      </Button>
                      <Button size="sm" variant="danger" onClick={handleClearAll} loading={clearLoading} className="rounded-xl">
                        Evet, Sil
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setConfirmClear(true)} className="rounded-xl">
                      Sıfırla
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Data Management */}
        <Card>
          <CardContent>
            <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-4">Veri Yönetimi</div>

            <div className="flex flex-col gap-4">
              {/* Export all */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold">İşlemleri Dışa Aktar</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Tüm işlemlerinizi CSV dosyası olarak indirin. Excel veya başka bir uygulamada açabilirsiniz.
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleExportAllCsv}
                  disabled={transactions.length === 0}
                  className="flex-shrink-0 rounded-xl px-4 h-9"
                >
                  ↓ CSV İndir
                </Button>
              </div>

              {/* Import */}
              <div className="flex items-start justify-between gap-4 pt-4 border-t border-border">
                <div>
                  <div className="text-sm font-semibold">İşlemleri İçe Aktar</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    CSV dosyasından işlem verisi aktarın. Sütunları eşleştirip doğruladıktan sonra içe aktarılır.
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setImportOpen(true)}
                  className="flex-shrink-0 rounded-xl px-4 h-9"
                >
                  ↑ CSV Yükle
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
