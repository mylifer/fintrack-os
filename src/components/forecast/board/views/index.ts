import { ProjectionView } from './ProjectionView'
import { CalendarView } from './CalendarView'
import { LedgerView } from './LedgerView'
import { MonthlyView } from './MonthlyView'
import { CockpitView } from './CockpitView'
import type { ForecastViewProps } from '../shared'

/* Tahmin sayfasının düzen alternatifleri. Kabuk (süre + kapsam seçimi, üst
   bakiye kartı, eksiye düşüş uyarısı, ufuk toplamları) her görünümde aynı
   kalır; buradaki bileşenler yalnız ufkun ANLATIMINI değiştirir — olay kümesi
   ve tutarlar birebir aynı `buildForecast` sonucundan gelir. */
export const FORECAST_VIEWS = [
  { id: 'projection', label: 'Projeksiyon', hint: 'Bakiye eğrisi + yaklaşan işlemler', Comp: ProjectionView },
  { id: 'calendar',   label: 'Takvim',      hint: 'Ay ızgarası, gün gün hareket ve bakiye', Comp: CalendarView },
  { id: 'ledger',     label: 'Defter',      hint: 'Yoğun kolonlu tablo, ufkun tamamı', Comp: LedgerView },
  { id: 'monthly',    label: 'Aylık Şerit', hint: 'Ay ay gelir/gider çubukları', Comp: MonthlyView },
  { id: 'cockpit',    label: 'Kokpit',      hint: 'Ölçüler, hafta ısı şeridi, ağır günler', Comp: CockpitView },
] as const satisfies readonly {
  id: string
  label: string
  hint: string
  Comp: (props: ForecastViewProps) => React.ReactNode
}[]

export type ForecastViewId = typeof FORECAST_VIEWS[number]['id']
