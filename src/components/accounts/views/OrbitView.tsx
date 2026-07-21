'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { TYPE_LABELS, type AccountRow } from './shared'
import type { Account } from '@/types'

// Yörünge yerleşimi: hesaplar merkezdeki "net varlık" çekirdeği etrafında,
// bakiye payına göre boyutlanmış gezegenler olarak halkalara dizilir.
const VB = 1000
const CENTER = VB / 2
const PER_RING = 6

interface Planet {
  row: AccountRow
  x: number
  y: number
  r: number
}

/**
 * Görünüm — Yörünge (Orbit)
 * Net varlık merkezde "güneş"; her hesap payına göre boyutlu bir gezegen ve
 * yörüngesinde döner. Borçlar kırmızı kesikli halkada. Altta bağlantılı efsane.
 */
export function OrbitView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  const router = useRouter()

  const { planets, ringRadii, net } = useMemo(() => {
    const net = rows.reduce((s, r) => s + r.tryBalance, 0)
    const maxAbs = Math.max(...rows.map(r => Math.abs(r.tryBalance)), 1)
    // Paya göre yarıçap (√ ölçek — alan orantısı algısı)
    const rFor = (v: number) => 34 + Math.sqrt(Math.abs(v) / maxAbs) * 66

    const ringCount = Math.ceil(rows.length / PER_RING)
    const ringRadii = Array.from({ length: ringCount }, (_, r) => 190 + r * 165)

    const planets: Planet[] = rows.map((row, i) => {
      const ring = Math.floor(i / PER_RING)
      const inRing = rows.slice(ring * PER_RING, ring * PER_RING + PER_RING).length
      const idxInRing = i - ring * PER_RING
      // Her halka için açı ofseti — hizalanmasınlar
      const angle = (idxInRing / inRing) * Math.PI * 2 + ring * 0.6 - Math.PI / 2
      const orbit = ringRadii[ring]
      return {
        row,
        x: CENTER + Math.cos(angle) * orbit,
        y: CENTER + Math.sin(angle) * orbit,
        r: rFor(row.tryBalance),
      }
    })
    return { planets, ringRadii, net }
  }, [rows])

  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-6 items-start">
      {/* Orbit görseli */}
      <div className="rounded-2xl border border-border bg-gradient-to-b from-secondary/40 to-card overflow-hidden">
        <svg viewBox={`0 0 ${VB} ${VB}`} className="w-full h-auto max-h-[560px]">
          {/* Yörünge halkaları */}
          {ringRadii.map((rad, i) => (
            <circle key={i} cx={CENTER} cy={CENTER} r={rad} fill="none"
              stroke="var(--border)" strokeWidth="1.5" strokeDasharray="2 10" opacity="0.7" />
          ))}

          {/* Bağlantı çizgileri */}
          {planets.map(({ row, x, y }) => (
            <line key={`l-${row.account.id}`} x1={CENTER} y1={CENTER} x2={x} y2={y}
              stroke={row.account.color} strokeWidth="1" opacity="0.18" />
          ))}

          {/* Merkez çekirdek: net varlık */}
          <circle cx={CENTER} cy={CENTER} r="120" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
          <circle cx={CENTER} cy={CENTER} r="120" fill={net >= 0 ? '#16a34a' : 'var(--destructive)'} opacity="0.08" />
          <text x={CENTER} y={CENTER - 10} textAnchor="middle" className="fill-foreground" style={{ fontSize: 46, fontWeight: 700 }}>
            {formatCompact(net)}
          </text>
          <text x={CENTER} y={CENTER + 30} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 24, textTransform: 'uppercase', letterSpacing: 1 }}>
            net varlık
          </text>

          {/* Gezegenler */}
          {planets.map(({ row, x, y, r }) => {
            const { account } = row
            const liability = row.tryBalance < 0
            const initial = account.name.trim()[0]?.toUpperCase() ?? '?'
            return (
              <g key={account.id} className="cursor-pointer" onClick={() => router.push(`/accounts/${account.id}`)}>
                {liability && <circle cx={x} cy={y} r={r + 5} fill="none" stroke="var(--destructive)" strokeWidth="2" strokeDasharray="4 5" />}
                <circle cx={x} cy={y} r={r} fill={account.color} opacity={liability ? 0.85 : 1}>
                  <title>{account.name} · {formatCurrency(account.balance, account.currency)}</title>
                </circle>
                <text x={x} y={y + r * 0.18} textAnchor="middle" fill="#fff" style={{ fontSize: r * 0.7, fontWeight: 700 }}>
                  {initial}
                </text>
                <text x={x} y={y + r + 26} textAnchor="middle" className="fill-foreground" style={{ fontSize: 22, fontWeight: 600 }}>
                  {formatCompact(account.balance, account.currency)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Efsane / liste */}
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {rows.map(({ account }) => (
          <div key={account.id} className="group flex items-center gap-2.5 px-3 py-2.5">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: account.color }} />
            <button onClick={() => router.push(`/accounts/${account.id}`)} className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate text-left flex-1">
              {account.name}
              <span className="block text-[11px] text-muted-foreground font-normal">{TYPE_LABELS[account.type]}</span>
            </button>
            <span className={`text-xs font-semibold tabular-nums ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
              <AnimatedNumber value={account.balance} format={v => formatCompact(v, account.currency)} />
            </span>
            <button onClick={() => onEdit(account)} className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-muted-foreground hover:text-foreground">
              Düzenle
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
