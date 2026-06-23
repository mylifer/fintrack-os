'use client'

import { useState, useEffect } from 'react'
import { usePeopleStore, useTransactionStore } from '@/store'
import { PersonTransactionsOverlay } from './PersonTransactionsOverlay'
import { PersonAvatar } from './PersonAvatar'
import type { Person, PersonRole } from '@/types'

interface Props {
  role: PersonRole
  emptyText: string
}

export function PeopleManager({ role, emptyText }: Props) {
  const allPeople    = usePeopleStore(s => s.people)
  const addPerson    = usePeopleStore(s => s.add)
  const renamePerson = usePeopleStore(s => s.rename)
  const setPersonUrl = usePeopleStore(s => s.setUrl)
  const removePerson = usePeopleStore(s => s.remove)
  const loadPeople   = usePeopleStore(s => s.load)
  const transactions = useTransactionStore(s => s.transactions)

  useEffect(() => { loadPeople() }, [loadPeople])

  const people = allPeople.filter(p => p.role === role)

  const [showAdd, setShowAdd]       = useState(false)
  const [newName, setNewName]       = useState('')
  const [editId, setEditId]         = useState<string | null>(null)
  const [editName, setEditName]     = useState('')
  const [editUrl, setEditUrl]       = useState('')
  const [deleteId, setDeleteId]     = useState<string | null>(null)
  const [overlay, setOverlay]       = useState<Person | null>(null)

  function txCount(personId: string): number {
    return role === 'family_member'
      ? transactions.filter(t => t.familyMemberId === personId).length
      : transactions.filter(t => t.recipientId === personId).length
  }

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    await addPerson(name, role)
    setNewName('')
    setShowAdd(false)
  }

  async function handleRename() {
    const name = editName.trim()
    if (!editId || !name) return
    await renamePerson(editId, name)
    if (role === 'recipient') await setPersonUrl(editId, editUrl)
    setEditId(null)
    setEditName('')
    setEditUrl('')
  }

  async function handleDelete(id: string) {
    await removePerson(id)
    setDeleteId(null)
  }

  return (
    <>
    <PersonTransactionsOverlay person={overlay} onClose={() => setOverlay(null)} />
    <div className="flex-1 overflow-auto">
      <div className="p-6 max-w-2xl mx-auto">

        {/* Add form */}
        <div className="mb-6">
          {showAdd ? (
            <div className="flex gap-2 items-center p-4 bg-card border border-border rounded-xl">
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAdd()
                  if (e.key === 'Escape') { setShowAdd(false); setNewName('') }
                }}
                placeholder="İsim girin..."
                className="flex-1 border border-border px-3 py-2 text-sm bg-card text-foreground focus:border-ink outline-none rounded-lg"
              />
              <button
                onClick={handleAdd}
                disabled={!newName.trim()}
                className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary/85 transition-colors disabled:opacity-40"
              >
                Ekle
              </button>
              <button
                onClick={() => { setShowAdd(false); setNewName('') }}
                className="px-4 py-2 border border-border text-xs font-semibold text-muted-foreground rounded-xl hover:bg-background transition-colors"
              >
                İptal
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAdd(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-border text-sm text-muted-foreground rounded-xl hover:border-muted hover:text-foreground transition-colors"
            >
              <span className="text-base leading-none font-bold">+</span>
              <span className="font-medium">Yeni ekle</span>
            </button>
          )}
        </div>

        {/* Empty state */}
        {people.length === 0 && !showAdd && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4 opacity-20">👤</div>
            <p className="text-sm font-medium text-foreground/50">{emptyText}</p>
            <p className="text-xs text-muted-foreground mt-1">Yukarıdaki butonu kullanarak ekleyebilirsiniz.</p>
          </div>
        )}

        {/* People list */}
        {people.length > 0 && (
          <div className="flex flex-col gap-2">
            {people.map(person => {
              const count      = txCount(person.id)
              const isEditing  = editId === person.id
              const isDeleting = deleteId === person.id

              return (
                <div
                  key={person.id}
                  className="group flex items-center gap-3 px-4 py-3 bg-card border border-border rounded-xl hover:border-muted transition-colors min-h-[52px]"
                >
                  {isEditing ? (
                    <>
                      <PersonAvatar
                        person={{ ...person, name: editName || person.name, url: editUrl || person.url }}
                        size="sm"
                        className="flex-shrink-0"
                      />
                      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                        <input
                          autoFocus
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRename()
                            if (e.key === 'Escape') { setEditId(null); setEditName(''); setEditUrl('') }
                          }}
                          placeholder="İsim..."
                          className="w-full border border-border px-2 py-1.5 text-sm bg-card text-foreground focus:border-accent outline-none rounded-lg"
                        />
                        {role === 'recipient' && (
                          <input
                            type="url"
                            value={editUrl}
                            onChange={e => setEditUrl(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleRename()
                              if (e.key === 'Escape') { setEditId(null); setEditName(''); setEditUrl('') }
                            }}
                            placeholder="https://migros.com.tr  (favicon için)"
                            className="w-full border border-border px-2 py-1.5 text-xs bg-card text-muted-foreground focus:border-accent focus:text-foreground outline-none rounded-lg"
                          />
                        )}
                      </div>
                      <button
                        onClick={handleRename}
                        className="w-7 h-7 flex-shrink-0 flex items-center justify-center text-green-600 hover:bg-accent rounded-lg transition-colors font-bold text-sm"
                      >✓</button>
                      <button
                        onClick={() => { setEditId(null); setEditName(''); setEditUrl('') }}
                        className="w-7 h-7 flex-shrink-0 flex items-center justify-center text-destructive hover:bg-accent rounded-lg transition-colors font-bold text-sm"
                      >✕</button>
                    </>
                  ) : isDeleting ? (
                    <>
                      <PersonAvatar person={person} size="sm" className="flex-shrink-0 opacity-40" />
                      <span className="flex-1 text-sm font-medium text-foreground/40 line-through">{person.name}</span>
                      {count > 0 && (
                        <span className="text-[10px] text-destructive font-semibold flex-shrink-0">
                          {count} işlem etkilenecek
                        </span>
                      )}
                      <span className="text-[11px] text-destructive font-semibold flex-shrink-0">Sil?</span>
                      <button
                        onClick={() => handleDelete(person.id)}
                        className="w-7 h-7 flex items-center justify-center text-green-600 hover:bg-accent rounded-lg transition-colors font-bold text-sm flex-shrink-0"
                      >✓</button>
                      <button
                        onClick={() => setDeleteId(null)}
                        className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:bg-accent rounded-lg transition-colors font-bold text-sm flex-shrink-0"
                      >✕</button>
                    </>
                  ) : (
                    <>
                      <PersonAvatar person={person} size="sm" className="flex-shrink-0" />
                      <button
                        type="button"
                        onClick={() => setOverlay(person)}
                        className="flex-1 min-w-0 text-sm font-medium text-foreground text-left truncate hover:text-primary transition-colors"
                      >
                        {person.name}
                      </button>
                      {count > 0 && (
                        <button
                          type="button"
                          onClick={() => setOverlay(person)}
                          className="text-[10px] font-mono text-muted-foreground bg-background px-2 py-0.5 rounded-full flex-shrink-0 hover:bg-accent transition-colors"
                        >
                          {count} işlem
                        </button>
                      )}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => { setEditId(person.id); setEditName(person.name); setEditUrl(person.url ?? ''); setDeleteId(null) }}
                          className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors text-sm"
                          title="Düzenle"
                        >✎</button>
                        <button
                          onClick={() => { setDeleteId(person.id); setEditId(null); setEditName('') }}
                          className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-accent rounded-lg transition-colors text-sm"
                          title="Sil"
                        >×</button>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
    </>
  )
}
