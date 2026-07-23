'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertDialog } from 'radix-ui'
import { SelectField } from '@/components/ui/Select'
import { Checkbox } from '@/components/ui/Checkbox'
import { useTransactionStore, useCategoryStore, usePeopleStore, useInvestmentStore } from '@/store'
import { compareCategoriesByName } from '@/lib/utils/categories'
import { findLinkedInvestSell } from '@/components/transactions/TransactionList'
import type { Transaction } from '@/types'

// Toplu düzenleme — yalnızca mutabakat gerektirmeyen "güvenli" alanlar. amount/
// type/borç alanları bilinçli olarak dışarıda (bkz. transactions.store.updateMany).
type FieldKey = 'category' | 'family' | 'recipient' | 'tags' | 'date'

const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
)

// Alan açma satırı: özel checkbox + tıklanabilir etiket. Modül seviyesinde
// (render içinde tanımlanmaz — aksi halde her render'da yeniden oluşturulur).
function FieldToggle({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-foreground select-none">
      <Checkbox checked={checked} onChange={onToggle} aria-label={`${label} alanını değiştir`} />
      <button type="button" onClick={onToggle} className="cursor-pointer">{label}</button>
    </div>
  )
}

export function BatchEditDrawer({
  selectedIds,
  onClose,
}: {
  selectedIds: string[]
  onClose: () => void
}) {
  const updateMany = useTransactionStore(s => s.updateMany)
  const removeMany = useTransactionStore(s => s.removeMany)
  const allTx      = useTransactionStore(s => s.transactions)
  const investTxs  = useInvestmentStore(s => s.transactions)
  const categories = useCategoryStore(s => s.categories)
  const people     = usePeopleStore(s => s.people)

  const open  = selectedIds.length > 0
  const count = selectedIds.length

  // Silinebilir seçim: yatırım satışına bağlı satırlar (özel temizlik gerektirir)
  // toplu silmeden hariç — bunlar listede tek tek silinmeli (bkz. removeMany yorumu).
  const deletable = useMemo(() => {
    const byId = new Map(allTx.map(t => [t.id, t]))
    const sel = selectedIds.map(id => byId.get(id)).filter(Boolean) as Transaction[]
    return sel.filter(t => !findLinkedInvestSell(t, investTxs))
  }, [allTx, selectedIds, investTxs])
  const excludedInvest = count - deletable.length
  const hasInstallment = deletable.some(t => t.installGroupId)
  const hasDebt        = deletable.some(t => t.debtId)

  const [enabled, setEnabled] = useState<Record<FieldKey, boolean>>({
    category: false, family: false, recipient: false, tags: false, date: false,
  })
  const [category, setCategory] = useState('')
  const [family, setFamily]     = useState('')
  const [recipient, setRecipient] = useState('')
  const [tags, setTags]         = useState('')
  const [date, setDate]         = useState('')
  const [saving, setSaving]     = useState(false)
  const [deleting, setDeleting] = useState(false)

  function reset() {
    setEnabled({ category: false, family: false, recipient: false, tags: false, date: false })
    setCategory(''); setFamily(''); setRecipient(''); setTags(''); setDate('')
  }

  // Seçim tamamen kalkınca (X / Vazgeç / uygula / filtre değişimi) formu sıfırla.
  useEffect(() => { if (!open) reset() }, [open])

  const categoryOptions = useMemo(() => [
    { value: '', label: 'Kategori seç…', disabled: true },
    ...[...categories].sort(compareCategoriesByName).map(c => ({ value: c.id, label: c.name })),
  ], [categories])

  const familyOptions = useMemo(() => [
    { value: '', label: '— Kaldır —' },
    ...people.filter(p => p.role === 'family_member' && !p.isArchived)
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map(p => ({ value: p.id, label: p.name })),
  ], [people])

  const recipientOptions = useMemo(() => [
    { value: '', label: '— Kaldır —' },
    ...people.filter(p => p.role === 'recipient' && !p.isArchived)
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map(p => ({ value: p.id, label: p.name })),
  ], [people])

  // Uygulanabilir mi? En az bir alan açık ve (varsa) geçerli değere sahip olmalı.
  const canApply =
    (enabled.category && !!category) ||
    enabled.family ||
    enabled.recipient ||
    (enabled.tags && tags.trim().length > 0) ||
    (enabled.date && !!date)

  async function handleApply() {
    if (!canApply || saving) return
    const patch: Partial<Transaction> = {}
    if (enabled.category && category) patch.categoryId = category
    if (enabled.family)    patch.familyMemberId = family || null
    if (enabled.recipient) patch.recipientId = recipient || null
    if (enabled.date && date) patch.date = date
    const addTags = enabled.tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : []

    setSaving(true)
    try {
      await updateMany(selectedIds, patch, { addTags })
    } finally {
      setSaving(false)
    }
    reset()
    onClose()
  }

  async function handleDelete() {
    if (deleting || deletable.length === 0) return
    setDeleting(true)
    try {
      await removeMany(deletable.map(t => t.id))
    } finally {
      setDeleting(false)
    }
    reset()
    onClose()
  }

  function toggle(key: FieldKey) {
    setEnabled(e => ({ ...e, [key]: !e[key] }))
  }

  const fieldCls = (on: boolean) =>
    `rounded-xl border p-3 transition-colors ${on ? 'border-[var(--batch-accent)] bg-[var(--batch-accent-soft)]' : 'border-border'}`

  return (
    <aside
      aria-hidden={!open}
      className={[
        'fixed right-0 top-0 bottom-0 z-40 w-[340px] max-w-[90vw]',
        'bg-card border-l border-border shadow-2xl',
        'flex flex-col transition-transform duration-300 ease-out',
        open ? 'translate-x-0' : 'translate-x-full',
      ].join(' ')}
    >
      {/* Başlık */}
      <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-border flex-shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">Toplu Düzenle</div>
          <div className="text-xs font-medium text-[var(--batch-accent)]">{count} işlem seçili</div>
        </div>
        <button
          onClick={onClose}
          title="Kapat"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
        >
          <XIcon />
        </button>
      </div>

      {/* Alanlar */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Değiştirmek istediğin alanları aç. Yalnızca <span className="font-medium text-foreground">işaretli alanlar</span> tüm seçili işlemlere uygulanır.
        </p>

        {/* Kategori */}
        <div className={fieldCls(enabled.category)}>
          <FieldToggle checked={enabled.category} onToggle={() => toggle('category')} label="Kategori" />
          {enabled.category && (
            <div className="mt-2.5">
              <SelectField value={category} onChange={e => setCategory(e.target.value)} options={categoryOptions} placeholder="Kategori seç…" className="text-xs" />
            </div>
          )}
        </div>

        {/* Aile üyesi */}
        <div className={fieldCls(enabled.family)}>
          <FieldToggle checked={enabled.family} onToggle={() => toggle('family')} label="Aile üyesi" />
          {enabled.family && (
            <div className="mt-2.5">
              <SelectField value={family} onChange={e => setFamily(e.target.value)} options={familyOptions} className="text-xs" />
            </div>
          )}
        </div>

        {/* Alıcı */}
        <div className={fieldCls(enabled.recipient)}>
          <FieldToggle checked={enabled.recipient} onToggle={() => toggle('recipient')} label="Alıcı" />
          {enabled.recipient && (
            <div className="mt-2.5">
              <SelectField value={recipient} onChange={e => setRecipient(e.target.value)} options={recipientOptions} className="text-xs" />
            </div>
          )}
        </div>

        {/* Etiket ekle */}
        <div className={fieldCls(enabled.tags)}>
          <FieldToggle checked={enabled.tags} onToggle={() => toggle('tags')} label="Etiket ekle" />
          {enabled.tags && (
            <div className="mt-2.5">
              <input
                type="text"
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder="ör. iş, tatil (virgülle ayır)"
                className="w-full h-9 rounded-xl border border-input bg-transparent px-3 text-xs text-foreground outline-none focus:border-ring placeholder:text-muted-foreground/60"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground/70">Mevcut etiketlerin üstüne eklenir, silmez.</p>
            </div>
          )}
        </div>

        {/* Tarih */}
        <div className={fieldCls(enabled.date)}>
          <FieldToggle checked={enabled.date} onToggle={() => toggle('date')} label="Tarih" />
          {enabled.date && (
            <div className="mt-2.5">
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full h-9 rounded-xl border border-input bg-transparent px-3 text-xs text-foreground outline-none focus:border-ring"
              />
            </div>
          )}
        </div>

        {/* Kilitli: miktar/tür — mutabakat güvenliği için toplu düzenlemede değişmez */}
        <div className="rounded-xl border border-dashed border-border p-3 opacity-70">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            Miktar / Tür
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground/70 leading-relaxed">
            Borç ve taksit mutabakatını bozmamak için toplu düzenlemede değiştirilemez. Tek tek düzenleyerek değiştir.
          </p>
        </div>
      </div>

      {/* Alt eylem çubuğu */}
      <div className="flex flex-col gap-2 px-4 py-3 border-t border-border flex-shrink-0">
        {/* Yıkıcı: seçilenleri sil (onaylı) */}
        <AlertDialog.Root>
          <AlertDialog.Trigger asChild>
            <button
              disabled={deletable.length === 0 || deleting}
              className="w-full h-9 rounded-xl border border-destructive/40 text-destructive text-xs font-semibold hover:bg-destructive/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5"
            >
              <TrashIcon />
              {deleting ? 'Siliniyor…' : `Seçilenleri Sil (${deletable.length})`}
            </button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
            <AlertDialog.Content className={[
              'fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
              'w-[380px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-background p-6 shadow-xl',
              'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            ].join(' ')}>
              <AlertDialog.Title className="text-base font-semibold text-foreground mb-1">
                {deletable.length} işlem silinsin mi?
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-muted-foreground mb-5">
                Seçili işlemler kalıcı olarak silinecek — istersen hemen <span className="font-medium text-foreground">geri alabilirsin</span>.
                {hasInstallment && ' Taksitli işlemler, satın almanın tüm taksitleriyle birlikte silinir.'}
                {hasDebt && ' Borç ödemesi işlemleri, borç bakiyesine katkılarıyla birlikte geri alınır.'}
                {excludedInvest > 0 && ` ${excludedInvest} yatırım satışına bağlı işlem toplu silmeye dahil edilmedi — bunları listede tek tek sil.`}
              </AlertDialog.Description>
              <div className="flex justify-end gap-2">
                <AlertDialog.Cancel asChild>
                  <button className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-accent transition-colors">
                    İptal
                  </button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <button
                    onClick={handleDelete}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors"
                  >
                    Sil
                  </button>
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-xl border border-border text-xs font-semibold text-foreground hover:bg-accent transition-colors"
          >
            Vazgeç
          </button>
          <button
            onClick={handleApply}
            disabled={!canApply || saving}
            className="flex-1 h-9 rounded-xl bg-[var(--batch-accent)] text-white text-xs font-semibold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {saving ? 'Uygulanıyor…' : `Uygula (${count})`}
          </button>
        </div>
      </div>
    </aside>
  )
}
