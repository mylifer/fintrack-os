'use client'

import { useMemo, useState } from 'react'
import { useCategoryStore } from '@/store'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/Select'
import { CategoryIconPicker } from '../CategoryIconPicker'
import { compareCategoriesByName } from '@/lib/utils/categories'
import type { Category, CategoryScope } from '@/types'

/* Kategori ekle / düzenle. Her iki görünümün ortak düzenleme yüzeyi: satır içi
   form yerine tek modal, çünkü 32px'lik dizin satırı ikon seçici + iki üst
   kategori kutusu taşıyamaz. Bağlı işlemlere DOKUNULMAZ. */

interface Props {
  /** Ekleme modunda yeni kategorinin kapsamı; düzenlemede kategorininki kullanılır. */
  scope: CategoryScope
  /** Verilmezse ekleme modu. */
  category?: Category
  /** Ekleme modunda ön seçili üst kategori ("alt kategori ekle" akışı). */
  parentId?: string
  onClose: () => void
}

export function CategoryEditModal({ scope, category, parentId, onClose }: Props) {
  const categories = useCategoryStore(s => s.categories)
  const add        = useCategoryStore(s => s.add)
  const update     = useCategoryStore(s => s.update)

  const isEdit = !!category

  /* Seviye/soy hesapları arşivlileri de kapsar: derinlik koruması arşivden
     geri gelecek bir alt ağacı da hesaba katmalı. */
  const levelOf = useMemo(() => {
    const byId = new Map(categories.map(c => [c.id, c]))
    return (id: string): 0 | 1 | 2 => {
      const c = byId.get(id)
      if (!c?.parentId) return 0
      return byId.get(c.parentId)?.parentId ? 2 : 1
    }
  }, [categories])

  const descendantsOf = useMemo(() => {
    return (id: string): Set<string> => {
      const out = new Set<string>([id])
      const walk = (pid: string) => {
        for (const c of categories) {
          if (c.parentId === pid && !out.has(c.id)) { out.add(c.id); walk(c.id) }
        }
      }
      walk(id)
      return out
    }
  }, [categories])

  /** Bir kategorinin altındaki derinlik: yaprak → 0, çocuğu var → 1, torunu var → 2. */
  const subtreeHeight = useMemo(() => {
    const heightOf = (id: string): number => {
      const kids = categories.filter(c => c.parentId === id)
      return kids.length === 0 ? 0 : 1 + Math.max(...kids.map(k => heightOf(k.id)))
    }
    return heightOf
  }, [categories])

  const initialLevel = category ? levelOf(category.id) : (parentId ? levelOf(parentId) + 1 : 0)

  const [name,  setName]  = useState(category?.name ?? '')
  const [icon,  setIcon]  = useState(category?.icon ?? 'package')
  const [color, setColor] = useState(category?.color ?? '#6366F1')
  const [l0, setL0] = useState(
    category ? (initialLevel === 1 ? category.parentId ?? '' : '')
             : (parentId && levelOf(parentId) === 0 ? parentId : ''),
  )
  const [l1, setL1] = useState(
    category ? (initialLevel === 2 ? category.parentId ?? '' : '')
             : (parentId && levelOf(parentId) === 1 ? parentId : ''),
  )
  const [error,  setError]  = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const activeScope = category?.scope ?? scope
  // Kendi alt ağacının altına taşınamaz (döngü olur).
  const excluded = category ? descendantsOf(category.id) : new Set<string>()

  const l0Options = categories
    .filter(c => c.scope === activeScope && !c.isArchived && levelOf(c.id) === 0 && !excluded.has(c.id))
    .sort(compareCategoriesByName)
  const l1Options = categories
    .filter(c => c.scope === activeScope && !c.isArchived && levelOf(c.id) === 1 && !excluded.has(c.id))
    .sort(compareCategoriesByName)

  const trimmed = name.trim()

  async function save() {
    if (!trimmed || saving) return
    const newParentId = l1 || l0 || undefined

    // Derinlik koruması: en fazla 3 seviye (0,1,2). Alt kategorisi olan bir
    // kategoriyi daha derine taşımak torunları 3. seviyeye iterdi.
    const newLevel = newParentId ? levelOf(newParentId) + 1 : 0
    if (category && newLevel + subtreeHeight(category.id) > 2) {
      setError('Bu kategorinin alt kategorileri var; daha derine taşınırsa 3. seviye oluşur. Daha üst bir kategori seçin.')
      return
    }
    if (!category && newLevel > 2) {
      setError('En fazla 3 seviye desteklenir.')
      return
    }

    setError(null)
    setSaving(true)
    try {
      if (category) {
        await update(category.id, {
          name:     trimmed,
          icon:     icon || 'package',
          color:    color || '#6366F1',
          parentId: newParentId,
        })
      } else {
        const maxSort = categories.reduce((m, c) => Math.max(m, c.sortOrder), 0)
        await add({
          id:        crypto.randomUUID(),
          name:      trimmed,
          icon:      icon || 'package',
          color:     color || '#6366F1',
          scope:     activeScope,
          parentId:  newParentId,
          isSystem:  false,
          sortOrder: maxSort + 1,
        })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Kategoriyi Düzenle' : 'Yeni Kategori'}
      size="sm"
      dismissible={false}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="text-xs font-medium text-destructive">{error}</p>}

        <div className="flex items-center gap-3">
          <CategoryIconPicker
            icon={icon}
            color={color}
            onChange={(i, c) => { setIcon(i); setColor(c) }}
          />
          <p className="text-xs text-muted-foreground">
            Simge ve rengi seçin; kategori her yerde (listeler, grafikler, işlem
            satırları) bu renkle görünür.
          </p>
        </div>

        <Input
          autoFocus
          label="Kategori adı"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          placeholder="Örn. Market"
        />

        {l0Options.length > 0 && (
          <SelectField
            label="Üst kategori"
            value={l0}
            onChange={e => { setL0(e.target.value); setL1(''); setError(null) }}
            options={[
              { value: '', label: 'Yok — ana kategori' },
              ...l0Options.map(o => ({ value: o.id, label: o.name })),
            ]}
            className="bg-background text-sm"
          />
        )}

        {l1Options.length > 0 && (
          <SelectField
            label="Ya da bir alt kategorinin altına"
            value={l1}
            onChange={e => { setL1(e.target.value); setL0(''); setError(null) }}
            options={[
              { value: '', label: 'Yok' },
              ...l1Options.map(o => {
                const p = categories.find(x => x.id === o.parentId)
                return { value: o.id, label: `${o.name} (${p?.name ?? ''})` }
              }),
            ]}
            className="bg-background text-sm"
          />
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>İptal</Button>
          <Button size="sm" onClick={save} disabled={!trimmed} loading={saving}>
            {isEdit ? 'Kaydet' : 'Ekle'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
