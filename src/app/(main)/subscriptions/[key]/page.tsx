import SubscriptionDetailClient from './SubscriptionDetailClient'

// The subscription group key (e.g. `brand:netflix` / `desc:...`) is carried in
// the URL segment. Next.js decodes the segment once; we guard a defensive
// re-decode so a legitimately percent-containing key can't throw a URIError.
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  const { key } = await params
  return <SubscriptionDetailClient groupKey={safeDecode(key)} />
}
