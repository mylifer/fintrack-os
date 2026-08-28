'use client'

import Link from 'next/link'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { formatCurrency, formatSigned } from '@/lib/utils/currency'
import { shortDate, type PersonRow } from '../shared'
import { Highlight, netTone, PendingBadge, RowActions, type PersonViewProps } from './bits'

/**
 * Görünüm — Dizin
 * Uzun listeler için: A–Z harf grupları (yapışkan başlık), 32px satır
 * yüksekliği ve sağda harf rayı. Ada göre BULMAK için — gruplar her zaman
 * alfabetik, grubun İÇİ ise araç çubuğundaki aktif sıralamayı izler.
 *
 * 32px satır tek para kolonu taşır: alıcıda toplam gider, aile üyesinde net
 * (iki yönü de olan bir üye için tek anlamlı özet odur).
 */
const GRID = 'grid grid-cols-[minmax(0,1fr)_3rem_7.5rem_4.5rem_3.75rem] items-center gap-3'

/** Türkçe alfabeye göre baş harf; harf değilse '#'. */
function initial(name: string): string {
  const ch = name.trim().charAt(0).toLocaleUpperCase('tr-TR')
  return /\p{L}/u.test(ch) ? ch : '#'
}

function groupId(letter: string): string {
  // '#' ve Türkçe harfler id'de güvenli olsun diye kod noktasına çevrilir.
  return `kisi-harf-${letter.codePointAt(0)}`
}

export function IndexView({ rows, config, query, onEdit, onArchive }: PersonViewProps) {
  const isMember = config.role === 'family_member'

  const groups = new Map<string, PersonRow[]>()
  for (const row of rows) {
    const letter = initial(row.person.name)
    const bucket = groups.get(letter)
    if (bucket) bucket.push(row)
    else groups.set(letter, [row])
  }
  // '#' (harf olmayanlar) en sona.
  const letters = [...groups.keys()].sort((a, b) =>
    a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b, 'tr'),
  )

  return (
    <div className="flex gap-2 items-start">
      <div className="flex-1 min-w-0 rounded-xl border border-border bg-card overflow-hidden">
        {letters.map(letter => (
          <section key={letter} id={groupId(letter)} className="scroll-mt-4">
            <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-1 bg-secondary/80 backdrop-blur-sm border-y border-border/60 first:border-t-0">
              <span className="text-[11px] font-bold text-foreground">{letter}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {groups.get(letter)!.length}
              </span>
            </div>

            {groups.get(letter)!.map(({ person, flowCount, pendingCount, income, expense, net, lastDate }) => {
              const hasFlow = income > 0 || expense > 0
              return (
                <div
                  key={person.id}
                  className={`${GRID} group h-8 px-4 border-b border-border/40 last:border-0 hover:bg-secondary/40 transition-colors`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <PersonAvatar person={person} size="xs" />
                    <Link
                      href={`${config.basePath}/${person.id}`}
                      className="text-[13px] font-medium text-foreground truncate hover:text-primary transition-colors"
                    >
                      <Highlight text={person.name} query={query} />
                    </Link>
                    <PendingBadge count={pendingCount} />
                  </div>
                  <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                    {flowCount || '—'}
                  </span>
                  {isMember ? (
                    <span
                      title={`Gelir ${formatCurrency(income)} · Gider ${formatCurrency(expense)}`}
                      className={`text-right text-[13px] font-medium tabular-nums ${netTone(net)}`}
                    >
                      {hasFlow ? formatSigned(net) : '—'}
                    </span>
                  ) : (
                    <span className="text-right text-[13px] font-medium tabular-nums text-foreground">
                      {expense > 0 ? formatCurrency(expense) : '—'}
                    </span>
                  )}
                  <span className="text-right text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
                    {shortDate(lastDate)}
                  </span>
                  <RowActions
                    person={person}
                    onEdit={onEdit}
                    onArchive={onArchive}
                    className="justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                  />
                </div>
              )
            })}
          </section>
        ))}
      </div>

      {/* Harf rayı — yalnız birden fazla grup varsa anlamlı */}
      {letters.length > 1 && (
        <nav
          aria-label="Harfe atla"
          className="sticky top-2 hidden sm:flex flex-col items-center gap-px py-1 px-0.5 rounded-lg border border-border bg-card/80"
        >
          {letters.map(letter => (
            <a
              key={letter}
              href={`#${groupId(letter)}`}
              className="w-5 h-4 flex items-center justify-center rounded text-[10px] font-semibold text-muted-foreground hover:text-primary-foreground hover:bg-primary transition-colors"
            >
              {letter}
            </a>
          ))}
        </nav>
      )}
    </div>
  )
}
