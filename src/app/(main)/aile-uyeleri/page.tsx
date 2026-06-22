'use client'

import { Header } from '@/components/layout/Header'
import { PeopleManager } from '@/components/people/PeopleManager'

export default function AileUyeleriPage() {
  return (
    <>
      <Header title="Aile Üyeleri" />
      <PeopleManager role="family_member" emptyText="Henüz aile üyesi eklenmedi." />
    </>
  )
}
