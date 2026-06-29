import CategoryDetailClient from './CategoryDetailClient'

export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <CategoryDetailClient id={id} />
}
