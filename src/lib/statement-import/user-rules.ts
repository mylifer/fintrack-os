import type { Category, Person, TransactionRule } from '@/types'
import { matchRule, mergeTags, type RuleOutcome } from '@/lib/utils/transaction-rules'
import type { DraftTx, PlanRow, RowOption } from './classify'

/* ── Kullanıcı kurallarının ekstre planına uygulanması ────────────────────────
   SAF. Kart ekstresi (classify.ts) ve vadesiz döküm (classify-account.ts)
   planlarını kurduktan SONRA çağrılır: kural, öğrenilmiş öneriden (alıcı
   geçmişi, bankanın kategori etiketi, anahtar kelime) ÖNCE gelir — yani onu
   ezer. Kullanıcının onay ekranında yaptığı düzenlemeler (RowEdit) plandan
   ayrı tutulduğu için burada ezilmez; plana yalnız ÖNERİ yazılır.

   Kapsam: girilecek (new/review) satırların "oluştur" taslakları. Dokunulmayanlar:
   sistemde zaten olan / bilgi satırları, ters kontrol (orphan) satırları,
   transferler, iadenin alıma bağlandığı taslaklar (kategorisi alımdan gelir) ve
   var olan taksit grubunun eksik taksiti (grubun kategorisini taşır).

   Eşleştirilen metin önce bankanın ham satırı (`raw`), tutmazsa taslağın
   açıklaması — kullanıcı kuralı ikisinden biriyle yazmış olabilir. */

export interface UserRuleContext {
  rules: readonly TransactionRule[]
  accountId: string
  categories: readonly Category[]
  people: readonly Person[]
}

function eligibleDraft(d: DraftTx): boolean {
  return d.type !== 'transfer' && !d.refundOfId && !d.installmentOf
}

function outcomeFor(row: Pick<PlanRow, 'raw'>, d: DraftTx, ctx: UserRuleContext): RuleOutcome | undefined {
  const base = { type: d.type, accountId: ctx.accountId, amount: d.amount }
  return matchRule(ctx.rules, { ...base, description: row.raw }, ctx.categories, ctx.people)
    ?? (d.description && d.description !== row.raw
      ? matchRule(ctx.rules, { ...base, description: d.description }, ctx.categories, ctx.people)
      : undefined)
}

/** "Yeni alıcıyla gir" seçeneği (kart ekstresi) kullanıcıya açıkça sunulan
 *  ayrı bir tercihtir: alıcısı kuralla değiştirilmez. */
const EXPLICIT_NEW_RECIPIENT = 'create-new'

function applyToDraft(d: DraftTx, out: RuleOutcome, optionKey: string): DraftTx {
  const next: DraftTx = { ...d }
  if (out.categoryId) next.categoryId = out.categoryId
  if (out.tags.length) next.tags = mergeTags(d.tags, out.tags)
  if (out.recipientId && optionKey !== EXPLICIT_NEW_RECIPIENT) {
    next.recipientId = out.recipientId
    next.newRecipient = undefined
    next.needsRecipient = false
  }
  return next
}

/** Kurallar uygulanmış satırlar (kural yoksa aynı dizi döner). */
export function applyUserRulesToRows<R extends Omit<PlanRow, 'stableKey'>>(rows: R[], ctx: UserRuleContext): R[] {
  if (!ctx.rules.some(r => r.isActive && !r.deleted_at)) return rows
  const peopleById = new Map(ctx.people.map(p => [p.id, p]))
  return rows.map(row => {
    if ((row.status !== 'new' && row.status !== 'review') || row.lines.length === 0 || row.kind === 'orphan') return row
    let first: RuleOutcome | undefined
    let changed = false
    const options: RowOption[] = row.options.map(o => {
      let touched = false
      const actions = o.actions.map(a => {
        if (a.type !== 'create' || !eligibleDraft(a.draft)) return a
        const out = outcomeFor(row, a.draft, ctx)
        if (!out || (!out.categoryId && !out.tags.length && !out.recipientId)) return a
        first ??= out
        touched = true
        return { ...a, draft: applyToDraft(a.draft, out, o.key) }
      })
      if (!touched) return o
      changed = true
      return { ...o, actions }
    })
    if (!changed || !first) return row
    const name = first.recipientId ? peopleById.get(first.recipientId)?.name : undefined
    return {
      ...row,
      options,
      ...(first.categoryId ? { categoryId: first.categoryId, categoryGuess: false } : {}),
      ...(first.recipientId ? { recipientId: first.recipientId, recipientName: name ?? row.recipientName, newRecipient: false } : {}),
      reason: `${row.reason}${row.reason ? ' ' : ''}“${first.rule.pattern}” kuralın uygulandı.`.trim(),
    }
  })
}
