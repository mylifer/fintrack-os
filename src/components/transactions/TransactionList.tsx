'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertDialog } from 'radix-ui'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCategoryStore, useAccountStore, useUIStore, usePeopleStore, useTransactionStore, useInvestmentStore } from '@/store'
import { assetLabel } from '@/store/investment.store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { groupByDate } from '@/lib/utils/calculations'
import { toMinor, toMajor } from '@/lib/utils/money'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Transaction, PersonRole, Category, Account, Person, ModalType, ModalPayload, InvestmentTransaction } from '@/types'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { TagBadges } from '@/components/transactions/TagBadges'
import { Checkbox } from '@/components/ui/Checkbox'
import { BrandLogo } from '@/components/subscriptions/BrandLogo'
import { detectBrand } from '@/lib/subscriptions/brands'
import { getBrandDomain } from '@/lib/people/brands'
import { resolveBrandDomain } from '@/lib/people/brand-logo'

type OpenModal = (type: NonNullable<ModalType>, payload?: ModalPayload) => void

const PencilIcon = ({ size = 13 }: { size?: number }) => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
  </svg>
)
const TrashIcon = ({ size = 13 }: { size?: number }) => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </svg>
)
const RefundIcon = ({ size = 13 }: { size?: number }) => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
  </svg>
)

// Silinmek istenen defter işlemi bir yatırım satışının bacağı mı? İki bacak var:
// satış geliri (invest tx'in linkedTransactionId'si) ve kâr/zarar satırı
// (cleanSellLinkedTxs ile aynı sezgisel: hesap + tarih + "X Satış Kârı/Zararı").
function findLinkedInvestSell(
  tx: Transaction,
  investTxs: InvestmentTransaction[],
): InvestmentTransaction | undefined {
  return investTxs.find(it => {
    if (it.type !== 'sell' || !it.targetAccountId) return false
    if (it.linkedTransactionId === tx.id) return true
    const label = assetLabel(it.asset)
    return it.targetAccountId === tx.accountId &&
      it.date === tx.date &&
      (tx.description === `${label} Satış Kârı` || tx.description === `${label} Satış Zararı`)
  })
}

