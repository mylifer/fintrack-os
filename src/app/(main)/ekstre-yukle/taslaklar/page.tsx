'use client'

import { Suspense } from 'react'
import { Header } from '@/components/layout/Header'
import { StatementDrafts } from '@/components/statement-import/StatementDrafts'

export default function StatementDraftsPage() {
  return (
    <>
      <Header title="Yarım Kalan Ekstreler" />
      <div className="p-4 sm:p-6 flex flex-col gap-4">
        <Suspense fallback={null}>
          <StatementDrafts />
        </Suspense>
      </div>
    </>
  )
}
