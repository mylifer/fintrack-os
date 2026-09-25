'use client'

/** Bütçe formlarındaki "artanı devret" seçeneği — kural calcBudgetCarryover'da. */
export function RolloverField({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 rounded accent-primary"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-foreground">Artanı sonraki aya devret</span>
        <span className="text-xs text-muted-foreground">
          Bir ayda harcanmayan tutar ertesi ayın limitine eklenir. Yalnızca bir önceki aydan devreder; aşım devretmez.
        </span>
      </span>
    </label>
  )
}
