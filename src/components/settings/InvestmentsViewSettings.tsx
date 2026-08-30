'use client'

import { Card, CardContent } from '@/components/ui/card'
import { useInvestmentsView } from '@/components/layout/InvestmentsViewProvider'
import { INVESTMENTS_VIEWS, type InvestmentsView } from '@/lib/investments-view'

/* Ayarlar > Yatırım Görünümü — kenar çubuğu varyantı kartıyla aynı kalıp
   (AppearanceSettings): mini önizleme + etiket + açıklama, seçim anında
   uygulanır ve çereze yazılır. Yatırımlar sayfasındaki segment seçici ile
   aynı tercihi paylaşır. */

/* Sınıf renkleri gerçek görünümlerdekiyle aynı (Altın/Döviz/Fon) — önizleme
   sayfayla aynı dili konuşsun. Yalnızca dekoratif: ekran okuyuculardan gizli. */
const HUES = ['#d97706', '#2563eb', '#e11d48']

function Bar({ w, tone = 'muted' }: { w: string; tone?: 'muted' | 'ink' }) {
  return (
    <span
      className={`h-1 rounded-full ${tone === 'ink' ? 'bg-foreground/60' : 'bg-muted-foreground/30'}`}
      style={{ width: w }}
    />
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="w-[86px] h-[62px] flex-shrink-0 rounded-lg border border-border bg-background overflow-hidden p-1.5 flex flex-col gap-1"
      aria-hidden
    >
      {children}
    </div>
  )
}

/** Satır: solda sınıf noktası, ortada etiket, sağda tutar. */
function Row({ hue, label, value, extra }: { hue: string; label: string; value: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="size-1 rounded-full flex-shrink-0" style={{ background: hue }} />
      <Bar w={label} />
      {extra}
      <span className="flex-1" />
      <Bar w={value} tone="ink" />
    </div>
  )
}

