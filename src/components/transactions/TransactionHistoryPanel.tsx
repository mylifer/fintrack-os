'use client'

import { useCallback, useState } from 'react'
import { ChevronDown, History } from 'lucide-react'
import { useAccountStore, useCategoryStore, usePeopleStore } from '@/store'
import { loadTxHistory } from '@/store/transaction-history.store'
import { formatDate } from '@/lib/utils/date'
import { formatCurrency } from '@/lib/utils/currency'
import { cn } from '@/lib/utils'
import type { CurrencyCode, TransactionHistoryEntry, TxHistoryAction, TxHistorySource } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   "Bu kaydın geçmişi" — işlem düzenleme penceresinin altındaki katlanabilir
   bölüm. YALNIZ var olan bir işlem düzenlenirken görünür.

   Geçmiş AÇILMADAN yüklenmez (loadTxHistory talep üzerine çalışır — açılışta
   belleğe alınan bir geçmiş zamanla sınırsız büyürdü).
──────────────────────────────────────────────────────────────────────── */

const ACTION_LABEL: Record<TxHistoryAction, string> = {
  create:  'Oluşturuldu',
  update:  'Düzenlendi',
  delete:  'Silindi',
  restore: 'Geri alındı',
}

const SOURCE_LABEL: Record<TxHistorySource, string> = {
  form:      'Form',
  import:    'Ekstre',
  refund:    'İade',
  batch:     'Toplu düzenleme',
  recurring: 'Tekrarlayan',
  approval:  'Onay',
  undo:      'Geri alma',
  app:       'Uygulama',
}

/* Kayıtta DURAN ama listede gösterilmeyen makine alanları: kullanıcının yaptığı
   bir değişikliği anlatmazlar (kimlik, oluşturulma damgası, çalışma alanı).
   Geçmiş satırının kendisinde eksiksiz dururlar — yalnız gösterim sadeleşir. */
const HIDDEN_FIELDS = new Set(['id', 'createdAt', 'workspaceId', 'user_id', 'updatedAt'])

/** Gösterilecek değişiklikler: makine alanları düşer; tutarın TL karşılığı
 *  yalnız tutarın KENDİSİ değişmediyse gösterilir (aksi hâlde aynı şeyi tekrar
 *  eder — yabancı para işlemlerde kur değişimini görmek için duruyor). */
function visibleChanges(changes: Record<string, [unknown, unknown]> | null | undefined): [string, [unknown, unknown]][] {
  const all = Object.entries(changes ?? {})
  const amountChanged = all.some(([f]) => f === 'amount')
  return all.filter(([f]) => !HIDDEN_FIELDS.has(f) && !(f === 'amountTry' && amountChanged))
}

/** Alan adı → Türkçe etiket. Listede OLMAYAN alan ham adıyla gösterilir. */
const FIELD_LABEL: Record<string, string> = {
  date:            'Tarih',
  amount:          'Tutar',
  amountTry:       'Tutar (TL karşılığı)',
  description:     'Açıklama',
  categoryId:      'Kategori',
  accountId:       'Hesap',
  recipientId:     'Alıcı',
  tags:            'Etiketler',
  approvalStatus:  'Onay durumu',
  approvedAt:      'Onay zamanı',
  deleted_at:      'Silinme',
  notes:           'Not',
  merchant:        'İşyeri',
  familyMemberId:  'Aile üyesi',
  refundOfId:      'Bağlı iade',
  isInstallment:   'Taksit',
  installIndex:    'Taksit',
  installTotal:    'Taksit',
  categorySplits:  'Kategori payları',
  toAccountId:     'Karşı hesap',
  type:            'Tür',
  currency:        'Para birimi',
  receipt:         'Fiş',
}

const TYPE_LABEL: Record<string, string> = {
  expense: 'Gider', income: 'Gelir', transfer: 'Transfer',
}

const APPROVAL_LABEL: Record<string, string> = {
  pending: 'onay bekliyor', approved: 'onaylandı',
}

const MAX_TEXT = 60

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text
}

