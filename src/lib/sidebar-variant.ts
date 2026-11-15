/* ── Kenar çubuğu görünüm tercihi ────────────────────────────────────────────
   Tercih ÇEREZDE tutulur (localStorage değil): kök layout zaten dinamik
   (headers() okuyor), böylece sunucu ilk HTML'i doğru varyantla basar.
   localStorage olsaydı sunucu varsayılanı basar, hidrasyondan sonra diğer
   varyanta atlardı — her sayfa yüklemesinde görünür bir sıçrama.

   Bu dosya sunucu bileşenlerinden de import edildiği için 'use client' YOK ve
   tarayıcıya özgü API kullanmaz. */

export type SidebarVariant = 'refined' | 'dual'

const ALL: readonly SidebarVariant[] = ['refined', 'dual']

export const SIDEBAR_VARIANT_COOKIE = 'fintrack-sidebar'
export const DEFAULT_SIDEBAR_VARIANT: SidebarVariant = 'dual'

/** Çerez değeri bozuk/eksikse varsayılana düşer. */
export function parseSidebarVariant(value: string | undefined | null): SidebarVariant {
  return ALL.includes(value as SidebarVariant) ? (value as SidebarVariant) : DEFAULT_SIDEBAR_VARIANT
}

export const SIDEBAR_VARIANTS: { key: SidebarVariant; label: string; hint: string }[] = [
  {
    key: 'dual',
    label: 'Çift Panel',
    hint: 'Solda dört bölüm rayı, yanında yalnızca seçili bölümün sayfaları. Kısa ve odaklı listeler.',
  },
  {
    key: 'refined',
    label: 'Rafine',
    hint: 'Ferah satırlar, yumuşak aksan hapları ve ayrı bir net varlık kartı.',
  },
]
