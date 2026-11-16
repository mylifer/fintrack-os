'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTransactionStore, useCategoryStore } from '@/store'
import { findInstallmentSplitFixes, type InstallmentSplitScan } from '@/lib/utils/installments'
import { formatCurrency } from '@/lib/utils/currency'

/* Taksitli + bölünmüş alışverişlerde kuruş kaymış kategori paylarını onarır.
   Önce TARA → neyin değişeceği kategori bazında gösterilir → ONAR ile yazılır
   (bildirimdeki "Geri al" ile geri alınabilir). Hesap: findInstallmentSplitFixes. */
export function InstallmentSplitRepair() {
  const transactions = useTransactionStore(s => s.transactions)
  const fixSplits    = useTransactionStore(s => s.fixInstallmentSplits)
  const categories   = useCategoryStore(s => s.categories)
  const catName = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])

  const [scan, setScan]       = useState<InstallmentSplitScan | null>(null)
  const [fixing, setFixing]   = useState(false)
  const [done, setDone]       = useState<number | null>(null)

  function handleScan() {
    setDone(null)
    setScan(findInstallmentSplitFixes(transactions))
  }

  async function handleFix() {
    setFixing(true)
    try {
      setDone(await fixSplits())
      setScan(null)
    } catch (err) {
      console.error('[settings:installment-splits]', err)
    } finally {
      setFixing(false)
    }
  }

  return (
    <div className="pt-4 border-t border-border">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">Taksitli Bölünmüş İşlemlerin Kategori Paylarını Onar</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Eski kayıtlarda kategori payları her taksitte ayrı yuvarlandığı için kategori toplamları birkaç kuruş
            kayabiliyordu (ör. 2.199,00 TL’lik pay 2.198,98 TL). Girdiğin paylar kayıtlı taksitlerden geri hesaplanır ve
            taksitler yeniden dağıtılır. İşlem ve taksit tutarları değişmez.
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={handleScan} className="flex-shrink-0 rounded-xl px-4 h-9">
          Tara
        </Button>
      </div>

      {done !== null && (
        <div className="mt-3 text-xs text-muted-foreground bg-background rounded-lg px-3 py-2">
          {done} taksitli işlemin kategori payları onarıldı. Hemen ardından çıkan bildirimdeki “Geri al” ile birkaç saniye içinde geri alabilirsin.
        </div>
      )}

      {scan && (
        <div className="mt-3 flex flex-col gap-2 bg-background rounded-lg px-3 py-2">
          {scan.fixes.length === 0 ? (
            <div className="text-xs text-muted-foreground">Onarılacak işlem yok — tüm kategori payları tutarlı.</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{scan.fixes.length} taksitli işlem</span>
                  {' '}({scan.fixes.reduce((s, f) => s + f.changes.length, 0)} taksit satırı) onarılacak.
                </div>
                <Button size="sm" onClick={handleFix} loading={fixing} className="flex-shrink-0 rounded-xl">
                  Onar
                </Button>
              </div>
              <ul className="max-h-60 overflow-y-auto flex flex-col gap-2 text-xs">
                {scan.fixes.map(f => (
                  <li key={f.groupId} className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-medium">{f.description || 'Taksitli işlem'}</span>
                      <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                        {formatCurrency(f.total, f.currency)} / {f.changes[0]?.tx.installTotal ?? ''} taksit
                      </span>
                    </div>
                    {f.categories.map(c => (
                      <div key={c.categoryId} className="flex items-center justify-between gap-3 pl-3 text-muted-foreground">
                        <span className="truncate">{catName.get(c.categoryId) ?? 'Kategori'}</span>
                        <span className="flex-shrink-0 tabular-nums">
                          {formatCurrency(c.from, f.currency)} → <span className="text-foreground">{formatCurrency(c.to, f.currency)}</span>
                        </span>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </>
          )}
          {scan.unresolved.length > 0 && (
            <div className="text-xs text-muted-foreground border-t border-border pt-2">
              <span className="font-semibold text-foreground">{scan.unresolved.length} işlem</span> otomatik onarılamadı
              (taksitleri sonradan tek tek değiştirilmiş olabilir). Bunları açıp payları kontrol ederek kaydetmen yeterli:
              <ul className="mt-1 flex flex-col gap-0.5">
                {scan.unresolved.map(u => <li key={u.groupId} className="truncate">· {u.description || 'Taksitli işlem'}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
