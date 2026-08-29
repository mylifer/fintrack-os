/* ── Yatırımlar görünüm tercihi ──────────────────────────────────────────────
   Kenar çubuğu varyantıyla AYNI kalıp (bkz. lib/sidebar-variant.ts): tercih
   ÇEREZDE tutulur, localStorage'da değil. Kök layout zaten dinamik (headers()
   okuyor), böylece sunucu ilk HTML'i doğru görünümle basar; localStorage olsaydı
   sunucu varsayılanı basar, hidrasyondan sonra seçili görünüme atlardı — sayfa
   her açılışta görünür biçimde sıçrardı.

   Bu dosya sunucu bileşenlerinden de import edildiği için 'use client' YOK ve
   tarayıcıya özgü API kullanmaz. */

export type InvestmentsView = 'console' | 'grouped' | 'alloc' | 'focus'

export const INVESTMENTS_VIEW_COOKIE = 'fintrack-investments-view'
export const DEFAULT_INVESTMENTS_VIEW: InvestmentsView = 'console'

const KEYS: InvestmentsView[] = ['console', 'grouped', 'alloc', 'focus']

/** Çerez değeri bozuk/eksikse varsayılana düşer. */
export function parseInvestmentsView(value: string | undefined | null): InvestmentsView {
  return KEYS.includes(value as InvestmentsView) ? (value as InvestmentsView) : DEFAULT_INVESTMENTS_VIEW
}

export interface InvestmentsViewMeta {
  key: InvestmentsView
  /** Sayfadaki segment düğmesinin etiketi. */
  label: string
  /** Segment düğmesinin title'ı ve sayfa üstündeki tek satırlık açıklama. */
  hint: string
  /** Ayarlar kartındaki uzun açıklama. */
  description: string
}

export const INVESTMENTS_VIEWS: InvestmentsViewMeta[] = [
  {
    key: 'console',
    label: 'Konsol',
    hint: 'Tek yoğun tablo; satıra tıkla, grafiği açılsın',
    description:
      'Tüm pozisyonlar tek yoğun tabloda; her satırda 30 günlük fiyat eğrisi ve pay çubuğu. '
      + 'Satıra tıklayınca o varlığın grafiği satırın altında açılır.',
  },
  {
    key: 'grouped',
    label: 'Sınıf',
    hint: 'Birleşik portföy grafiği + sınıf ara toplamları',
    description:
      'Üstte tek birleşik portföy grafiği (değer ve maliyet bazı), altında Altın / Döviz / Fon '
      + 'diye gruplanmış tablo ve her grubun kendi ara toplamı.',
  },
  {
    key: 'alloc',
    label: 'Dağılım',
    hint: 'Kompozisyon ve yoğunlaşma; sınıfa inilebilir',
    description:
      'Portföyün neyden oluştuğu ana konu: %100 yığılı dağılım çubuğu, yoğunlaşma ölçüleri ve '
      + 'bir sınıfa tıklayınca o kapsama inen grafik ile tablo.',
  },
  {
    key: 'focus',
    label: 'Odak',
    hint: 'Varlık rayı + seçili varlığın tüm detayı',
    description:
      'Solda kompakt varlık rayı, sağda seçili varlığın künyesi, fiyat grafiği ve yalnızca o '
      + 'varlığa ait işlemler.',
  },
]
