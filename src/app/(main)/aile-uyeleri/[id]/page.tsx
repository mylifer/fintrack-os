import PersonDetailClient from '@/components/people/PersonDetailClient'

export default async function AileUyesiDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <PersonDetailClient id={id} role="family_member" backHref="/aile-uyeleri" backLabel="Aile Üyeleri" />
}
