import PersonDetailClient from '@/components/people/PersonDetailClient'

export default async function AliciDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <PersonDetailClient id={id} role="recipient" backHref="/alicilar" backLabel="Alıcılar" />
}
