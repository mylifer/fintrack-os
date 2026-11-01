'use client'

import { Header } from '@/components/layout/Header'
import { StatementImport } from '@/components/statement-import/StatementImport'

export default function StatementImportPage() {
  return (
    <>
      <Header title="Ekstre Yükle" />
      <div className="p-4 sm:p-6 flex flex-col gap-4">
        <StatementImport />
      </div>
    </>
  )
}
