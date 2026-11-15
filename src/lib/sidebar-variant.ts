/* ── Kenar çubuğu görünüm tercihi ────────────────────────────────────────────
   Tercih ÇEREZDE tutulur (localStorage değil): kök layout zaten dinamik
   (headers() okuyor), böylece sunucu ilk HTML'i doğru varyantla basar.
   localStorage olsaydı sunucu varsayılanı basar, hidrasyondan sonra diğer
   varyanta atlardı — her sayfa yüklemesinde görünür bir sıçrama.

   Bu dosya sunucu bileşenlerinden de import edildiği için 'use client' YOK ve
   tarayıcıya özgü API kullanmaz. */

export type SidebarVariant = 'compact' | 'refined' | 'floating' | 'contrast' | 'rail' | 'dual'

const ALL: readonly SidebarVariant[] = ['compact', 'refined', 'floating', 'contrast', 'rail', 'dual']

export const SIDEBAR_VARIANT_COOKIE = 'fintrack-sidebar'
export const DEFAULT_SIDEBAR_VARIANT: SidebarVariant = 'compact'

/** Çerez değeri bozuk/eksikse varsayılana düşer. */
export function parseSidebarVariant(value: string | undefined | null): SidebarVariant {
  return ALL.includes(value as SidebarVariant) ? (value as SidebarVariant) : DEFAULT_SIDEBAR_VARIANT
}

export const SIDEBAR_VARIANTS: { key: SidebarVariant; label: string; hint: string }[] = [
  {
    key: 'compact',
    label: 'Kompakt',
    hint: 'Sık satırlar, kılcal ayraçlar, bakiyeler sağda hizalı. Her şey tek ekranda.',
  },
  {
    key: 'refined',
    label: 'Rafine',
    hint: 'Ferah satırlar, yumuşak aksan hapları ve ayrı bir net varlık kartı.',
  },
  {
    key: 'floating',
    label: 'Yüzen Kart',
    hint: 'Kenardan ayrık, köşeleri yuvarlak bir panel. Net varlık en üstte; aktif sayfa dolgun turkuaz hap.',
  },
  {
    key: 'contrast',
    label: 'Koyu Kontrast',
    hint: 'Temadan bağımsız koyu panel, katlanabilir gruplar ve parlayan turkuaz ray.',
  },
  {
    key: 'rail',
    label: 'İkon Rayı',
    hint: 'Yalnızca ikonlardan oluşan dar ray; içerik alanı en geniş hâlinde. Tek tıkla tam genişliğe açılır.',
  },
  {
    key: 'dual',
    label: 'Çift Panel',
    hint: 'Solda dört bölüm rayı, yanında yalnızca seçili bölümün sayfaları. Kısa ve odaklı listeler.',
  },
]
