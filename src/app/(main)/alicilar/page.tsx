'use client'

import { Header } from '@/components/layout/Header'
import { PeopleBoard } from '@/components/people/board/PeopleBoard'

export default function AlicilarPage() {
  return (
    <>
      <Header title="Alıcılar" />
      <PeopleBoard variant="recipient" />
    </>
  )
}
