import { Header } from '@/components/layout/Header'
import { RulesManager } from '@/components/rules/RulesManager'

/* İşlem Kuralları. Kenar çubuğunda ayrı öğesi yok: Kategoriler sayfasından,
   Ayarlar'dan ve işlem satırındaki "bu açıklamadan kural oluştur"
   kısayolundan (?yeni=<açıklama>) açılır. */
export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { yeni } = await searchParams
  const initialPattern = typeof yeni === 'string' ? yeni.slice(0, 200) : undefined
  return (
    <>
      <Header title="İşlem Kuralları" />
      <RulesManager key={initialPattern ?? ''} initialPattern={initialPattern} />
    </>
  )
}
