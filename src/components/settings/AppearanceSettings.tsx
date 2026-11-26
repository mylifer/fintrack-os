'use client'

import { Card, CardContent } from '@/components/ui/card'
import { useSidebarVariant } from '@/components/layout/SidebarVariantProvider'
import { DEFAULT_SIDEBAR_VARIANT, SIDEBAR_VARIANTS, type SidebarVariant } from '@/lib/sidebar-variant'

/* Minik önizleme: gerçek kenar çubuğunun oran ve ritmini taklit eder —
   çift panelde bölüm rayı + liste, rafinede grup başlığı + yuvarlak aksan hapı. Yalnızca dekoratif olduğu için ekran okuyuculardan gizli. */
function Preview({ variant }: { variant: SidebarVariant }) {
  const bar = (w: string, muted = true) => (
    <span className={`h-1 rounded-full ${muted ? 'bg-muted-foreground/30' : 'bg-foreground/60'}`} style={{ width: w }} />
  )

  if (variant === 'compact') {
    return (
      <div className="w-[86px] flex-shrink-0 rounded-lg border border-border bg-background overflow-hidden" aria-hidden>
        <div className="h-4 border-b border-border flex items-center gap-1 px-1.5">
          <span className="w-1.5 h-1.5 rounded-[2px] bg-primary" />
          {bar('26px')}
        </div>
        <div className="py-1 flex flex-col">
          <div className="px-1.5 py-0.5 flex items-center gap-1">{bar('14px')}<span className="flex-1 h-px bg-border" /></div>
          {[0, 1, 2].map(i => (
            <div key={i} className="h-2.5 flex items-center gap-1 px-1.5">{bar(i === 1 ? '30px' : '24px')}</div>
          ))}
          <div className="h-2.5 flex items-center gap-1 px-1.5 bg-secondary relative">
            <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary" />
            {bar('28px', false)}
          </div>
          {[0, 1].map(i => (
            <div key={i} className="h-2.5 flex items-center gap-1 px-1.5">{bar(i === 0 ? '22px' : '30px')}</div>
          ))}
          <div className="px-1.5 py-0.5 flex items-center gap-1">{bar('12px')}<span className="flex-1 h-px bg-border" /></div>
          {[0, 1].map(i => (
            <div key={i} className="h-2.5 flex items-center gap-1 px-1.5">{bar(i === 0 ? '26px' : '20px')}</div>
          ))}
        </div>
      </div>
    )
  }

  if (variant === 'dual') {
    return (
      <div className="w-[86px] flex-shrink-0 rounded-lg border border-border bg-background overflow-hidden flex" aria-hidden>
        <div className="w-[20px] border-r border-border flex flex-col items-center gap-1.5 py-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px] bg-primary" />
          {[0, 1, 2, 3].map(i => (
            <span key={i} className={`w-3 h-3 rounded-[4px] ${i === 1 ? 'bg-primary/40' : 'bg-muted-foreground/25'}`} />
          ))}
        </div>
        <div className="flex-1 bg-muted/60 p-1.5 flex flex-col gap-1">
          <span className="h-1.5 w-[26px] rounded-full bg-foreground/60" />
          <div className="h-3 flex items-center px-1 rounded bg-background ring-1 ring-border">{bar('30px', false)}</div>
          {[0, 1, 2].map(i => <div key={i} className="h-3 flex items-center px-1">{bar(i === 1 ? '24px' : '32px')}</div>)}
        </div>
      </div>
    )
  }

  return (
    <div className="w-[86px] flex-shrink-0 rounded-lg border border-border bg-background overflow-hidden" aria-hidden>
      <div className="px-1.5 pt-2 pb-1 flex items-center gap-1">
        <span className="w-2.5 h-2.5 rounded-[3px] bg-primary" />
        {bar('24px')}
      </div>
      <div className="px-1.5 pb-1.5 flex flex-col gap-1">
        <div className="pt-1">{bar('14px')}</div>
        {[0, 1].map(i => (
          <div key={i} className="h-3.5 flex items-center px-1">{bar(i === 0 ? '30px' : '24px')}</div>
        ))}
        <div className="h-3.5 flex items-center px-1 rounded-md bg-primary/15">{bar('28px', false)}</div>
        <div className="pt-0.5">{bar('12px')}</div>
        <div className="h-3.5 flex items-center px-1">{bar('26px')}</div>
        <div className="mt-0.5 rounded-md border border-border bg-muted px-1 py-1 flex flex-col gap-0.5">
          {bar('16px')}
          <span className="h-1.5 w-[34px] rounded-full bg-foreground/50" />
        </div>
      </div>
    </div>
  )
}

export function AppearanceSettings() {
  const { variant, setVariant } = useSidebarVariant()

  return (
    <Card>
      <CardContent>
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-1">Görünüm</div>
        <div className="text-xs text-muted-foreground mb-4">
          Kenar çubuğu düzeni. Seçim anında uygulanır ve bu tarayıcıda hatırlanır.
          Kenar çubuğu yalnızca geniş ekranlarda görünür; mobilde alt menü kullanılır.
        </div>

        {/* Kart dikey: önizleme üstte, metin altta. Yan yana dizilimde dar
            sütunda metin 5–6 karaktere sıkışıyor ve rozet taşıyordu. */}
        <div role="radiogroup" aria-label="Kenar çubuğu düzeni" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SIDEBAR_VARIANTS.map(option => {
            const selected = variant === option.key
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                onClick={() => setVariant(option.key)}
                aria-checked={selected}
                className={[
                  'flex flex-col text-left p-3 rounded-xl border transition-colors',
                  selected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-muted-foreground/40 hover:bg-accent',
                ].join(' ')}
              >
                <div className="flex items-center justify-center rounded-lg bg-muted/50 py-4">
                  <Preview variant={option.key} />
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-sm font-semibold">{option.label}</span>
                  {option.key === DEFAULT_SIDEBAR_VARIANT && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      Varsayılan
                    </span>
                  )}
                  <span
                    aria-hidden
                    className={[
                      'ml-auto w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                      selected ? 'border-primary' : 'border-muted-foreground/40',
                    ].join(' ')}
                  >
                    {selected && <span className="w-2 h-2 rounded-full bg-primary" />}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{option.hint}</div>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
