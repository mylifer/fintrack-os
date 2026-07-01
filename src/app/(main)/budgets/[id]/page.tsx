import BudgetDetailClient from './BudgetDetailClient'

export default async function BudgetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <BudgetDetailClient id={id} />
}
