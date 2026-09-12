'use client'

import { useEffect, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { useInvestmentStore, useSettingsStore } from '@/store'
import { isTefasAsset, tefasAsset, tefasCodesIn } from '@/lib/tefas'
import { formatCurrency } from '@/lib/utils/currency'
import { useFundTaxConfig } from '@/store/settings.store'
import { holdingTax } from '@/lib/utils/fund-tax'

/* Ayarlar > TEFAS Fon Stopajı ───────────────────────────────────────────────
   TEFAS'ın yayınladığı birim pay değeri BRÜTTÜR; stopaj payın geri alımında
   (satış) kâr üzerinden kesilir. Bu kart iki şeyi birden sürer:
     • Yatırımlar özetindeki "Net (stopaj sonrası)" satırı
     • Yeni satışlarda otomatik yazılan "… Satış Stopajı" gider kaydı
   Oranı UYGULAMA BİLMEZ, kullanıcı girer: yürürlükteki oran fon türüne ve
   tarihe göre değişir, bazı fonlarda istisna vardır. Kapalıyken hiçbir tutar
   etkilenmez. Tercih bu tarayıcıda saklanır (includeFundGain ile aynı yer). */

/** Oran alanı — boş bırakılınca fon varsayılan orana döner. */
function RateInput({ value, placeholder, onChange, label }: {
  value: string
  placeholder: string
  onChange: (v: string) => void
  label: string
}) {
  return (
    <div className="relative w-[92px] flex-shrink-0">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={100}
        step="0.1"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={e => onChange(e.target.value)}
        className="h-8 w-full rounded-lg border border-input bg-background dark:bg-muted pl-2.5 pr-6 text-sm tabular-nums transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
    </div>
  )
}

export function FundTaxSettings() {
  const enabled       = useSettingsStore(s => s.fundTaxEnabled)
  const setEnabled    = useSettingsStore(s => s.setFundTaxEnabled)
  const defaultRate   = useSettingsStore(s => s.fundTaxDefaultRate)
  const setDefault    = useSettingsStore(s => s.setFundTaxDefaultRate)
  const rates         = useSettingsStore(s => s.fundTaxRates)
  const setRate       = useSettingsStore(s => s.setFundTaxRate)
  const cfg           = useFundTaxConfig()

  const load         = useInvestmentStore(s => s.load)
  const transactions = useInvestmentStore(s => s.transactions)
  const fundPrices   = useInvestmentStore(s => s.fundPrices)
  const getHoldings  = useInvestmentStore(s => s.getHoldings)

  // Ayarlar sayfasına doğrudan girildiyse yatırımlar henüz yüklenmemiş olabilir;
  // fon listesi boş görünmesin diye bir kez yüklenir (salt okuma).
  useEffect(() => {
    if (!transactions.length) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Portföydeki fonlar — açık pozisyonu olmayanlar da listelenir ki tamamen
  // satılmış bir fonun oranı elle korunabilsin.
  const codes = useMemo(
    () => tefasCodesIn(transactions.map(t => t.asset)).sort((a, b) => a.localeCompare(b, 'tr-TR')),
    [transactions],
  )

  // Fon pozisyonları — oran satırlarının yanındaki karşılık tutarları için.
  const fundHoldings = getHoldings().filter(h => isTefasAsset(h.asset))
  const totalTax = fundHoldings.reduce((s, h) => s + holdingTax(h, cfg), 0)

  const noRate = enabled && defaultRate === 0 && Object.keys(rates).length === 0

  return (
    <Card>
      <CardContent>
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-1">
          TEFAS Fon Stopajı
        </div>
        <div className="text-xs text-muted-foreground mb-4">
          TEFAS&apos;ın yayınladığı birim pay değeri <strong>brüttür</strong>: stopaj payı sattığında
          kâr üzerinden kesilir. Bu ayar açıkken Yatırımlar özetine &quot;Net (stopaj sonrası)&quot;
          satırı eklenir ve <strong>yeni</strong> fon satışlarında kârdan hesaplanan kesinti
          &quot;… Satış Stopajı&quot; adıyla Vergi kategorisine gider olarak yazılır.
          Geçmiş kayıtlara dokunulmaz.
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none mb-4">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input accent-primary cursor-pointer"
          />
          <span className="text-sm font-medium text-foreground">Stopajı hesapla</span>
        </label>

        <div className={enabled ? '' : 'opacity-50 pointer-events-none'}>
          <div className="flex items-center justify-between gap-3 py-2 border-t border-border">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">Varsayılan oran</div>
              <div className="text-xs text-muted-foreground">
                Fon bazında oran girilmemiş tüm fonlara uygulanır.
              </div>
            </div>
            <RateInput
              label="Varsayılan stopaj oranı"
              value={defaultRate ? String(defaultRate) : ''}
              placeholder="0"
              onChange={v => setDefault(parseFloat(v) || 0)}
            />
          </div>

          {codes.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Fon bazında oran <span className="font-normal">— boş bırakılırsa varsayılan kullanılır, 0 yazmak istisna demektir</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {codes.map(code => {
                  const h = fundHoldings.find(x => x.asset === tefasAsset(code))
                  const own = rates[code]
                  const tax = h ? holdingTax(h, cfg) : 0
                  return (
                    <div key={code} className="flex items-center gap-3 py-1">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground">
                          {code}
                          {fundPrices[code]?.name && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground truncate">
                              {fundPrices[code].name}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {h && h.pnl > 0
                            ? `Gerçekleşmemiş kâr ${formatCurrency(h.pnl)} · karşılık ${formatCurrency(tax)}`
                            : h
                              ? 'Kâr yok — stopaj hesaplanmaz'
                              : 'Açık pozisyon yok'}
                        </div>
                      </div>
                      <RateInput
                        label={`${code} stopaj oranı`}
                        value={own === undefined ? '' : String(own)}
                        placeholder={String(defaultRate)}
                        onChange={v => setRate(code, v.trim() === '' ? null : (parseFloat(v) || 0))}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {totalTax > 0 && (
            <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground tabular-nums">
              Bugün tüm fonlar satılsaydı toplam stopaj karşılığı:{' '}
              <strong className="text-foreground">{formatCurrency(totalTax)}</strong>
            </div>
          )}
        </div>

        {noRate && (
          <div className="mt-3 text-xs text-amber-600 dark:text-amber-500">
            Oran girilmedi — stopaj %0 hesaplanıyor, yani hiçbir tutar değişmiyor.
            Fonunun tabi olduğu güncel oranı yaz.
          </div>
        )}
        {enabled && (
          <div className="mt-3 text-[11px] text-muted-foreground">
            Oran bilgisi uygulamaya gömülü değildir ve otomatik güncellenmez; yürürlükteki
            oranı kendin doğrula. Hesap fon bazındadır — zarardaki bir fon, kârdaki fonun
            matrahını düşürmez. Satış kesintisi oran o anda neyse ona göre yazılır, sonradan
            oranı değiştirmek eski kayıtları güncellemez.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
