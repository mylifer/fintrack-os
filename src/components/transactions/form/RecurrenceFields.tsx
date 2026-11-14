'use client'

import { Input } from '@/components/ui/Input'
import type { RecurringFrequency } from '@/types'
import { AppSelect, Field } from './fields'
import { FREQ_OPTIONS, type RecForm } from './form-model'
import type { TransactionFormState } from './useTransactionFormState'

// Name (recurring only)
export function RecurringNameField({
  rec, setRec, errors, setErrors,
}: {
  rec: RecForm
  errors: Record<string, string>
} & Pick<TransactionFormState, 'setRec' | 'setErrors'>) {
  return (
    <Field label="Ad" error={errors.name}>
      <Input
        autoFocus
        value={rec.name}
        onChange={e => {
          setRec(r => ({ ...r, name: e.target.value }))
          if (errors.name) setErrors(prev => ({ ...prev, name: '' }))
        }}
        placeholder="Kira, Netflix, Maaş..."
        error={errors.name}
      />
    </Field>
  )
}

// Tekrar sıklığı + başlangıç/bitiş tarihleri (tekil işlemdeki "Tarih"in yerine).
export function RecurrenceScheduleFields({
  rec, setRec, errors, onSelectOpen,
}: {
  rec: RecForm
  errors: Record<string, string>
  setRec: TransactionFormState['setRec']
  onSelectOpen: (open: boolean) => void
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tekrar Sıklığı">
          <AppSelect
            value={rec.frequency}
            onChange={v => setRec(r => ({ ...r, frequency: v as RecurringFrequency }))}
            options={FREQ_OPTIONS}
            onOpenChange={onSelectOpen}
          />
        </Field>
        {(rec.frequency === 'monthly' || rec.frequency === 'yearly') && (
          <p className="self-end pb-2 text-xs text-muted-foreground">
            {rec.frequency === 'monthly' ? 'Her ay' : 'Her yıl'} başlangıç tarihinin gününde; kısa aylarda ay sonunda.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Başlangıç Tarihi" error={errors.startDate}>
          <Input
            type="date"
            value={rec.startDate}
            onChange={e => setRec(r => ({ ...r, startDate: e.target.value }))}
            error={errors.startDate}
          />
        </Field>
        <Field label="Bitiş Tarihi" optional>
          <Input
            type="date"
            value={rec.endDate}
            onChange={e => setRec(r => ({ ...r, endDate: e.target.value }))}
          />
        </Field>
      </div>
    </>
  )
}
