import { cookies } from 'next/headers'
import { TX_VIEW_COOKIE, parseTxView } from '@/lib/tx-view'
import AccountDetailClient from './AccountDetailClient'

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // İşlem listesi görünümü çerezden okunur, böylece sunucu doğrudan kullanıcının
  // seçtiği görünümü basar; istemcide düzeltme (ve görünür sıçrama) gerekmez.
  const view = parseTxView((await cookies()).get(TX_VIEW_COOKIE)?.value)

  return <AccountDetailClient id={id} initialView={view} />
}
