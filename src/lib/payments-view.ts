/* ── Ödeme Takibi görünüm tercihi ────────────────────────────────────────────
   Yatırımlar görünümüyle AYNI kalıp (bkz. lib/investments-view.ts): tercih
   ÇEREZDE tutulur, kök layout sunucuda okur → ilk HTML doğru görünümle basılır,
   hidrasyon sonrası sıçrama olmaz.

   Dört alternatiften (Liste / Takvim / Yıllık Plan / Hesap Akışı) kullanıcı
   Liste ile Yıllık Plan'ı seçti (2026-09-11). Kaldırılan görünümlerin eski çerez
   değerleri ('calendar', 'accounts') parse'ta varsayılana düşer.

   Bu dosya sunucu bileşenlerinden de import edildiği için 'use client' YOK ve
   tarayıcıya özgü API kullanmaz. */

export type PaymentsView = 'list' | 'matrix'

export const PAYMENTS_VIEW_COOKIE = 'fintrack-payments-view'
export const DEFAULT_PAYMENTS_VIEW: PaymentsView = 'list'

const KEYS: PaymentsView[] = ['list', 'matrix']

/** Çerez değeri bozuk/eksikse varsayılana düşer. */
export function parsePaymentsView(value: string | undefined | null): PaymentsView {
  return KEYS.includes(value as PaymentsView) ? (value as PaymentsView) : DEFAULT_PAYMENTS_VIEW
}

export interface PaymentsViewMeta {
  key: PaymentsView
  /** Segment düğmesinin etiketi. */
  label: string
  /** Segment düğmesinin title'ı ve araç çubuğu altındaki tek satırlık açıklama. */
  hint: string
}

export const PAYMENTS_VIEWS: PaymentsViewMeta[] = [
  {
    key: 'list',
    label: 'Liste',
    hint: 'Seçili ayın ödemeleri aciliyete göre gruplu: gecikmiş, yaklaşan, bu ay, ödenenler',
  },
  {
    key: 'matrix',
    label: 'Yıllık Plan',
    hint: 'Her kart ve borç için 12 aylık plan; hücreye tıkla, o ayın tutarını, tarihini ve hesabını düzenle',
  },
]
