'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatCompact } from '@/lib/utils/currency'
import { TYPE_LABELS, type AccountRow } from './shared'
import type { Account } from '@/types'

/**
 * Görünüm — Silüet (Skyline)
 * Ortadaki ufuk çizgisinden yukarı doğru varlıklar, aşağı doğru borçlar birer
 * "bina" olarak yükselir; yükseklik bakiyeye orantılı (√ ölçek). Bina yüzünde
 * ışıklı "pencereler". Varlık/borç dengesini tek bakışta gösterir.
 */
export function SkylineView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  const sorted = useMemo(() => {
    const maxAbs = Math.max(...rows.map(r => Math.abs(r.tryBalance)), 1)
    // Borçlar sağa, varlıklar sola; her grup kendi içinde büyükten küçüğe
    const assets = rows.filter(r => r.tryBalance >= 0).sort((a, b) => b.tryBalance - a.tryBalance)
    const debts  = rows.filter(r => r.tryBalance < 0).sort((a, b) => a.tryBalance - b.tryBalance)
    return { list: [...assets, ...debts], maxAbs }
  }, [rows])

  const HALF = 150 // px, ufkun bir yanındaki azami bina yüksekliği

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-b from-sky-500/5 via-card to-card overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-fit px-6 py-6">
          <div className="flex items-stretch gap-3" style={{ minWidth: 'max-content' }}>
            {sorted.list.map(({ account, tryBalance }) => {
              const debt = tryBalance < 0
              const h = Math.max(16, Math.sqrt(Math.abs(tryBalance) / sorted.maxAbs) * HALF)
              // Bina "pencereleri" — yüksekliğe göre sıra sayısı
              const floors = Math.max(1, Math.round(h / 22))
              return (
                <div key={account.id} className="group flex flex-col items-center" style={{ width: 84 }}>
                  {/* Üst değer (varlık) */}
                  <div className="h-10 flex items-end justify-center pb-1">
                    {!debt && (
                      <span className="text-xs font-semibold tabular-nums text-foreground whitespace-nowrap">
                        <AnimatedNumber value={account.balance} format={v => formatCompact(v, account.currency)} />
                      </span>
                    )}
                  </div>

                  {/* Ufkun ÜSTÜ (varlık binası) */}
                  <div className="w-full flex items-end justify-center" style={{ height: HALF }}>
                    {!debt && (
                      <BuildingBar color={account.color} height={h} floors={floors} onClick={() => onEdit(account)} up />
                    )}
                  </div>

                  {/* Ufuk çizgisi + isim */}
                  <div className="w-full border-t-2 border-foreground/25 relative">
                    <Link href={`/accounts/${account.id}`} className="block text-center pt-1.5">
                      <span className="text-[11px] font-medium text-foreground group-hover:text-primary transition-colors truncate block">{account.name}</span>
                      <span className="text-[10px] text-muted-foreground">{TYPE_LABELS[account.type]}</span>
                    </Link>
                  </div>

                  {/* Ufkun ALTI (borç binası) */}
                  <div className="w-full flex items-start justify-center" style={{ height: HALF }}>
                    {debt && (
                      <BuildingBar color="var(--destructive)" height={h} floors={floors} onClick={() => onEdit(account)} up={false} />
                    )}
                  </div>

                  {/* Alt değer (borç) */}
                  <div className="h-10 flex items-start justify-center pt-1">
                    {debt && (
                      <span className="text-xs font-semibold tabular-nums text-destructive whitespace-nowrap">
                        <AnimatedNumber value={account.balance} format={v => formatCompact(v, account.currency)} />
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function BuildingBar({ color, height, floors, up, onClick }: {
  color: string; height: number; floors: number; up: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title="Düzenle"
      className={`relative w-11 overflow-hidden transition-all hover:brightness-110 ${up ? 'rounded-t-md' : 'rounded-b-md'}`}
      style={{ height, background: `linear-gradient(${up ? 180 : 0}deg, ${color} 0%, ${color}cc 100%)` }}
    >
      {/* Pencereler */}
      <div className="absolute inset-0 p-1.5 grid grid-cols-2 gap-1 content-start">
        {Array.from({ length: Math.min(floors * 2, 12) }).map((_, i) => (
          <span key={i} className="h-1.5 rounded-[1px] bg-white/35" />
        ))}
      </div>
    </button>
  )
}
