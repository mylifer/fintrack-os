/* ── Kenar çubuğu görünüm tercihi ────────────────────────────────────────────
   Tercih ÇEREZDE tutulur (localStorage değil): kök layout zaten dinamik
   (headers() okuyor), böylece sunucu ilk HTML'i doğru varyantla basar.
   localStorage olsaydı sunucu varsayılanı basar, hidrasyondan sonra diğer
   varyanta atlardı — her sayfa yüklemesinde görünür bir sıçrama.

   Bu dosya sunucu bileşenlerinden de import edildiği için 'use client' YOK ve
   tarayıcıya özgü API kullanmaz. */

export type SidebarVariant = 'compact' | 'refined'

export const SIDEBAR_VARIANT_COOKIE = 'fintrack-sidebar'
export const DEFAULT_SIDEBAR_VARIANT: SidebarVariant = 'compact'

/** Çerez değeri bozuk/eksikse varsayılana düşer. */
export function parseSidebarVariant(value: string | undefined | null): SidebarVariant {
  return value === 'refined' || value === 'compact' ? value : DEFAULT_SIDEBAR_VARIANT
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
]
