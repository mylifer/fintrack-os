'use client'

import { useShallow } from 'zustand/react/shallow'
import { useAccountStore } from '@/store'
import { SelectField } from '@/components/ui/Select'

/** Rapor sayfalarının hesap süzgeci: 'all' = Tüm Hesaplar, aksi hâlde hesap id'si. */
export function AccountFilter({ value, onChange }: { value: string; onChange: (accountId: string) => void }) {
  const accounts = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  return (
    <SelectField
      value={value}
      onChange={e => onChange(e.target.value)}
      options={[
        { value: 'all', label: 'Tüm Hesaplar' },
        ...accounts.map(a => ({ value: a.id, label: a.name })),
      ]}
      className="w-fit bg-card text-xs"
    />
  )
}
