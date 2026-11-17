import type { DraftTx, ImportPlan, PlanRow, RowOption } from './classify'

/* ── "Elle gir" seçenekleri ───────────────────────────────────────────────────
   Sınıflandırıcı her satıra yalnız tanıdığı kararları önerir; tanımadığı ya da
   yanlış tanıdığı satırda (ör. "kendi hesabına gönderim" diye tanınıp önerecek
   hesap bulunamayan satır) kullanıcı elinde yalnız "Girme" kalıyordu. Bu katman
   bankada karşılığı olan HER satıra, İşlem Ekle formundaki kayıt türlerini
   ekler:
     • para çıkışı → Gider, Transfer (hesaba / bu alandaki borca / başka alana)
     • para girişi → Gelir, İade (eksi gider), Transfer (bir hesaptan)
   Gider/Gelir yalnız satırda o türden bir seçenek yoksa eklenir (zaten
   düzenlenebilir bir öneri var); elle transfer her zaman eklenir (önerilen
   transferler belli hesaplara gider, bu ise hedefi serbest seçtirir).

   Kayıt kimliği satırın sabit anahtarından türer (tek satırlıkta satırın
   tohumu): bir sonraki yüklemede satır "daha önce içe aktarılmış" diye eşleşir.
   Sistemde karşılığı olan satırlara dokunulmaz — o kayıt zaten var; karşılığı
   olmayan "zaten sistemde" satırları (açılış bakiyesindeki taksit) dahildir. */

export const MANUAL_KEYS = { expense: 'm-expense', income: 'm-income', refund: 'm-refund', transfer: 'm-transfer' } as const

function createType(o: RowOption): DraftTx['type'] | null {
  const c = o.actions.find(a => a.type === 'create')
  return c && c.type === 'create' ? c.draft.type : null
}

export function manualOptionsFor(row: PlanRow): RowOption[] {
  // Sistemde karşılığı olan satıra yeni kayıt önerilmez (o kayıt zaten var);
  // karşılığı olmayan "zaten sistemde" satırları (açılış bakiyesindeki taksit) dahil
  if ((row.status === 'exists' && row.match?.txIds.length) || row.lines.length === 0 || row.amount === null || row.amount === 0) return []
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
  // Giriş satırında Gider sekmesi = iade (İşlem Ekle'deki "+" işaretli gider)
  if (!out && !has.has('expense')) {
    const draft: DraftTx = { ...base, type: 'expense', amount: -Math.abs(row.amount), recipientId: row.recipientId ?? null, categoryId: row.categoryId }
    opts.push({ key: MANUAL_KEYS.refund, label: 'İade (gider) olarak gir', actions: [{ type: 'create', draft }] })
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

/** Satırlar yeniden eskiye: tarih azalan; aynı günde ekstrede sonra gelen
 *  (daha yeni) satır önce, sistemde olup dökümde olmayanlar (satırsız) en sonda.
 *  Sınıflandırıcının iç sırası (önce eşleşenler) ekranda karışık görünüyordu. */
export function sortNewestFirst(plan: ImportPlan): ImportPlan {
  const last = (r: PlanRow) => (r.lines.length ? Math.max(...r.lines) : -1)
  return { ...plan, rows: [...plan.rows].sort((a, b) => b.date.localeCompare(a.date) || last(b) - last(a)) }
}
