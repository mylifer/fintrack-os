'use client'

import { AccountLine } from './Line'
import type { AccountRow } from './shared'
import type { Account } from '@/types'

/**
 * Görünüm — Liste
 * Tek sütun, ferah premium satırlar (Mercury/Linear hissi). İnce ayraçlar,
 * hover'da yumuşak vurgulama. En sade ve okunaklı klasik seçenek.
 */
export function ListView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
      {rows.map(row => (
        <AccountLine key={row.account.id} row={row} onEdit={onEdit} />
      ))}
    </div>
  )
}