function isIsoDay(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
}

export function TransactionHistoryPanel({ txId, currency }: {
  txId: string
  currency?: CurrencyCode
}) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [rows, setRows]       = useState<TransactionHistoryEntry[] | null>(null)

  const categories = useCategoryStore(s => s.categories)
  const accounts   = useAccountStore(s => s.accounts)
  const people     = usePeopleStore(s => s.people)

  /** Alan değerini okunur bir metne çevirir (id'ler ad olarak çözülür). */
  const formatValue = useCallback((field: string, value: unknown): string => {
    if (value === undefined || value === null || value === '') return '—'
    switch (field) {
      case 'date':
      case 'deleted_at':
      case 'approvedAt':
        return isIsoDay(value) ? formatDate(value.slice(0, 10)) : clip(String(value))
      case 'amount':
      case 'amountTry':
        return typeof value === 'number'
          ? formatCurrency(value, field === 'amountTry' ? 'TRY' : (currency ?? 'TRY'))
          : clip(String(value))
      case 'categoryId':
        return categories.find(c => c.id === value)?.name ?? clip(String(value))
      case 'accountId':
      case 'toAccountId':
        return accounts.find(a => a.id === value)?.name ?? clip(String(value))
      case 'recipientId':
      case 'familyMemberId':
        return people.find(p => p.id === value)?.name ?? clip(String(value))
      case 'type':
        return TYPE_LABEL[String(value)] ?? clip(String(value))
      case 'approvalStatus':
        return APPROVAL_LABEL[String(value)] ?? clip(String(value))
      case 'tags':
        return Array.isArray(value) ? clip(value.join(', ')) || '—' : clip(String(value))
      case 'isInstallment':
        return value ? 'Evet' : 'Hayır'
      case 'categorySplits':
        return Array.isArray(value) ? `${value.length} pay` : clip(String(value))
      case 'receipt':
        return typeof value === 'object' ? 'Fiş eklendi' : clip(String(value))
      default:
        return clip(typeof value === 'object' ? JSON.stringify(value) : String(value))
    }
  }, [categories, accounts, people, currency])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || rows !== null || loading) return
    setLoading(true)
    try {
      setRows(await loadTxHistory(txId))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <History className="size-3.5 shrink-0" />
        <span>Bu kaydın geçmişi</span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="rounded-md border bg-muted/40 px-3 py-2.5">
          {loading && <p className="text-xs text-muted-foreground">Yükleniyor…</p>}

          {!loading && rows?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Bu kayıt için geçmiş yok (geçmiş tutulmaya bu sürümle başlandı).
            </p>
          )}

          {!loading && !!rows?.length && (
            <ul className="flex max-h-56 flex-col gap-2.5 overflow-y-auto">
              {rows.map(row => {
                const changes = visibleChanges(row.changes)
                return (
                  <li key={row.id} className="flex flex-col gap-1 border-b pb-2 last:border-b-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-xs font-medium tabular-nums">
                        {isIsoDay(row.at)
                          ? `${formatDate(row.at.slice(0, 10))} ${new Date(row.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`
                          : row.at}
                      </span>
                      <span className="text-xs font-semibold">{ACTION_LABEL[row.action] ?? row.action}</span>
                      {row.source && (
                        <span className="text-[11px] text-muted-foreground">
                          · {SOURCE_LABEL[row.source] ?? row.source}
                        </span>
                      )}
                      {row.device && (
                        <span className="text-[11px] text-muted-foreground">· {row.device}</span>
                      )}
                    </div>
                    {changes.length > 0 && (
                      <div className="flex flex-col gap-0.5">
                        {changes.map(([field, [before, after]]) => (
                          <div key={field} className="text-[11px] text-muted-foreground">
                            <span className="font-medium text-foreground/80">
                              {FIELD_LABEL[field] ?? field}:
                            </span>{' '}
                            <span>{formatValue(field, before)}</span>
                            <span className="mx-1">→</span>
                            <span className="text-foreground">{formatValue(field, after)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
