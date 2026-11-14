'use client'

import { Suspense } from 'react'
import { Header } from '@/components/layout/Header'
import { StatementHistory } from '@/components/statement-import/StatementHistory'

export default function UploadedStatementsPage() {
  return (
    <>
      <Header title="Yüklenen Ekstreler" />
      <div className="p-4 sm:p-6 flex flex-col gap-4">
        {/* ?ekstre=<id> useSearchParams ile okunur — Suspense sınırı gerekir */}
        <Suspense fallback={null}>
          <StatementHistory />
        </Suspense>
      </div>
    </>
  )
}
