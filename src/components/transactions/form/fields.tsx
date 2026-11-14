'use client'

import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/Select'
import { PersonSelect } from '@/components/people/PersonSelect'
import { usePeopleStore } from '@/store'
import { cn } from '@/lib/utils'
import type { PersonRole } from '@/types'

// ── Field wrapper ─────────────────────────────────────────────────────────────

export function Field({ label, error, children, optional }: {
  label: string
  error?: string
  children: React.ReactNode
  optional?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className={cn("text-sm font-medium", error && "text-destructive")}>
        {label}
        {optional && <span className="font-normal text-muted-foreground ml-1">(opsiyonel)</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ── Shadcn Select wrapper ─────────────────────────────────────────────────────

export function AppSelect({
  value, onChange, options, placeholder, error, disabled, onOpenChange,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; icon?: React.ReactNode }[]
  placeholder?: string
  error?: boolean
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled} onOpenChange={onOpenChange}>
      <SelectTrigger
        aria-invalid={!!error}
        className={cn(
          "h-9 data-[size=default]:h-9 w-full rounded-md",
          error && "border-destructive aria-invalid:ring-destructive/20",
        )}
      >
        <SelectValue placeholder={placeholder ?? 'Seçin...'} />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => (
          <SelectItem key={o.value} value={o.value}>
            {o.icon ? (
              <span className="flex items-center gap-2">
                <span>{o.icon}</span>
                <span>{o.label}</span>
              </span>
            ) : o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── Person field ──────────────────────────────────────────────────────────────

export function PersonField({
  role, value, onChange,
}: {
  role: PersonRole
  value: string | null | undefined
  onChange: (id: string | undefined) => void
}) {
  const allPeople = usePeopleStore(s => s.people)
  const addPerson = usePeopleStore(s => s.add)
  // Archived people stay resolvable on old transactions but are not selectable —
  // unless the transaction being edited already points at one (keep it visible).
  const people    = allPeople.filter(p => p.role === role && (!p.isArchived || p.id === value))

  const label = role === 'family_member' ? 'Aile Üyesi' : 'Alıcı'

  return (
    <Field label={label} optional>
      <PersonSelect
        people={people}
        value={value}
        onChange={onChange}
        onCreate={async name => {
          try {
            const person = await addPerson(name, role)
            return person.id
          } catch (err) {
            console.error('[person:add]', err)
            return null
          }
        }}
      />
    </Field>
  )
}
