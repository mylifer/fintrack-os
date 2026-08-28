'use client'

import { Header } from '@/components/layout/Header'
import { RecipientsBoard } from '@/components/people/recipients/RecipientsBoard'

export default function AlicilarPage() {
  return (
    <>
      <Header title="Alıcılar" />
      <RecipientsBoard />
    </>
  )
}
