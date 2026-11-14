'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, History, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAccountStore, useCategoryStore, usePeopleStore, useTransactionStore } from '@/store'
import { useRulesStore } from '@/store/rules.store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { SelectField } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { CategoryCascadeSelect } from '@/components/categories/CategoryCascadeSelect'
import { PersonSelect } from '@/components/people/PersonSelect'
import { TagInput } from '@/components/transactions/TagInput'
import { useTags } from '@/lib/hooks/useTags'
import { formatCurrency, parseCurrencyInput } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import {
  MATCH_KIND_LABELS, normalizeRulePattern, previewRuleOnHistory, sortRules,
  transactionsMatchingRule, validateRule, type RuleHistoryChange,
} from '@/lib/utils/transaction-rules'
import type { Category, TransactionRule } from '@/types'

/* ── İşlem Kuralları yönetimi ────────────────────────────────────────────────
   Ekle / düzenle / sil / sırala, "N işlemle eşleşiyor" önizlemesi ve isteğe
   bağlı "geçmiş işlemlere uygula" (kullanıcının onayladığı liste; geri
   alınabilir). Eşleştirme: lib/utils/transaction-rules.ts. */

function categoryPath(id: string | null | undefined, categories: readonly Category[]): string | undefined {
  if (!id) return undefined
  const byId = new Map(categories.map(c => [c.id, c]))
  const names: string[] = []
  let c = byId.get(id)
  let guard = 0
  while (c && guard++ < 5) { names.unshift(c.name); c = c.parentId ? byId.get(c.parentId) : undefined }
  return names.length ? names.join(' › ') : undefined
}

const amountText = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))
const parseAmount = (s: string): number | null => (s.trim() ? parseCurrencyInput(s) : null)

interface RuleForm {
  pattern: string
  matchKind: TransactionRule['matchKind']
  txType: '' | 'expense' | 'income'
  accountId: string
  minAmount: string
  maxAmount: string
  categoryId: string
  tags: string[]
  recipientId: string
  isActive: boolean
}

function formOf(rule: TransactionRule | null, pattern = ''): RuleForm {
  return {
    pattern:    rule?.pattern ?? pattern,
    matchKind:  rule?.matchKind ?? 'contains',
    txType:     rule?.txType ?? '',
    accountId:  rule?.accountId ?? '',
    minAmount:  amountText(rule?.minAmount),
    maxAmount:  amountText(rule?.maxAmount),
    categoryId: rule?.categoryId ?? '',
    tags:       rule?.tags ?? [],
    recipientId: rule?.recipientId ?? '',
    isActive:   rule?.isActive ?? true,
  }
}

function ruleFields(f: RuleForm) {
  return {
    pattern:     normalizeRulePattern(f.pattern),
    matchKind:   f.matchKind,
    txType:      f.txType || null,
    accountId:   f.accountId || null,
    minAmount:   parseAmount(f.minAmount),
    maxAmount:   parseAmount(f.maxAmount),
    categoryId:  f.categoryId || null,
    tags:        f.tags.length ? f.tags : null,
    recipientId: f.recipientId || null,
    isActive:    f.isActive,
  }
}

