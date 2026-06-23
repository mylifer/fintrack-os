'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CategoryManager } from '@/components/categories/CategoryManager'
import { BackupManager }  from '@/components/backup/BackupManager'
import { loadDemoData, clearAllData } from '@/lib/seed'

export default function SettingsPage() {
  const [demoLoading, setDemoLoading]   = useState(false)
  const [clearLoading, setClearLoading] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  async function handleLoadDemo() {
    setDemoLoading(true)
    await loadDemoData()
    window.location.reload()
  }

  async function handleClearAll() {
    setClearLoading(true)
    await clearAllData()
    window.location.reload()
  }

  return (
    <>
      <Header title="Ayarlar" />

      <div className="p-4 lg:p-6 flex flex-col gap-6">

        {/* App info */}
        <Card>
          <CardContent>
            <div className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted-foreground mb-3">Uygulama</div>
            <div className="text-2xl font-black tracking-[-0.04em] mb-1">
              FINTRACK<span className="text-primary">.</span>OS
            </div>
            <div className="text-xs text-muted-foreground font-mono">Kişisel Bütçe & Finans Takip Platformu · v1.0</div>
            <div className="text-xs text-muted-foreground font-mono mt-1">Veri yerel depolama (IndexedDB) üzerinde saklanır.</div>
          </CardContent>
        </Card>

        {/* Demo & Reset */}
        <Card>
          <CardContent>
            <div className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted-foreground mb-4">Demo & Sıfırlama</div>

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
                  className="flex-shrink-0"
                >
                  Yükle
                </Button>
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
                      <Button size="sm" variant="secondary" onClick={() => setConfirmClear(false)}>
                        İptal
                      </Button>
                      <Button size="sm" variant="danger" onClick={handleClearAll} loading={clearLoading}>
                        Evet, Sil
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setConfirmClear(true)}>
                      Sıfırla
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Backup */}
        <BackupManager />

        {/* Categories */}
        <CategoryManager />

      </div>
    </>
  )
}
