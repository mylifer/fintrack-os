'use client'

import { Header } from '@/components/layout/Header'
import { PeopleBoard } from '@/components/people/board/PeopleBoard'

export default function AileUyeleriPage() {
  return (
    <>
      <Header title="Aile Üyeleri" />
      <PeopleBoard variant="member" />
    </>
  )
}