export function RulesManager({ initialPattern }: { initialPattern?: string }) {
  const rules        = useRulesStore(s => s.rules)
  const ready        = useRulesStore(s => s.ready)
  const removeRule   = useRulesStore(s => s.remove)
  const move         = useRulesStore(s => s.move)
  const updateRule   = useRulesStore(s => s.update)
  const transactions = useTransactionStore(s => s.transactions)
  const categories   = useCategoryStore(s => s.categories)
  const accounts     = useAccountStore(s => s.accounts)
  const people       = usePeopleStore(s => s.people)

  // Kısayoldan (?yeni=…) gelindiyse düzenleyici o açıklamayla açık başlar
  const [editing, setEditing] = useState<{ rule: TransactionRule | null; pattern?: string } | null>(
    () => (initialPattern ? { rule: null, pattern: initialPattern } : null),
  )
  const [applying, setApplying] = useState<TransactionRule | null>(null)

  const ordered = useMemo(() => sortRules(rules), [rules])
  const matchCounts = useMemo(
    () => new Map(ordered.map(r => [r.id, transactionsMatchingRule(r, transactions).length])),
    [ordered, transactions],
  )
  const accountName = (id?: string | null) => accounts.find(a => a.id === id)?.name
  const personName  = (id?: string | null) => people.find(p => p.id === id)?.name

  function describe(r: TransactionRule): string {
    const cond: string[] = [`açıklama “${r.pattern}” ${MATCH_KIND_LABELS[r.matchKind]}`]
    if (r.txType) cond.push(r.txType === 'expense' ? 'giderse' : 'gelirse')
    if (r.accountId) cond.push(`hesap ${accountName(r.accountId) ?? '(silinmiş hesap)'}`)
    if (r.minAmount != null && r.maxAmount != null) cond.push(`tutar ${r.minAmount}–${r.maxAmount}`)
    else if (r.minAmount != null) cond.push(`tutar ≥ ${r.minAmount}`)
    else if (r.maxAmount != null) cond.push(`tutar ≤ ${r.maxAmount}`)
    const act: string[] = []
    if (r.categoryId) act.push(`kategori ${categoryPath(r.categoryId, categories) ?? '(silinmiş kategori)'}`)
    if (r.tags?.length) act.push(`etiket ${r.tags.map(t => `#${t}`).join(' ')}`)
    if (r.recipientId) act.push(`alıcı ${personName(r.recipientId) ?? '(silinmiş alıcı)'}`)
    return `${cond.join(', ')} → ${act.join(', ')}`
  }

  return (
    <div className="p-6 flex flex-col gap-4 max-w-3xl mx-auto w-full">
      <div className="flex items-start justify-between gap-4">
        <div className="text-xs text-muted-foreground max-w-xl">
          Kurallar yukarıdan aşağı denenir, <b>ilk eşleşen</b> uygulanır ve kategori anahtar
          kelimesi ile alıcı geçmişi önerisinden önce gelir. İşlem formunda ve ekstre içe
          aktarmada yalnız öneri olarak çalışır; elle seçtiğin değeri değiştirmez. Büyük-küçük
          harf ve Türkçe karakter farkı (MIGROS = Migros, SOK = Şok) önemsenmez.
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link href="/categories" className="text-xs text-muted-foreground hover:text-foreground">Kategoriler</Link>
          <Button size="sm" onClick={() => setEditing({ rule: null })} leftIcon={<Plus className="size-3.5" />}>
            Kural ekle
          </Button>
        </div>
      </div>

      {ready && ordered.length === 0 ? (
        <EmptyState
          title="Henüz kural yok"
          description="Örneğin: açıklama “migros” içeriyorsa → Market kategorisi, #market etiketi. İşlem listesinde bir satırın üzerindeki sihirli değnekle de başlayabilirsin."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {ordered.map((r, i) => (
            <li key={r.id} className={`flex items-center gap-3 px-3 py-2.5 ${r.isActive ? '' : 'opacity-55'}`}>
              <span className="w-6 text-xs tabular-nums text-muted-foreground text-right flex-shrink-0">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate" title={describe(r)}>{describe(r)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {r.isActive ? '' : 'Kapalı · '}
                  Mevcut {matchCounts.get(r.id) ?? 0} işlemle eşleşiyor
                </div>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <Button size="icon-sm" variant="ghost" title="Yukarı" disabled={i === 0} onClick={() => void move(r.id, -1)}><ArrowUp /></Button>
                <Button size="icon-sm" variant="ghost" title="Aşağı" disabled={i === ordered.length - 1} onClick={() => void move(r.id, 1)}><ArrowDown /></Button>
                <Button size="icon-sm" variant="ghost" title={r.isActive ? 'Kapat' : 'Aç'} onClick={() => void updateRule(r.id, { isActive: !r.isActive })}>
                  <span className={`size-2.5 rounded-full ${r.isActive ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
                </Button>
                <Button size="icon-sm" variant="ghost" title="Geçmiş işlemlere uygula" disabled={!matchCounts.get(r.id)} onClick={() => setApplying(r)}><History /></Button>
                <Button size="icon-sm" variant="ghost" title="Düzenle" onClick={() => setEditing({ rule: r })}><Pencil /></Button>
                <Button size="icon-sm" variant="ghost" title="Sil" onClick={() => void removeRule(r.id)}><Trash2 /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <RuleEditModal
          rule={editing.rule}
          initialPattern={editing.pattern}
          onClose={() => setEditing(null)}
          onSaved={rule => { setEditing(null); if (transactionsMatchingRule(rule, transactions).length) setApplying(rule) }}
        />
      )}
      {applying && <ApplyToHistoryModal rule={applying} onClose={() => setApplying(null)} />}
    </div>
  )
}

/* ── Ekle / düzenle ─────────────────────────────────────────────────────────── */

function RuleEditModal({ rule, initialPattern, onClose, onSaved }: {
  rule: TransactionRule | null
  initialPattern?: string
  onClose: () => void
  /** Kaydedildi; çağıran "geçmişe uygula" önerebilir */
  onSaved: (rule: TransactionRule) => void
}) {
  const add          = useRulesStore(s => s.add)
  const update       = useRulesStore(s => s.update)
  const nextSort     = useRulesStore(s => s.nextSortOrder)
  const transactions = useTransactionStore(s => s.transactions)
  const categories   = useCategoryStore(s => s.categories)
  const accounts     = useAccountStore(s => s.accounts)
  const people       = usePeopleStore(s => s.people)
  const tagPool      = useTags()

  const [f, setF] = useState<RuleForm>(() => formOf(rule, initialPattern))
  const [errors, setErrors] = useState<ReturnType<typeof validateRule>>({})
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<RuleForm>) => setF(prev => ({ ...prev, ...p }))

  const recipients = useMemo(() => people.filter(p => p.role === 'recipient' && !p.isArchived), [people])
  // Tür seçiliyse yalnız o kapsamdaki kategoriler; değilse ikisi (kural türü
  // uyuşmayan işlemde kategoriyi atlar — bkz. ruleOutcome)
  const pickable = useMemo(
    () => categories.filter(c => !c.isArchived && (!f.txType || c.scope === f.txType)),
    [categories, f.txType],
  )
  const accountOptions = useMemo(() => [
    { value: '', label: 'Tüm hesaplar' },
    ...accounts.filter(a => !a.isArchived || a.id === f.accountId).map(a => ({ value: a.id, label: a.name })),
  ], [accounts, f.accountId])

  const probe: TransactionRule = useMemo(() => ({
    id: rule?.id ?? 'onizleme', sortOrder: 0, createdAt: '', updatedAt: '',
    ...ruleFields(f), isActive: true,
  }), [f, rule?.id])
  const matched = useMemo(
    () => (normalizeRulePattern(f.pattern) ? transactionsMatchingRule(probe, transactions) : []),
    [probe, f.pattern, transactions],
  )

  async function save() {
    const fields = ruleFields(f)
    const errs = validateRule(fields)
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
      if (rule) {
        await update(rule.id, fields)
        onSaved({ ...rule, ...fields, updatedAt: now })
      } else {
        const created: TransactionRule = {
          id: crypto.randomUUID(), ...fields, sortOrder: nextSort(), createdAt: now, updatedAt: now,
        }
        await add(created)
        onSaved(created)
      }
    } catch (err) {
      console.error('[rules:save]', err)
      setErrors({ pattern: 'Kaydedilemedi, tekrar deneyin' })
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={rule ? 'Kuralı düzenle' : 'Yeni kural'} size="lg">
      <div className="flex flex-col gap-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Koşullar</div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
          <Input
            label="Açıklama"
            autoFocus
            value={f.pattern}
            onChange={e => set({ pattern: e.target.value })}
            placeholder="ör. migros"
            error={errors.pattern}
          />
          <SelectField
            label="Eşleşme"
            value={f.matchKind}
            onChange={e => set({ matchKind: e.target.value as RuleForm['matchKind'] })}
            options={[
              { value: 'contains', label: 'içeriyorsa' },
              { value: 'startsWith', label: 'ile başlıyorsa' },
              { value: 'equals', label: 'tam olarak buysa' },
            ]}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField
            label="Tür"
            value={f.txType}
            onChange={e => set({ txType: e.target.value as RuleForm['txType'] })}
            options={[
              { value: '', label: 'Gider ve gelir' },
              { value: 'expense', label: 'Yalnız gider' },
              { value: 'income', label: 'Yalnız gelir' },
            ]}
          />
          <SelectField label="Hesap" value={f.accountId} onChange={e => set({ accountId: e.target.value })} options={accountOptions} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="En az tutar (isteğe bağlı)" inputMode="decimal" value={f.minAmount} onChange={e => set({ minAmount: e.target.value })} placeholder="0" />
          <Input label="En çok tutar (isteğe bağlı)" inputMode="decimal" value={f.maxAmount} onChange={e => set({ maxAmount: e.target.value })} placeholder="∞" error={errors.amount} />
        </div>

        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground pt-2">Eylemler</div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Kategori ata</span>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <CategoryCascadeSelect categories={pickable} value={f.categoryId} onChange={id => set({ categoryId: id })} placeholder="Kategori değişmesin" />
            </div>
            {f.categoryId && <Button size="sm" variant="ghost" onClick={() => set({ categoryId: '' })}>Temizle</Button>}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Etiket ekle</span>
          <TagInput value={f.tags} onChange={tags => set({ tags })} tags={tagPool} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Alıcı ata</span>
          <PersonSelect people={recipients} value={f.recipientId || null} onChange={id => set({ recipientId: id ?? '' })} placeholder="Alıcı değişmesin" />
        </div>
        {errors.actions && <div className="text-xs text-destructive">{errors.actions}</div>}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.isActive} onChange={e => set({ isActive: e.target.checked })} />
          Kural açık
        </label>

        <div className="rounded-lg bg-background px-3 py-2 text-xs text-muted-foreground">
          {normalizeRulePattern(f.pattern)
            ? <>Bu kural mevcut <b className="text-foreground">{matched.length}</b> işlemle eşleşiyor
                {matched.length > 0 && <>: {matched.slice(0, 3).map(t => `“${t.description}”`).join(', ')}{matched.length > 3 ? '…' : ''}</>}.
                {' '}Kaydettikten sonra istersen geçmiş işlemlere uygulayabilirsin.</>
            : 'Açıklama yazınca kaç işlemle eşleştiği burada görünür.'}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>İptal</Button>
          <Button onClick={() => void save()} loading={saving}>Kaydet</Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Geçmiş işlemlere uygula ────────────────────────────────────────────────── */

function ApplyToHistoryModal({ rule, onClose }: { rule: TransactionRule; onClose: () => void }) {
  const transactions = useTransactionStore(s => s.transactions)
  const categories   = useCategoryStore(s => s.categories)
  const people       = usePeopleStore(s => s.people)
  const applyToHistory = useRulesStore(s => s.applyToHistory)

  // Liste açıldığı anda sabitlenir: arka planda gelen değişiklik onaylanan
  // listeyi kaydırmasın
  const [{ matched, changes }] = useState(() => previewRuleOnHistory(rule, transactions, categories, people))
  const [selected, setSelected] = useState<Set<string>>(() => new Set(changes.map(c => c.tx.id)))
  const [busy, setBusy] = useState(false)

  const catName = (id?: string | null) => categoryPath(id, categories) ?? 'kategorisiz'
  const personName = (id?: string | null) => people.find(p => p.id === id)?.name ?? 'alıcısız'

  function describeChange(c: RuleHistoryChange): string {
    const bits: string[] = []
    if ('categoryId' in c.patch) bits.push(`${catName(c.tx.categoryId)} → ${catName(c.patch.categoryId)}`)
    if (c.patch.tags) bits.push(`+${c.patch.tags.filter(t => !(c.tx.tags ?? []).includes(t)).map(t => `#${t}`).join(' ')}`)
    if ('recipientId' in c.patch) bits.push(`${personName(c.tx.recipientId)} → ${personName(c.patch.recipientId)}`)
    return bits.join(' · ')
  }

  async function apply() {
    setBusy(true)
    try {
      await applyToHistory(changes.filter(c => selected.has(c.tx.id)))
      onClose()
    } catch (err) {
      console.error('[rules:apply-history]', err)
      setBusy(false)
    }
  }

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <Modal open onClose={onClose} title="Geçmiş işlemlere uygula" size="lg">
      <div className="flex flex-col gap-3">
        <div className="text-xs text-muted-foreground">
          “{rule.pattern}” kuralı mevcut {matched.length} işlemle eşleşiyor; {changes.length} tanesinde bir şey değişecek
          {matched.length > changes.length ? ` (${matched.length - changes.length} tanesi zaten uygun)` : ''}.
          Yalnız işaretlediklerin güncellenir; etiketler eklenir, mevcutlar silinmez; bölünmüş işlemlerin
          kategorisine dokunulmaz. Uyguladıktan sonra birkaç saniye “Geri al” ile geri alabilirsin.
        </div>
        {changes.length > 0 && (
          <div className="flex items-center gap-3 text-xs">
            <button className="text-primary hover:underline" onClick={() => setSelected(new Set(changes.map(c => c.tx.id)))}>Tümünü seç</button>
            <button className="text-primary hover:underline" onClick={() => setSelected(new Set())}>Hiçbiri</button>
            <span className="text-muted-foreground">{selected.size} seçili</span>
          </div>
        )}
        <ul className="max-h-[50vh] overflow-y-auto flex flex-col divide-y divide-border rounded-lg border border-border">
          {changes.map(c => (
            <li key={c.tx.id}>
              <label className="flex items-start gap-2 px-3 py-2 text-sm cursor-pointer">
                <input type="checkbox" className="mt-1" checked={selected.has(c.tx.id)} onChange={() => toggle(c.tx.id)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate">{c.tx.description || '—'}</span>
                    <span className="tabular-nums text-xs text-muted-foreground flex-shrink-0">
                      {formatDate(c.tx.date)} · {formatCurrency(Math.abs(c.tx.amount), c.tx.currency)}
                    </span>
                  </span>
                  <span className="block text-xs text-muted-foreground truncate">{describeChange(c)}</span>
                </span>
              </label>
            </li>
          ))}
          {changes.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">Değişecek işlem yok — eşleşenlerin hepsi zaten kurala uygun.</li>}
        </ul>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Vazgeç</Button>
          <Button onClick={() => void apply()} loading={busy} disabled={selected.size === 0}>
            {selected.size} işlemi güncelle
          </Button>
        </div>
      </div>
    </Modal>
  )
}
