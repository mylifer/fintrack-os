import type { DraftTx, ImportPlan, PlanRow, RowOption } from './classify'

/* ── "Elle gir" seçenekleri ───────────────────────────────────────────────────
   Sınıflandırıcı her satıra yalnız tanıdığı kararları önerir; tanımadığı ya da
   yanlış tanıdığı satırda (ör. "kendi hesabına gönderim" diye tanınıp önerecek
   hesap bulunamayan satır) kullanıcı elinde yalnız "Girme" kalıyordu. Bu katman
   bankada karşılığı olan HER satıra, İşlem Ekle formundaki kayıt türlerini
   ekler:
     • para çıkışı → Gider, Transfer (hesaba / bu alandaki borca / başka alana)
     • para girişi → Gelir, Transfer (bir hesaptan)
   Gider/Gelir yalnız satırda o türden bir seçenek yoksa eklenir (zaten
   düzenlenebilir bir öneri var); elle transfer her zaman eklenir (önerilen
   transferler belli hesaplara gider, bu ise hedefi serbest seçtirir).

   Kayıt kimliği satırın sabit anahtarından türer (tek satırlıkta satırın
   tohumu): bir sonraki yüklemede satır "daha önce içe aktarılmış" diye eşleşir.
   Sistemde karşılığı olan (exists) satırlara dokunulmaz — o kayıt zaten var. */

export const MANUAL_KEYS = { expense: 'm-expense', income: 'm-income', transfer: 'm-transfer' } as const

function createType(o: RowOption): DraftTx['type'] | null {
  const c = o.actions.find(a => a.type === 'create')
  return c && c.type === 'create' ? c.draft.type : null
}

export function manualOptionsFor(row: PlanRow): RowOption[] {
  if (row.status === 'exists' || row.lines.length === 0 || row.amount === null || row.amount === 0) return []
  const out = row.amount > 0
  const has = new Set(row.options.map(createType))
  const base = {
    amount: Math.abs(row.amount), date: row.date, description: row.title,
    idSeed: row.stableKey, editable: true, manual: true as const,
  }
  const opts: RowOption[] = []
  const flowType = out ? 'expense' : 'income'
  if (!has.has(flowType)) {
    const draft: DraftTx = {
      ...base, type: flowType,
      recipientId: row.recipientId ?? null, categoryId: row.categoryId,
    }
    opts.push({ key: MANUAL_KEYS[flowType], label: out ? 'Gider olarak gir' : 'Gelir olarak gir', actions: [{ type: 'create', draft }] })
  }
  const transfer: DraftTx = { ...base, type: 'transfer', description: 'Transfer', ...(out ? { transferMode: 'account' as const } : {}) }
  opts.push({ key: MANUAL_KEYS.transfer, label: out ? 'Transfer: hedefi seç (hesap, borç, diğer alan)' : 'Transfer: kaynak hesabı seç', actions: [{ type: 'create', draft: transfer }] })
  return opts
}

export function withManualOptions(plan: ImportPlan): ImportPlan {
  return {
    ...plan,
    rows: plan.rows.map(r => {
      const extra = manualOptionsFor(r)
      return extra.length ? { ...r, options: [...r.options, ...extra] } : r
    }),
  }
}
