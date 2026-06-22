'use client'

import { Header } from '@/components/layout/Header'
import { PeopleManager } from '@/components/people/PeopleManager'

export default function AlicilarPage() {
  return (
    <>
      <Header title="Alıcılar" />
      <PeopleManager role="recipient" emptyText="Henüz alıcı eklenmedi." />
    </>
  )
}