function DeleteConfirmDialog({
  tx,
  onDelete,
  compact,
}: {
  tx: Transaction
  onDelete: () => void
  compact?: boolean
}) {
  const investTxs = useInvestmentStore(s => s.transactions)
  const removeInvestTx = useInvestmentStore(s => s.removeTransaction)
  const investSell = useMemo(() => findLinkedInvestSell(tx, investTxs), [tx, investTxs])

  const btnCls = compact
    ? 'w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors'
    : 'w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors'
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button className={btnCls} title="Sil">
          <TrashIcon size={compact ? 12 : 13} />
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <AlertDialog.Content className={[
          'fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
          'w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-background p-6 shadow-xl',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        ].join(' ')}>
          <AlertDialog.Title className="text-base font-semibold text-foreground mb-1">
            {investSell ? 'Yatırım satışına bağlı işlemi sil' : tx.isInstallment ? 'Taksitli işlemi sil' : 'İşlemi sil'}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-muted-foreground mb-5">
            {investSell ? (
              <>
                <span className="font-medium text-foreground">&ldquo;{tx.description}&rdquo;</span> bir yatırım satışının parçası — yatırım hesabındaki{' '}
                <span className="font-medium text-foreground">satış kaydı</span> ve bu satışla hesaba yazılan{' '}
                <span className="font-medium text-foreground">tüm bağlı işlemler (satış tutarı + kâr/zarar)</span> birlikte kalıcı olarak silinecek. Bu işlem geri alınamaz.
              </>
            ) : tx.isInstallment && tx.installGroupId ? (
              <>
                <span className="font-medium text-foreground">&ldquo;{tx.description}&rdquo;</span> taksitli bir satın almanın parçası — bu satın almaya ait{' '}
                <span className="font-medium text-foreground">tüm taksitler ({tx.installTotal ?? '?'} adet)</span> kalıcı olarak silinecek.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">&ldquo;{tx.description}&rdquo;</span> işlemi kalıcı olarak silinecek. Bu işlem geri alınamaz.
              </>
            )}
          </AlertDialog.Description>
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-accent transition-colors">
                İptal
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                onClick={() => investSell ? void removeInvestTx(investSell.id) : onDelete()}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors"
              >
                Sil
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

// CSS grid template columns for table layout.
const TABLE_COLS = 'minmax(130px,1.4fr) minmax(96px,1fr) minmax(96px,1fr) minmax(76px,0.85fr) minmax(76px,0.85fr) minmax(76px,0.85fr) minmax(72px,0.85fr) minmax(84px,0.9fr) 76px'
const TABLE_MIN_W = 130 + 96 + 96 + 76 + 76 + 76 + 72 + 84 + 76 + 24
// Toplu seçim etkinken satırların/başlığın soluna eklenen onay kutusu sütunu.
const SELECT_COL = '34px '
const SELECT_COL_W = 34
const colsFor = (selectable: boolean) => (selectable ? SELECT_COL + TABLE_COLS : TABLE_COLS)

type MetaItem = { text: string; href?: string }

// İşlem ikonu yalnızca açıklamadan türetilir, sırasıyla:
//   1. küratörlü marka eşleşmesi (gömülü SVG logo)
//   2. açıklamadaki marka deseninden bilinen domain → favicon
//   3. çevrimiçi birebir isim çözümü (/api/brand-logo) → favicon
//   4. baş harf monogramı
const TxIcon = memo(function TxIcon({ description }: { description: string }) {
  const brand  = useMemo(() => detectBrand(description), [description])
  const known  = useMemo(() => (brand ? null : getBrandDomain(description)), [brand, description])
  const [resolved, setResolved] = useState<{ for: string; domain: string | null } | null>(null)
  const [failedDomain, setFailedDomain] = useState<string | null>(null)

  useEffect(() => {
    // Küratörlü eşleşme varken dış servise sorulmaz; uzun serbest metinler de
    // (API'nin 64 karakter sınırı) birebir marka adı olamayacağı için atlanır.
    const name = description.trim()
    if (brand || known || name.length < 2 || name.length > 64) return
    let alive = true
    resolveBrandDomain(name).then(d => { if (alive) setResolved({ for: description, domain: d }) })
    return () => { alive = false }
  }, [brand, known, description])

  const domain = known ?? (resolved?.for === description ? resolved.domain : null)
  if (!brand && domain && failedDomain !== domain) {
    return (
      <span className="w-5 h-5 flex-shrink-0 inline-flex items-center justify-center rounded-md overflow-hidden bg-card border border-border p-[3px]">
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
          alt={description}
          className="max-w-full max-h-full object-contain"
          onError={() => setFailedDomain(domain)}
        />
      </span>
    )
  }
  return <BrandLogo brand={brand} name={description} size={20} />
})

// Günlük işlemleri kararlı bir sırayla dizer (kronolojik + yatırım rank + taksit).
// Artık render başına değil, tek seferlik `rows` memo'sunda çağrılır.
function sortDay(dayTxs: Transaction[]) {
  const investRank = (tx: Transaction) => {
    if (!tx.icon) return 10
    if (tx.description.includes('Alım')) return 0
    if (tx.description.includes('Kâr') || tx.description.includes('Zarar')) return 6
    return 5
  }
  return [...dayTxs].sort((a, b) => {
    const ca = a.createdAt ?? '', cb = b.createdAt ?? ''
    if (ca !== cb) return cb.localeCompare(ca)
    const ra = investRank(a), rb = investRank(b)
    if (ra !== rb) return ra - rb
    return (a.installIndex ?? 0) - (b.installIndex ?? 0)
  })
}

// Kullanıcının seçebildiği sıralama seçenekleri (filtre çubuğundaki "Sıralama" alanı).
export type TxSortOption = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'

export const TX_SORT_OPTIONS: { value: TxSortOption; label: string }[] = [
  { value: 'date-desc',   label: 'Tarih: Yeni → Eski' },
  { value: 'date-asc',    label: 'Tarih: Eski → Yeni' },
  { value: 'amount-desc', label: 'Tutar: Yüksek → Düşük' },
  { value: 'amount-asc',  label: 'Tutar: Düşük → Yüksek' },
]

// Flattened, virtualization-friendly row list. One entry per rendered row.
type Row =
  | { kind: 'section'; id: 'future' | 'past'; count: number; first: boolean }
  | { kind: 'header'; date: string; dateIdx: number; future: boolean }
  | { kind: 'tx'; tx: Transaction; isFirst: boolean; isLast: boolean; future: boolean }

// ── Date separator (both layouts share the same look, only top spacing differs) ─
function DateSeparator({ date, topClass, future }: { date: string; topClass: string; future?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${topClass}`}>
      <span className={`text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap select-none ${future ? 'text-sky-500/80' : 'text-muted-foreground'}`}>
        {formatDate(date, 'd MMM')} · {formatDate(date, 'EEEE')}
      </span>
      <div className={`flex-1 h-px ${future ? 'bg-sky-500/20' : 'bg-border/60'}`} />
    </div>
  )
}

// ── Section banner: gelecek işlemleri gerçekleşenlerden görsel olarak ayırır ──
function SectionBanner({ id, count, topClass }: { id: 'future' | 'past'; count: number; topClass: string }) {
  const future = id === 'future'
  return (
    <div className={`flex items-center gap-3 py-1.5 ${topClass}`}>
      <span className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider select-none',
        future ? 'bg-sky-500/10 text-sky-500' : 'bg-muted text-muted-foreground',
      ].join(' ')}>
        {future ? 'Gelecek İşlemler' : 'Gerçekleşen İşlemler'}
        <span className="font-semibold opacity-70">{count}</span>
      </span>
      <div className={`flex-1 h-px ${future ? 'bg-sky-500/25' : 'bg-border'}`} />
    </div>
  )
}

// ── TABLE row ─────────────────────────────────────────────────────────────
const TableTxRow = memo(function TableTxRow({
  tx, cat, account, toAccount, recipient, family, balanceAfter, projected, future, openModal, removeTx,
  selectable, selected, onToggleSelect,
}: {
  tx: Transaction
  cat?: Category
  account?: Account
  toAccount?: Account
  recipient?: Person
  family?: Person
  balanceAfter?: number
  projected?: boolean
  future?: boolean
  openModal: OpenModal
  removeTx: (id: string) => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const isIncome    = tx.type === 'income'
  const isXfer      = tx.type === 'transfer'
  const isRefund    = tx.type === 'expense' && tx.amount < 0
  return (
    // Düz, sürekli satır yüzeyi (örnek/mockup görünümü): kenarlıklı grup kartları
    // yerine yalnızca ince alt ayraç + hover. Kart yüzeyini saran konteyner sağlar.
    <div
      className={[
        'group grid transition-colors border-b border-border/50',
        selected ? 'bg-[var(--batch-accent-soft)] hover:bg-[var(--batch-accent-soft)]' : future ? 'bg-sky-500/[0.04] hover:bg-accent/40' : 'hover:bg-accent/40',
        projected ? 'opacity-60' : '',
      ].join(' ')}
      style={{ gridTemplateColumns: colsFor(!!selectable) }}
    >
      {/* Seçim kutusu — planlanan (henüz gerçekleşmemiş) satırlar toplu düzenlenemez */}
      {selectable && (
        <div className="flex items-center justify-center">
          {!projected && (
            <Checkbox
              checked={!!selected}
              onChange={() => onToggleSelect?.(tx.id)}
              aria-label="İşlemi seç"
            />
          )}
        </div>
      )}

      {/* Açıklama */}
      <div className="px-3 py-2 flex items-center gap-2 min-w-0 overflow-hidden">
        <TxIcon description={tx.description} />
        <div className="min-w-0 overflow-hidden">
          <div className="text-xs font-medium text-foreground truncate leading-none">
            {tx.description}
            {tx.isInstallment && (
              <span className="ml-1 font-normal text-orange-500/80">
                ({tx.installIndex}/{tx.installTotal})
              </span>
            )}
            {isRefund && (
              <span className="ml-1.5 align-middle rounded-sm bg-green-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-green-600">
                İade
              </span>
            )}
            {projected && (
              <span className="ml-1.5 align-middle rounded-sm bg-sky-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-sky-500">
                Planlandı
              </span>
            )}
            {tx.approvalStatus === 'pending' && (
              <span className="ml-1.5 align-middle rounded-sm bg-orange-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-500">
                Onay bekliyor
              </span>
            )}
          </div>
          <TagBadges tags={tx.tags} className="mt-1" />
        </div>
      </div>

      {/* Hesap */}
      <div className="px-2 py-2 flex items-center gap-1.5 min-w-0 overflow-hidden">
        {account ? (
          <Link href={`/accounts/${tx.accountId}`} className="flex items-center gap-1.5 min-w-0 group/link">
            <AccountAvatar account={account} size="xs" className="flex-shrink-0" />
            <span className="text-xs text-muted-foreground truncate min-w-0 group-hover/link:text-primary transition-colors">{account.name}</span>
          </Link>
        ) : null}
      </div>

      {/* Alıcı Hesap — yalnızca transferlerde dolu */}
      <div className="px-2 py-2 flex items-center gap-1.5 min-w-0 overflow-hidden">
        {isXfer && toAccount ? (
          <Link href={`/accounts/${tx.toAccountId}`} className="flex items-center gap-1.5 min-w-0 group/link">
            <AccountAvatar account={toAccount} size="xs" className="flex-shrink-0" />
            <span className="text-xs text-muted-foreground truncate min-w-0 group-hover/link:text-primary transition-colors">{toAccount.name}</span>
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground/25">—</span>
        )}
      </div>

      {/* Alıcı */}
      <div className="px-2 py-2 flex items-center gap-1.5 min-w-0 overflow-hidden">
        {recipient ? (
          <Link href={`/alicilar/${tx.recipientId}`} className="flex items-center gap-1.5 min-w-0 group/link">
            <PersonAvatar person={recipient} size="xs" className="flex-shrink-0" />
            <span className="text-xs text-muted-foreground truncate min-w-0 group-hover/link:text-primary transition-colors">
              {recipient.name}
            </span>
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground/25">—</span>
        )}
      </div>

      {/* Aile Üyesi */}
      <div className="px-2 py-2 flex items-center gap-1.5 min-w-0 overflow-hidden">
        {family ? (
          <Link href={`/aile-uyeleri/${tx.familyMemberId}`} className="flex items-center gap-1.5 min-w-0 group/link">
            <PersonAvatar person={family} size="xs" className="flex-shrink-0" />
            <span className="text-xs text-muted-foreground truncate min-w-0 group-hover/link:text-primary transition-colors">
              {family.name}
            </span>
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground/25">—</span>
        )}
      </div>

      {/* Kategori — renkli noktalı "pill" (örnek/mockup görünümü) */}
      <div className="px-2 py-2 flex items-center min-w-0 overflow-hidden">
        {cat ? (
          <Link
            href={`/categories/${tx.categoryId}`}
            className="inline-flex items-center gap-1.5 max-w-full rounded-full border border-border bg-foreground/[0.07] px-2 py-0.5 hover:bg-foreground/[0.11] hover:border-border/80 transition-all group/link"
          >
            <span className="h-[7px] w-[7px] rounded-full flex-shrink-0" style={{ background: cat.color }} />
            <span className="text-[11px] font-medium text-foreground/80 truncate min-w-0 group-hover/link:text-foreground transition-colors">{cat.name}</span>
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground/25">—</span>
        )}
      </div>

      {/* Miktar */}
      <div className="px-3 py-2 flex items-center justify-end">
        <span className={[
          'text-xs font-semibold tabular-nums',
          isIncome || isRefund ? 'text-green-600' : isXfer ? 'text-foreground/50' : 'text-foreground',
        ].join(' ')}>
          {isIncome || isRefund ? '+' : isXfer ? '' : '−'}
          {formatCurrency(Math.abs(tx.amount), tx.currency)}
        </span>
      </div>

      {/* Güncel Bakiye */}
      <div className="px-3 py-2 flex items-center justify-end">
        {balanceAfter !== undefined ? (
          <span className={[
            'text-xs tabular-nums',
            balanceAfter < 0 ? 'text-destructive' : 'text-muted-foreground/60',
          ].join(' ')}>
            {formatCurrency(balanceAfter, account?.currency)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/25">—</span>
        )}
      </div>

      {/* Actions — planlanan (henüz gerçekleşmemiş) satırlar düzenlenemez/silinemez */}
      <div className="px-2 py-2 flex items-center justify-end gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {!projected && (
          <>
            {tx.type === 'expense' && tx.amount > 0 && (
              <button
                onClick={() => openModal('refund-transaction', { id: tx.id })}
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-green-600 hover:bg-green-500/10 transition-colors"
                title="İade İşle"
              >
                <RefundIcon size={12} />
              </button>
            )}
            <button
              onClick={() => openModal('edit-transaction', { id: tx.id })}
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Düzenle"
            >
              <PencilIcon size={12} />
            </button>
            <DeleteConfirmDialog tx={tx} onDelete={() => removeTx(tx.id)} compact />
          </>
        )}
      </div>
    </div>
  )
})

// ── CARDS row (compact minimal) ───────────────────────────────────────────
const CardTxRow = memo(function CardTxRow({
  tx, cat, account, recipient, family, showAccount, projected, future, openModal, removeTx,
}: {
  tx: Transaction
  cat?: Category
  account?: Account
  recipient?: Person
  family?: Person
  showAccount: boolean
  projected?: boolean
  future?: boolean
  openModal: OpenModal
  removeTx: (id: string) => void
}) {
  const isIncome  = tx.type === 'income'
  const isXfer    = tx.type === 'transfer'
  const isRefund  = tx.type === 'expense' && tx.amount < 0

  // Build meta items — each can have an href for navigation
  const metaItems: MetaItem[] = []
  if (showAccount && account) metaItems.push({ text: account.name, href: `/accounts/${tx.accountId}` })
  if (cat) metaItems.push({ text: cat.name, href: `/categories/${tx.categoryId}` })
  if (tx.isInstallment) metaItems.push({ text: `${tx.installIndex}/${tx.installTotal}` })
  if (recipient) metaItems.push({ text: recipient.name, href: `/alicilar/${tx.recipientId}` })
  if (family)    metaItems.push({ text: family.name,    href: `/aile-uyeleri/${tx.familyMemberId}` })

  const hasSubline = metaItems.length > 0

  return (
    <div className={[
      'group flex items-center gap-2.5 px-2 py-[5px] rounded-lg hover:bg-accent/40 transition-colors',
      future ? 'bg-sky-500/[0.04]' : '',
      projected ? 'opacity-60' : '',
    ].join(' ')}>
      {/* Icon — yalnızca açıklamadan */}
      <TxIcon description={tx.description} />

      {/* Description + meta */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-foreground truncate leading-snug">
          {tx.description}
          {isRefund && (
            <span className="ml-1.5 align-middle rounded-sm bg-green-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-green-600">
              İade
            </span>
          )}
          {projected && (
            <span className="ml-1.5 align-middle rounded-sm bg-sky-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-sky-500">
              Planlandı
            </span>
          )}
          {tx.approvalStatus === 'pending' && (
            <span className="ml-1.5 align-middle rounded-sm bg-orange-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-500">
              Onay bekliyor
            </span>
          )}
        </div>
        {hasSubline && (
          <div className="text-[11px] text-muted-foreground/60 truncate leading-snug">
            {metaItems.map((item, i) => (
              <span key={i}>
                {i > 0 && <span className="opacity-40"> · </span>}
                {item.href ? (
                  <Link
                    href={item.href}
                    onClick={e => e.stopPropagation()}
                    className="hover:text-foreground transition-colors"
                  >
                    {item.text}
                  </Link>
                ) : item.text}
              </span>
            ))}
          </div>
        )}
        <TagBadges tags={tx.tags} className="mt-1" />
      </div>

      {/* Amount */}
      <span className={[
        'text-[13px] font-medium tabular-nums flex-shrink-0',
        isIncome || isRefund ? 'text-green-600' : isXfer ? 'text-foreground/50' : 'text-foreground',
      ].join(' ')}>
        {isIncome || isRefund ? '+' : isXfer ? '' : '−'}{formatCurrency(Math.abs(tx.amount), tx.currency)}
      </span>

      {/* Actions — visible only on row hover; planlanan satırlar düzenlenemez/silinemez */}
      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {!projected && (
          <>
            {tx.type === 'expense' && tx.amount > 0 && (
              <button
                onClick={() => openModal('refund-transaction', { id: tx.id })}
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-green-600 hover:bg-green-500/10 transition-colors"
                title="İade İşle"
              >
                <RefundIcon size={12} />
              </button>
            )}
            <button
              onClick={() => openModal('edit-transaction', { id: tx.id })}
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Düzenle"
            >
              <PencilIcon size={12} />
            </button>
            <DeleteConfirmDialog tx={tx} onDelete={() => removeTx(tx.id)} compact />
          </>
        )}
      </div>
    </div>
  )
})

interface Props {
  transactions: Transaction[]
  layout?: 'cards' | 'table'
  showAccount?: boolean
  emptyTitle?: string
  emptyDescription?: string
  onPersonClick?: (role: PersonRole, id: string) => void
  /** When viewing a single account's detail page, pass the account id so running
   *  balances are always computed for that account (including incoming transfers). */
  primaryAccountId?: string
  /** Ids of projected (henüz gerçekleşmemiş, tekrarlayan şablondan türetilmiş)
   *  transactions — rendered dimmed with a "Planlandı" badge, no edit/delete. */
  projectedIds?: Set<string>
  /** Sıralama seçeneği (filtre çubuğundaki alandan gelir). Varsayılan: yeni → eski. */
  sort?: TxSortOption
  /** Toplu düzenleme: satırlara seçim kutusu ekler (yalnızca table layout). */
  selectable?: boolean
  /** Seçili işlem id'leri (kontrollü). */
  selectedIds?: Set<string>
  /** Tek satır seçimini değiştirir. */
  onToggleSelect?: (id: string) => void
  /** Bir id kümesini toplu seçer/kaldırır ("tümünü seç" için). */
  onSelectMany?: (ids: string[], selected: boolean) => void
}

export function TransactionList({
  transactions,
  layout = 'cards',
  showAccount = true,
  emptyTitle = 'İşlem bulunamadı',
  emptyDescription = 'Filtrelerinizi değiştirin veya yeni işlem ekleyin.',
  primaryAccountId,
  projectedIds,
  sort = 'date-desc',
  selectable = false,
  selectedIds,
  onToggleSelect,
  onSelectMany,
}: Props) {
  const categories = useCategoryStore(s => s.categories)
  const accounts   = useAccountStore(s => s.accounts)
  const people     = usePeopleStore(s => s.people)
  const openModal  = useUIStore(s => s.openModal)
  const removeTx   = useTransactionStore(s => s.remove)
  const allTxs     = useTransactionStore(s => s.transactions)

  // O(1) lookup maps — replace per-row categories/accounts/people .find() scans.
  const catById    = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const accById    = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])
  const personById = useMemo(() => new Map(people.map(p => [p.id, p])), [people])

  // Tek düz satır listesi. Gelecek tarihli işlemler (bugünden sonrası) her zaman
  // ayrı bir "Gelecek İşlemler" bölümünde, gerçekleşenlerle karışmadan gösterilir.
  // Her iki bölüm de seçili sıralamaya uyar (varsayılan: yeni → eski).
  const rows = useMemo<Row[]>(() => {
    const todayStr = today()
    const futureTxs  = transactions.filter(t => t.date > todayStr)
    const currentTxs = transactions.filter(t => t.date <= todayStr)
    const out: Row[] = []
    let dateIdx = 0

    const pushDateGrouped = (txs: Transaction[], future: boolean) => {
      const grouped = groupByDate(txs)
      const dates = [...grouped.keys()].sort((a, b) =>
        sort === 'date-asc' ? a.localeCompare(b) : b.localeCompare(a),
      )
      for (const date of dates) {
        out.push({ kind: 'header', date, dateIdx: dateIdx++, future })
        const day = sortDay(grouped.get(date)!)
        day.forEach((tx, i) => {
          out.push({ kind: 'tx', tx, isFirst: i === 0, isLast: i === day.length - 1, future })
        })
      }
    }

    const pushAmountSorted = (txs: Transaction[], future: boolean) => {
      const sorted = [...txs].sort((a, b) => {
        const d = Math.abs(a.amount) - Math.abs(b.amount)
        return sort === 'amount-asc' ? d : -d
      })
      sorted.forEach((tx, i) => {
        out.push({ kind: 'tx', tx, isFirst: i === 0, isLast: i === sorted.length - 1, future })
      })
    }

    const pushSection = (txs: Transaction[], future: boolean) => {
      if (sort === 'amount-desc' || sort === 'amount-asc') pushAmountSorted(txs, future)
      else pushDateGrouped(txs, future)
    }

    if (futureTxs.length > 0) {
      out.push({ kind: 'section', id: 'future', count: futureTxs.length, first: true })
      pushSection(futureTxs, true)
      if (currentTxs.length > 0) {
        out.push({ kind: 'section', id: 'past', count: currentTxs.length, first: false })
      }
    }
    pushSection(currentTxs, false)
    return out
  }, [transactions, sort])

  // Güncel bakiye (yalnızca table layout). Eski kod her hesap için tüm defteri
  // filter+sort ediyordu → O(hesap × N log N). Artık defteri BİR kez kronolojik
  // sıralayıp tek geçişte süpürüyoruz ve işlem-sonrası bakiyeyi tx.id başına
  // kaydediyoruz. Semantik korunur: bir işleme birden çok izlenen hesap
  // dokunuyorsa neededIds sırasında EN SON gelen hesabın bakiyesi yazılır.
  const runningBalances = useMemo(() => {
    const map = new Map<string, number>()
    if (layout !== 'table') return map

    const neededIds = primaryAccountId
      ? [primaryAccountId]
      : [...new Set(transactions.map(t => t.accountId))]

    const order    = new Map<string, number>()          // hesap → neededIds sırası
    const balances = new Map<string, number>()          // hesap → minor birim (kuruş)
    neededIds.forEach((id, i) => {
      const account = accById.get(id)
      if (!account) return
      order.set(id, i)
      balances.set(id, toMinor(account.initialBalance))
    })
    if (balances.size === 0) return map

    const sorted = [...allTxs].sort((a, b) =>
      (a.date + (a.createdAt ?? '')).localeCompare(b.date + (b.createdAt ?? '')),
    )

    for (const tx of sorted) {
      // Onay kapısı: pending satır bakiyeye hiç işlenmez (isPosted ile tutarlı) —
      // satırın "Güncel Bakiye" hücresi boş kalır.
      if (tx.approvalStatus === 'pending') continue
      let winner: string | undefined
      let winnerRank = -1
      const consider = (id: string) => {
        const rank = order.get(id)
        if (rank !== undefined && rank > winnerRank) { winnerRank = rank; winner = id }
      }

      if (tx.type === 'income' && balances.has(tx.accountId)) {
        balances.set(tx.accountId, balances.get(tx.accountId)! + toMinor(tx.amount))
        consider(tx.accountId)
      } else if (tx.type === 'expense' && balances.has(tx.accountId)) {
        balances.set(tx.accountId, balances.get(tx.accountId)! - toMinor(tx.amount))
        consider(tx.accountId)
      } else if (tx.type === 'transfer') {
        if (balances.has(tx.accountId)) {
          balances.set(tx.accountId, balances.get(tx.accountId)! - toMinor(tx.amount))
          consider(tx.accountId)
        }
        if (tx.toAccountId && balances.has(tx.toAccountId)) {
          balances.set(tx.toAccountId, balances.get(tx.toAccountId)! + toMinor(tx.amount))
          consider(tx.toAccountId)
        }
      }

      if (winner !== undefined) map.set(tx.id, toMajor(balances.get(winner)!))
    }
    return map
  }, [layout, primaryAccountId, transactions, allTxs, accById])

  // Toplu seçim için uygun satırlar: planlanan (projected) işlemler düzenlenemez,
  // bu yüzden "tümünü seç" kapsamı dışında tutulur.
  const eligibleIds = useMemo(
    () => (selectable
      ? transactions.filter(t => !projectedIds?.has(t.id)).map(t => t.id)
      : []),
    [selectable, transactions, projectedIds],
  )
  const allSelected = eligibleIds.length > 0 && eligibleIds.every(id => selectedIds?.has(id))
  const someSelected = !allSelected && eligibleIds.some(id => selectedIds?.has(id))

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: i => {
      const r = rows[i]
      if (r.kind === 'section') return 44
      if (r.kind === 'header')  return 52
      return layout === 'table' ? 64 : 60
    },
    overscan: 12,
    getItemKey: i => {
      const r = rows[i]
      if (r.kind === 'section') return `s:${r.id}`
      return r.kind === 'header' ? `h:${r.future ? 'f' : 'p'}:${r.date}` : `t:${r.tx.id}`
    },
  })

  if (transactions.length === 0) {
    return <EmptyState icon="↕" title={emptyTitle} description={emptyDescription} />
  }

  const virtualItems = virtualizer.getVirtualItems()

  // ── TABLE layout ─────────────────────────────────────────────────────────
  if (layout === 'table') {
    // Tarih/bölüm ayraçlarını açıklama kolonunun içeriğiyle hizala: seçim kutusu
    // kolonu (varsa) + açıklama hücresinin sol padding'i (px-3 = 12px).
    const contentInsetLeft = (selectable ? SELECT_COL_W : 0) + 12
    return (
      <div ref={parentRef} className="h-[calc(100vh-220px)] overflow-auto mx-6 my-3 rounded-xl border border-border/70 bg-card">
        <div style={{ minWidth: TABLE_MIN_W + (selectable ? SELECT_COL_W : 0) }}>

          {/* Sticky column headers — kart yüzeyiyle aynı renk */}
          <div className="sticky top-0 z-10 bg-card border-b border-border">
            <div className="grid" style={{ gridTemplateColumns: colsFor(selectable) }}>
              {selectable && (
                <div className="flex items-center justify-center py-1.5">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={() => onSelectMany?.(eligibleIds, !allSelected)}
                    disabled={eligibleIds.length === 0}
                    aria-label="Tümünü seç"
                  />
                </div>
              )}
              {['Açıklama', 'Hesap', 'Alıcı Hesap', 'Alıcı', 'Aile Üyesi', 'Kategori', 'Miktar', 'Güncel Bakiye', ''].map((h, i) => (
                <div
                  key={i}
                  className={[
                    'py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 select-none',
                    h === 'Açıklama' ? 'px-3' : h === 'Miktar' || h === 'Güncel Bakiye' ? 'px-3 text-right' : 'px-2',
                  ].join(' ')}
                >
                  {h}
                </div>
              ))}
            </div>
          </div>

          {/* Virtualized rows — kart içinde tam genişlik, hücre padding'i inset verir */}
          <div>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {virtualItems.map(vi => {
                const row = rows[vi.index]
                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
                  >
                    {row.kind === 'section' ? (
                      <div style={{ paddingLeft: contentInsetLeft, paddingRight: 12 }}><SectionBanner id={row.id} count={row.count} topClass={row.first ? 'pt-1' : 'pt-4'} /></div>
                    ) : row.kind === 'header' ? (
                      <div style={{ paddingLeft: contentInsetLeft, paddingRight: 12 }}><DateSeparator date={row.date} topClass={row.dateIdx > 0 ? 'pt-6 pb-3' : 'pt-3 pb-3'} future={row.future} /></div>
                    ) : (
                      <TableTxRow
                        tx={row.tx}
                        future={row.future}
                        cat={row.tx.categoryId ? catById.get(row.tx.categoryId) : undefined}
                        account={accById.get(row.tx.accountId)}
                        toAccount={row.tx.toAccountId ? accById.get(row.tx.toAccountId) : undefined}
                        recipient={row.tx.recipientId ? personById.get(row.tx.recipientId) : undefined}
                        family={row.tx.familyMemberId ? personById.get(row.tx.familyMemberId) : undefined}
                        balanceAfter={runningBalances.get(row.tx.id)}
                        projected={projectedIds?.has(row.tx.id)}
                        openModal={openModal}
                        removeTx={removeTx}
                        selectable={selectable}
                        selected={selectedIds?.has(row.tx.id)}
                        onToggleSelect={onToggleSelect}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── CARDS layout (compact minimal) ────────────────────────────────────────
  return (
    <div ref={parentRef} className="h-[calc(100vh-220px)] overflow-y-auto">
      <div className="px-4 py-2">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualItems.map(vi => {
            const row = rows[vi.index]
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
              >
                {row.kind === 'section' ? (
                  <SectionBanner id={row.id} count={row.count} topClass={row.first ? 'pt-1' : 'pt-5'} />
                ) : row.kind === 'header' ? (
                  <DateSeparator date={row.date} topClass={row.dateIdx > 0 ? 'pt-5 pb-2.5' : 'pt-2 pb-2.5'} future={row.future} />
                ) : (
                  <CardTxRow
                    tx={row.tx}
                    future={row.future}
                    cat={row.tx.categoryId ? catById.get(row.tx.categoryId) : undefined}
                    account={accById.get(row.tx.accountId)}
                    recipient={row.tx.recipientId ? personById.get(row.tx.recipientId) : undefined}
                    family={row.tx.familyMemberId ? personById.get(row.tx.familyMemberId) : undefined}
                    showAccount={showAccount}
                    projected={projectedIds?.has(row.tx.id)}
                    openModal={openModal}
                    removeTx={removeTx}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
