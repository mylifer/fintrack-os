import TagDetailClient from './TagDetailClient'

// The tag value is user free-form text carried in the URL segment. Next.js
// decodes the segment once; we guard a defensive re-decode so a legitimately
// percent-containing tag can't throw a URIError.
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export default async function TagDetailPage({
  params,
}: {
  params: Promise<{ tag: string }>
}) {
  const { tag } = await params
  return <TagDetailClient tag={safeDecode(tag)} />
}
