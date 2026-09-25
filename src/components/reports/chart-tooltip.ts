/** Recharts'ın özel tooltip içeriğine (`content={<X />}`) enjekte ettiği
 *  alanlardan raporlarda kullanılanlar. Bileşen element olarak verildiği için
 *  Recharts tipleriyle eşleşme derleyicide denetlenmez; bu tip yalnızca bileşen
 *  içini `any`'siz ve güvenli tutar. */
export interface ChartTooltipProps<P = unknown> {
  active?: boolean
  label?: string | number
  payload?: Array<{ value?: number | string; dataKey?: string | number; payload?: P }>
}

/** Grafik tıklamasında Recharts'ın verdiği aktif nokta indeksi. Recharts 3'te
 *  bu değer SAYI DEĞİL string'tir ("3") — `typeof === 'number'` kontrolü hiç
 *  eşleşmez. Geçersizse null. */
export function chartIndex(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}
