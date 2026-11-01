'use client'

import { Suspense } from 'react'
import { Header } from '@/components/layout/Header'
import { StatementImport } from '@/components/statement-import/StatementImport'

export default function StatementImportPage() {
  return (
    <>
      <Header title="Ekstre Yükle" />
      <div className="p-4 sm:p-6 flex flex-col gap-4">
        {/* ?taslak=<id> useSearchParams ile okunur — Suspense sınırı gerekir */}
        <Suspense fallback={null}>
          <StatementImport />
        </Suspense>
      </div>
    </>
  )
}
