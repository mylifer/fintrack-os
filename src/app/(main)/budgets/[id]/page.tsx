import { redirect } from 'next/navigation'
import { isTotalBudgetId } from '@/lib/utils/calculations'
import BudgetDetailClient from './BudgetDetailClient'

export default async function BudgetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // Toplam aylık limitin kategori detayı yok; özeti Bütçeler sayfasının
  // üstündedir (bildirim panelinin "Detay" bağlantısı buraya gelir).
  if (isTotalBudgetId(id)) redirect('/budgets')
  return <BudgetDetailClient id={id} />
}
