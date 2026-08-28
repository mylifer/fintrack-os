'use client'

import { useState } from 'react'
import { usePeopleStore } from '@/store'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/button'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import type { BoardConfig } from './shared'
import type { Person } from '@/types'

/* Kişi ekle / düzenle. Her iki görünümün ortak düzenleme yüzeyi: satır içi
   düzenleme yerine tek modal, çünkü 32px'lik dizin satırı satır-içi bir form
   taşıyamaz. Bağlı işlemlere DOKUNULMAZ — yalnız ad (ve alıcıda favicon
   URL'si) yazılır. */

interface Props {
  config: BoardConfig
  /** Verilmezse ekleme modu. */
  person?: Person
  onClose: () => void
}

export function PersonEditModal({ config, person, onClose }: Props) {
  const addPerson    = usePeopleStore(s => s.add)
  const renamePerson = usePeopleStore(s => s.rename)
  const setUrl       = usePeopleStore(s => s.setUrl)

  const [name,   setName]   = useState(person?.name ?? '')
  const [url,    setUrl_]   = useState(person?.url ?? '')
  const [saving, setSaving] = useState(false)

  const trimmed = name.trim()
  const isEdit  = !!person

  async function save() {
    if (!trimmed || saving) return
    setSaving(true)
    try {
      if (person) {
        if (trimmed !== person.name) await renamePerson(person.id, trimmed)
        if (config.hasUrl && url.trim() !== (person.url ?? '')) await setUrl(person.id, url)
      } else {
        const created = await addPerson(trimmed, config.role)
        // URL girildiyse otomatik logo çözümlemesinin üstüne yazar (kullanıcı
        // beyanı her zaman öncelikli).
        if (config.hasUrl && url.trim()) await setUrl(created.id, url)
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
      title={isEdit ? config.labels.editTitle : config.labels.addTitle}
      size="sm"
      dismissible={false}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <PersonAvatar
            person={{ name: trimmed || 'Yeni', role: config.role, url: url.trim() || undefined }}
            size="md"
          />
          <p className="text-xs text-muted-foreground">
            {config.hasUrl
              ? 'Logo, girdiğiniz adresten çözülür. Boş bırakırsanız bilinen markalar otomatik bulunur, bulunamazsa baş harfler kullanılır.'
              : 'Avatar, adın baş harflerinden oluşturulur; renk isme göre sabit kalır.'}
          </p>
        </div>

        <Input
          autoFocus
          label={config.labels.nameLabel}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          placeholder={config.labels.namePlaceholder}
        />

        {config.hasUrl && (
          <Input
            type="url"
            label="Site adresi (isteğe bağlı)"
            value={url}
            onChange={e => setUrl_(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save() }}
            placeholder="https://migros.com.tr"
            hint="Yalnız logo için kullanılır."
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