/** Minik zikzak — satır içi fiyat eğrisi. */
function Spark() {
  return (
    <svg width="14" height="5" viewBox="0 0 14 5" className="flex-shrink-0">
      <path d="M0,4 L3,2.5 L6,3.5 L9,1 L14,0.5" fill="none" stroke="#16a34a" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}

function Preview({ view }: { view: InvestmentsView }) {
  if (view === 'classic') {
    return (
      <Frame>
        {/* dört özet kartı */}
        <div className="grid grid-cols-4 gap-[2px] flex-shrink-0">
          {[0, 1, 2, 3].map(i => (
            <span key={i} className="h-2.5 rounded-[2px] border border-border bg-secondary/70" />
          ))}
        </div>
        {/* varlık başına grafik ızgarası (2×2) */}
        <div className="grid grid-cols-2 gap-[2px] flex-shrink-0">
          {[HUES[0], HUES[1], HUES[1], HUES[2]].map((h, i) => (
            <svg key={i} width="100%" height="11" viewBox="0 0 36 11" preserveAspectRatio="none"
                 className="rounded-[2px] border border-border">
              <path d="M0,8 L9,6 L18,7 L27,3 L36,4 L36,11 L0,11 Z" fill={h} fillOpacity="0.15" />
              <path d="M0,8 L9,6 L18,7 L27,3 L36,4" fill="none" stroke={h} strokeWidth="1" />
            </svg>
          ))}
        </div>
        {/* portföy tablosu */}
        <div className="flex flex-col gap-[3px] border-t border-border pt-[3px]">
          {[0, 1].map(i => (
            <div key={i} className="flex items-center gap-1">
              <Bar w={i ? '16px' : '20px'} />
              <span className="flex-1" />
              <Bar w="12px" tone="ink" />
            </div>
          ))}
        </div>
      </Frame>
    )
  }

  if (view === 'console') {
    return (
      <Frame>
        {[0, 1, 2, 0, 1].map((h, i) => (
          <Row key={i} hue={HUES[h]} label={i % 2 ? '16px' : '20px'} value="12px" extra={<Spark />} />
        ))}
      </Frame>
    )
  }

  if (view === 'grouped') {
    return (
      <Frame>
        {/* birleşik grafik */}
        <svg width="100%" height="18" viewBox="0 0 74 18" preserveAspectRatio="none" className="flex-shrink-0">
          <path d="M0,13 L12,10 L24,12 L36,6 L48,8 L60,3 L74,4 L74,18 L0,18 Z" fill="#0891b2" fillOpacity="0.15" />
          <path d="M0,13 L12,10 L24,12 L36,6 L48,8 L60,3 L74,4" fill="none" stroke="#0891b2" strokeWidth="1.2" />
        </svg>
        {/* grup başlığı + iki satır + ara toplam */}
        <div className="flex items-center gap-1">
          <span className="w-0.5 h-2 rounded-full" style={{ background: HUES[0] }} />
          <Bar w="14px" tone="ink" />
        </div>
        <Row hue={HUES[0]} label="16px" value="12px" />
        <div className="flex items-center gap-1 border-t border-border pt-0.5">
          <Bar w="18px" />
          <span className="flex-1" />
          <Bar w="14px" tone="ink" />
        </div>
      </Frame>
    )
  }

  if (view === 'alloc') {
    return (
      <Frame>
        {/* %100 yığılı dağılım çubuğu */}
        <div className="flex gap-[2px] h-2 flex-shrink-0">
          <span className="rounded-[2px]" style={{ background: HUES[0], width: '55%' }} />
          <span className="rounded-[2px]" style={{ background: HUES[1], width: '33%' }} />
          <span className="rounded-[2px]" style={{ background: HUES[2], width: '12%' }} />
        </div>
        {/* açıklama */}
        <div className="flex items-center gap-1">
          {HUES.map(h => (
            <span key={h} className="flex items-center gap-0.5">
              <span className="size-1 rounded-full" style={{ background: h }} />
              <Bar w="8px" />
            </span>
          ))}
        </div>
        {[0, 1, 2].map((h, i) => (
          <Row key={i} hue={HUES[h]} label="18px" value="12px" />
        ))}
      </Frame>
    )
  }

  // Odak — solda ray, sağda detay
  return (
    <Frame>
      <div className="flex gap-1 h-full">
        <div className="w-[26px] flex flex-col gap-[3px] border-r border-border pr-1">
          {[0, 1, 2, 0].map((h, i) => (
            <div key={i} className={`flex items-center gap-0.5 rounded-[2px] ${i === 0 ? 'bg-secondary' : ''}`}>
              <span className="size-1 rounded-full flex-shrink-0" style={{ background: HUES[h] }} />
              <Bar w="12px" tone={i === 0 ? 'ink' : 'muted'} />
            </div>
          ))}
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <Bar w="24px" tone="ink" />
          <svg width="100%" height="14" viewBox="0 0 44 14" preserveAspectRatio="none">
            <path d="M0,10 L8,7 L16,9 L24,4 L32,6 L44,2 L44,14 L0,14 Z" fill={HUES[0]} fillOpacity="0.15" />
            <path d="M0,10 L8,7 L16,9 L24,4 L32,6 L44,2" fill="none" stroke={HUES[0]} strokeWidth="1.2" />
          </svg>
          <Bar w="30px" />
          <Bar w="22px" />
        </div>
      </div>
    </Frame>
  )
}

export function InvestmentsViewSettings() {
  const { view, setView } = useInvestmentsView()

  return (
    <Card>
      <CardContent>
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-1">
          Yatırım Görünümü
        </div>
        <div className="text-xs text-muted-foreground mb-4">
          Yatırımlar sayfasının düzeni. Dördü de aynı kolonları ve aynı tutarları gösterir;
          değişen yalnızca sunum. Seçim anında uygulanır ve bu tarayıcıda hatırlanır —
          sayfanın üstündeki seçiciden de değiştirebilirsin.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {INVESTMENTS_VIEWS.map(option => {
            const selected = view === option.key
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setView(option.key)}
                aria-pressed={selected}
                className={[
                  'flex gap-3 items-start text-left p-3 rounded-xl border transition-colors',
                  selected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-accent',
                ].join(' ')}
              >
                <Preview view={option.key} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">{option.label}</span>
                    {option.key === 'classic' && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Varsayılan
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{option.description}</div>
                  {selected && (
                    <div className="text-[11px] font-semibold text-foreground mt-1.5">✓ Seçili</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
