'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { EmptyState } from '@/components/ui/EmptyState'
import { useTags } from '@/lib/hooks/useTags'
import { useTransactionStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { tagColor, tagKey } from '@/lib/utils/tags'

export default function TagsPage() {
  const tags     = useTags()
  const txsReady = useTransactionStore(s => s.ready)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = tagKey(search)
    return q ? tags.filter(t => t.key.includes(q)) : tags
  }, [tags, search])

  return (
    <div className="flex flex-col h-full">
      <Header title="Etiketler" />
      <div className="flex-1 overflow-hidden p-4 lg:p-6">
        <div className="h-full rounded-2xl border border-border bg-card overflow-hidden flex flex-col">

          {/* Search */}
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border flex-shrink-0">
            <input
              type="text"
              placeholder="Etiket ara..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 min-w-32 text-sm bg-background px-4 py-2 rounded-xl border border-transparent focus:border-border outline-none placeholder:text-muted-foreground/60 text-foreground"
            />
            {tags.length > 0 && (
              <span className="text-xs text-muted-foreground flex-shrink-0">{tags.length} etiket</span>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <EmptyState
                icon="#"
                title={!txsReady ? 'Yükleniyor…' : search ? 'Etiket bulunamadı' : 'Henüz etiket yok'}
                description={
                  search
                    ? 'Aramanızla eşleşen etiket yok.'
                    : 'İşlem eklerken etiket atadığınızda burada görünür.'
                }
              />
            ) : (
              <div className="flex flex-col divide-y divide-border/60">
                {filtered.map(t => (
                  <Link
                    key={t.key}
                    href={`/tags/${encodeURIComponent(t.tag)}`}
                    className="group flex items-center gap-3 px-5 py-3 hover:bg-accent/40 transition-colors"
                  >
                    <span
                      className="size-8 rounded-lg flex-shrink-0 flex items-center justify-center text-sm font-bold"
                      style={{ background: `${tagColor(t.key)}1A`, color: tagColor(t.key) }}
                    >
                      #
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {t.tag}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t.count} işlem
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrency(t.volume)}
                      </div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {t.expense > 0 && <span className="text-destructive">−{formatCurrency(t.expense)}</span>}
                        {t.expense > 0 && t.income > 0 && <span className="opacity-40"> · </span>}
                        {t.income > 0 && <span className="text-green-600">+{formatCurrency(t.income)}</span>}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
