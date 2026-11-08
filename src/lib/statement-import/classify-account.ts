import { foldText, recipientCategory } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import type { Account, Category, Transaction } from '@/types'
import type { StatementLine } from './statement'
import { merchantKey, nameInText } from './merchant'
import { txIdFromSeed, type Action, type DraftTx, type ImportPlan, type PlanInput, type PlanRow, type RowKind, type RowOption } from './classify'

/* ── Vadesiz hesap dökümünü sistemle karşılaştırma ───────────────────────────
   Kart ekstresindeki (classify.ts) ilkelerle, aynı PlanRow çıktısıyla:
   onay ekranı, yazım (commit.ts) ve geri alma ortaktır.

   Eşleştirme (mükerrer koruması), sırayla:
     1. Kimlik: içe aktarılan satırın kimliği hesap + tarih + saat + tutar +
        bankanın metninden türetilir → örtüşen dökümler aynı kaydı iki kez girmez.
     2. Birebir: aynı hesap, aynı tutar, ±3 gün (faiz/stopaj ±1 gün).
     3. Bir kayıt ← birden çok satır: aynı yönde satırların toplamı (ör. iki
        havaleyle yapılmış tek kart ödemesi).
     4. Bir satır ← birden çok kayıt: aynı günlerdeki kayıtların net toplamı
        (ör. Midas'tan gelen para = fon satışı + satış kârı − stopaj).
     5. Benzer kayıt: aynı tutar, 15 güne kadar farkla → karar sorulur.
     6. Ters kontrol: dönem içinde sistemde olup dökümde olmayan kayıtlar.

   Öğrenme: eşleşen kayda karşı tarafın okunur adı `merchant` alanına yazılır
   ("Mehmet Ali Kaya", "Ayşe Yılmaz · Yapı Kredi", "Kart ödemesi *1234").
   Sonraki dökümde aynı karşı taraf geçmişteki kayıtlarla aynı biçimde
   (gider/gelir/transfer, alıcı, kategori, açıklama) önerilir.

   Kayda girmeyenler: Oksijen'in gecelik vadeli aktarımları (hesap içi), fon
   alımları ve sistemde hesabı olmayan kendi hesaplarından gelen para (takip
   dışı). Sistemde karşılığı olmayan yatırım kuruluşu (Midas) hareketi
   girilmez; Yatırımlar'dan girilmesi istenir — döküm pay miktarını bilmez. */

const DAY = 86_400_000
const dayNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY
const dayDiff = (a: string, b: string) => Math.abs(dayNum(a) - dayNum(b))
const minor = toMinor
const fmtTr = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const fmtDay = (iso: string) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]}`
const alnum = (s: string) => foldText(s).replace(/[^a-z0-9]/g, '')

/** EFT/havale banka kodu → banka adı ve hesap adında aranacak kelimeler */
const BANKS: Record<string, { name: string; words: string[] }> = {
  '0010': { name: 'Ziraat', words: ['ziraat'] },
  '0012': { name: 'Halkbank', words: ['halk'] },
  '0015': { name: 'VakıfBank', words: ['vakif'] },
  '0032': { name: 'TEB', words: ['teb'] },
  '0046': { name: 'Akbank', words: ['akbank'] },
  '0059': { name: 'Şekerbank', words: ['seker'] },
  '0062': { name: 'Garanti', words: ['garanti'] },
  '0064': { name: 'İş Bankası', words: ['is bankasi', 'isbank', 'maximum'] },
  '0067': { name: 'Yapı Kredi', words: ['yapi kredi', 'yapikredi', 'world'] },
  '0099': { name: 'ING', words: ['ing'] },
  '0103': { name: 'Fibabanka', words: ['fibabanka', 'getir'] },
  '0111': { name: 'QNB', words: ['qnb', 'finansbank'] },
  '0123': { name: 'HSBC', words: ['hsbc'] },
  '0125': { name: 'Burgan', words: ['burgan'] },
  '0134': { name: 'Denizbank', words: ['deniz'] },
  '0146': { name: 'Odeabank', words: ['odea'] },
  '0157': { name: 'Enpara', words: ['enpara'] },
  '0203': { name: 'Albaraka', words: ['albaraka'] },
  '0205': { name: 'Kuveyt Türk', words: ['kuveyt'] },
  '0206': { name: 'Türkiye Finans', words: ['turkiye finans'] },
}
const bankMatches = (name: string, code: string) => {
  const f = foldText(name)
  // Kelime başında aranır ("odea" → "Odeabank"); kısa adlar tam kelime olmalı ("ing")
  return (BANKS[code]?.words ?? []).some(w => new RegExp(`(^|[^a-z0-9])${w}${w.length <= 3 ? '($|[^a-z0-9])' : ''}`).test(f))
}

/** "AYŞE YILMAZ" → "Ayşe Yılmaz" */
function titleCase(s: string): string {
  return s.trim().split(/\s+/).map(w => {
    const lower = w.replace(/İ/g, 'i').replace(/I/g, 'ı').toLocaleLowerCase('tr-TR')
    return lower.charAt(0).toLocaleUpperCase('tr-TR') + lower.slice(1)
  }).join(' ')
}

// ── Satırın türü ve karşı tarafı ────────────────────────────────────────────

type LineType =
  | 'sweep'        // Oksijen gecelik vadeli aktarımı (hesap içi)
  | 'interest' | 'tax'
  | 'fund'         // fon alım/satımı (bankanın kendi fon hesabı)
  | 'card'         // aynı bankanın kredi kartına ödeme
  | 'own'          // hesap sahibinin başka bankadaki hesabı
  | 'virman'       // hesap sahibinin aynı bankadaki başka hesabı
  | 'broker'       // aracı kurum (Midas …)
  | 'person'       // kişi / kurum (havale, EFT)
  | 'cash'         // ATM, şubeden nakit
  | 'other'

export interface LineInfo {
  type: LineType
  /** Öğrenme anahtarı olarak işleme yazılan okunur ad */
  label: string
  bankCode?: string
  card4?: string
  /** Karşı tarafın adı (havale/EFT) */
  name?: string
}

const TRANSFER_RE = /^banka:\s*(\d{4})\s*sn:\s*\S*\s+(.+?)\s+açk:\s*(.*)$/i
const SN_RE = /^sn:\s*\S+\s+(.+?)\s+açk:\s*(.*)$/i
const HAVALE_RE = /^(.+?)\s+(havale bedeli|borç|borc)$/i
const BROKER_RE = /menkul degerler|yatirim menkul|portfoy yonetim/

export function analyzeLine(description: string, owner: string): LineInfo {
  const f = foldText(description)
  const ownerKey = alnum(owner)
  if (/vadesizden vadeliye aktarim|vadesize donen anapara/.test(f)) return { type: 'sweep', label: 'Oksijen vadeli aktarımı' }
  if (f.includes('stopaj')) return { type: 'tax', label: 'Odeabank faiz stopajı' }
  if (/faiz/.test(f)) return { type: 'interest', label: 'Odeabank faiz' }
  const fund = description.match(/^fon (alış|alis|satış|satis)\s*:.*?-([A-Z0-9]{3})-/i)
  if (fund) return { type: 'fund', label: `Fon ${/al/i.test(fund[1]) ? 'alımı' : 'satışı'} ${fund[2].toUpperCase()}` }
  if (f.includes('kk hesaptan odeme')) {
    const card4 = description.match(/\*{2,}(\d{4})/)?.[1]
    return { type: 'card', label: `Kart ödemesi *${card4 ?? '????'}`, card4 }
  }
  if (f.includes('atm para cekme')) return { type: 'cash', label: 'ATM para çekme' }
  if (f.includes('hesap sahibi tarafindan cekilen')) return { type: 'cash', label: 'Şubeden nakit çekim' }
  if (f.includes('nakit yatirilan')) return { type: 'cash', label: 'Nakit yatırma' }
  const vir = description.match(/(\d+-\d+)\s*hesaptan virman/i)
  if (vir) return { type: 'virman', label: `Virman ${vir[1]}` }
  if (f.startsWith('mkk komisyon')) return { type: 'other', label: 'MKK komisyonu' }

  const m = description.match(TRANSFER_RE) ?? description.match(SN_RE)
  const bankCode = m && m.length === 4 ? m[1] : undefined
  const rawName = m ? (m.length === 4 ? m[2] : m[1]) : description.match(HAVALE_RE)?.[1]
  if (rawName) {
    const name = rawName.replace(/\s+/g, ' ').trim()
    if (BROKER_RE.test(foldText(name))) {
      // "MİDAS MENKUL DEĞERLER ANONİM ŞTİ." → "Midas Menkul Değerler"
      const words = name.split(' ')
      const cut = words.findIndex(w => /^(anonim|a\.?s\.?|sti\.?|sirketi)$/.test(foldText(w)))
      return { type: 'broker', label: titleCase((cut > 0 ? words.slice(0, cut) : words).join(' ')), name, bankCode }
    }
    if (ownerKey.length >= 4 && alnum(name) === ownerKey) {
      const bank = bankCode ? BANKS[bankCode]?.name ?? `banka ${bankCode}` : 'başka banka'
      return { type: 'own', label: `${titleCase(owner)} · ${bank}`, name, bankCode }
    }
    return { type: 'person', label: titleCase(name), name, bankCode }
  }
  const label = description.replace(/\d[\d.,:/*-]*/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ')
  return { type: 'other', label: label || description.slice(0, 40) }
}

// ── Sistemdeki kayıt ────────────────────────────────────────────────────────

/** Kaydın bu hesaba etkisi (kuruş): + giriş, − çıkış */
function effectOn(t: Transaction, accountId: string): number {
  const a = minor(t.amount)
  if (t.type === 'transfer') return t.toAccountId === accountId ? a : t.accountId === accountId ? -a : 0
  if (t.accountId !== accountId) return 0
  return t.type === 'income' ? a : -a
}

interface Shape {
  type: 'expense' | 'income' | 'transfer'
  recipientId: string | null
  categoryId: string | null
  otherAccountId: string | null
  description: string
  date: string
}

const shapeOf = (t: Transaction, accountId: string): Shape => ({
  type: t.type,
  recipientId: t.recipientId ?? null,
  categoryId: t.categoryId ?? null,
  otherAccountId: t.type === 'transfer' ? (t.accountId === accountId ? t.toAccountId ?? null : t.accountId) : null,
  description: t.description,
  date: t.date,
})
const shapeKey = (s: Shape) => [s.type, s.recipientId, s.categoryId, s.otherAccountId].join('|')

/** En çok 5 elemanlı alt küme: toplamı hedefe `tol` kuruş içinde eşit olanlardan en küçüğü. */
function subsetSum<T>(items: readonly T[], value: (t: T) => number, target: number, tol: number, maxSize: number): T[] | null {
  const n = Math.min(items.length, 14)
  for (let size = 2; size <= Math.min(maxSize, n); size++) {
    const idx: number[] = []
    const rec = (start: number, sum: number): T[] | null => {
      if (idx.length === size) return Math.abs(sum - target) <= tol ? idx.map(i => items[i]) : null
      for (let i = start; i < n; i++) {
        idx.push(i)
        const hit = rec(i + 1, sum + value(items[i]))
        idx.pop()
        if (hit) return hit
      }
      return null
    }
    const hit = rec(0, 0)
    if (hit) return hit
  }
  return null
}

// ── Plan ────────────────────────────────────────────────────────────────────

export function buildAccountPlan(input: PlanInput): ImportPlan {
  const st = input.statement
  const A = input.account.id
  const info = st.account!
  const lines = st.lines
  const blockers: string[] = []
  if (!st.check.ok) blockers.push(...st.check.issues)

  const live = input.transactions.filter(t => !t.deleted_at)
  const byId = new Map(live.map(t => [t.id, t]))
  const inAccount = live.filter(t => t.accountId === A || t.toAccountId === A)
  const peopleById = new Map(input.people.map(p => [p.id, p]))
  const accountById = new Map(input.accounts.map(a => [a.id, a]))
  const firstDate = info.periodStart < (lines[0]?.date ?? info.periodStart) ? info.periodStart : lines[0].date!
  const lastDate = info.periodEnd > (lines[lines.length - 1]?.date ?? info.periodEnd) ? info.periodEnd : lines[lines.length - 1].date!

  const infoOf = new Map<number, LineInfo>(lines.map(l => [l.index, analyzeLine(l.description, info.owner)]))
  const signed = (l: StatementLine) => -minor(l.amount!)   // + giriş
  // Satır kimliği; aynı imza tekrarlanırsa (aynı dakikada iki eş çekim) sıra numarası
  // eklenir. İlk tekrar eski tohumu korur, önceki yüklemeler eşleşmeye devam eder.
  const seedByIdx = new Map<number, string>()
  {
    const seen = new Map<string, number>()
    for (const l of lines) {
      const base = `acct:${A}:${l.date}:${l.time ?? ''}:${minor(l.amount!)}:${merchantKey(l.description)}`
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      seedByIdx.set(l.index, n === 0 ? base : `${base}:${n}`)
    }
  }
  const seedOf = (l: StatementLine) => seedByIdx.get(l.index)!
  const tolFor = (l: StatementLine) => (infoOf.get(l.index)!.type === 'broker' ? Math.max(5, Math.round(Math.abs(signed(l)) * 0.001)) : 2)

  const matchOf = new Map<number, { txIds: string[]; how: string }>()
  const usedTx = new Set<string>()
  const take = (lineIdx: number[], txIds: string[], how: string) => {
    const m = { txIds, how }
    for (const i of lineIdx) matchOf.set(i, m)
    txIds.forEach(id => usedTx.add(id))
  }
  const matchable = lines.filter(l => infoOf.get(l.index)!.type !== 'sweep')

  // 1) Kimlik
  for (const l of matchable) {
    const id = txIdFromSeed(seedOf(l))
    if (byId.has(id) && !usedTx.has(id)) take([l.index], [id], 'imported')
  }

  // 2) Birebir: önce en yakın tarihliler
  const window = inAccount.filter(t => dayNum(t.date) >= dayNum(firstDate) - 5 && dayNum(t.date) <= dayNum(lastDate) + 5)
  const pairs: { l: StatementLine; t: Transaction; d: number }[] = []
  for (const l of matchable) {
    if (matchOf.has(l.index)) continue
    const it = infoOf.get(l.index)!
    const maxD = it.type === 'interest' || it.type === 'tax' ? 1 : 3
    for (const t of window) {
      const d = dayDiff(t.date, l.date!)
      if (d > maxD) continue
      if (Math.abs(effectOn(t, A) - signed(l)) <= (it.type === 'broker' ? tolFor(l) : 0)) pairs.push({ l, t, d })
    }
  }
  pairs.sort((a, b) => a.d - b.d || a.l.index - b.l.index)
  for (const p of pairs) {
    if (matchOf.has(p.l.index) || usedTx.has(p.t.id)) continue
    take([p.l.index], [p.t.id], 'one')
  }

  // 3) Bir kayıt ← birden çok satır (aynı yön, ±3 gün)
  for (const t of window) {
    if (usedTx.has(t.id)) continue
    const e = effectOn(t, A)
    const cands = matchable.filter(l => !matchOf.has(l.index) && Math.sign(signed(l)) === Math.sign(e) && dayDiff(l.date!, t.date) <= 3)
      .sort((a, b) => dayDiff(a.date!, t.date) - dayDiff(b.date!, t.date))
    const hit = subsetSum(cands, signed, e, 0, 4)
    if (hit) take(hit.map(l => l.index), [t.id], 'many-lines')
  }

  // 4) Bir satır ← birden çok kayıt (net toplam, ±2 gün)
  for (const l of matchable) {
    if (matchOf.has(l.index)) continue
    const cands = window.filter(t => !usedTx.has(t.id) && dayDiff(t.date, l.date!) <= 2)
      .sort((a, b) => dayDiff(a.date, l.date!) - dayDiff(b.date, l.date!))
    // Önce kuruşu kuruşuna; aracı kurumda bulunamazsa küçük fiyat farkına izin verilir
    const hit = subsetSum(cands, t => effectOn(t, A), signed(l), 2, 5) ?? subsetSum(cands, t => effectOn(t, A), signed(l), tolFor(l), 5)
    if (hit) take([l.index], hit.map(t => t.id), 'many-tx')
  }

  // 4b) Aracı kurum: aynı günün birden çok satırı ← birden çok kayıt (bir satış iki havaleyle gelebilir)
  const brokerDays = new Map<string, StatementLine[]>()
  for (const l of matchable) {
    if (matchOf.has(l.index) || infoOf.get(l.index)!.type !== 'broker') continue
    const list = brokerDays.get(l.date!)
    if (list) list.push(l); else brokerDays.set(l.date!, [l])
  }
  for (const [day, group] of brokerDays) {
    if (group.length < 2) continue
    const target = group.reduce((s, l) => s + signed(l), 0)
    const cands = window.filter(t => !usedTx.has(t.id) && dayDiff(t.date, day) <= 2).sort((a, b) => dayDiff(a.date, day) - dayDiff(b.date, day))
    const hit = subsetSum(cands, t => effectOn(t, A), target, 2, 6) ?? subsetSum(cands, t => effectOn(t, A), target, Math.max(5, Math.round(Math.abs(target) * 0.001)), 6)
    if (hit) take(group.map(l => l.index), hit.map(t => t.id), 'many-many')
  }

  // ── Öğrenme: karşı taraf → geçmişteki kayıt biçimleri ──
  const shapesByKey = new Map<string, Shape[]>()
  const pushShape = (label: string, incoming: boolean, s: Shape) => {
    const k = `${merchantKey(label)}|${incoming ? 'in' : 'out'}`
    const list = shapesByKey.get(k)
    if (list) list.push(s); else shapesByKey.set(k, [s])
  }
  const seenTx = new Set<string>()
  for (const [i, m] of matchOf) {
    if (m.txIds.length !== 1) continue
    const t = byId.get(m.txIds[0])
    if (!t || seenTx.has(t.id)) continue
    seenTx.add(t.id)
    pushShape(infoOf.get(i)!.label, effectOn(t, A) > 0, shapeOf(t, A))
  }
  for (const t of inAccount) {
    if (!t.merchant || seenTx.has(t.id)) continue
    pushShape(t.merchant, effectOn(t, A) > 0, shapeOf(t, A))
  }
  const shapesFor = (l: StatementLine) => shapesByKey.get(`${merchantKey(infoOf.get(l.index)!.label)}|${signed(l) > 0 ? 'in' : 'out'}`) ?? []

  const recipients = input.people
    .filter(p => p.role === 'recipient' && !p.isArchived && !p.deleted_at)
    .map(p => ({ p, key: alnum(p.name) }))
    .filter(r => r.key.length >= 4)
    .sort((a, b) => b.key.length - a.key.length)
  const recipientFor = (name: string) => recipients.find(r => nameInText(r.p.name, name) || nameInText(name, r.p.name))?.p
  const catByName = (name: string, scope: Category['scope']) =>
    input.categories.find(c => !c.isArchived && c.scope === scope && foldText(c.name) === foldText(name))?.id
  const personByName = (name: string) => input.people.find(p => p.role === 'recipient' && !p.deleted_at && foldText(p.name) === foldText(name))?.id
  const otherAccounts = input.accounts.filter(a => a.id !== A && !a.isArchived)

  // ── Satır taslakları ──
  const draft = (l: StatementLine, s: Partial<Shape> & { type: Shape['type'] }, label: string, extra: Partial<DraftTx> = {}): DraftTx => {
    const incoming = signed(l) > 0
    const base: DraftTx = {
      type: s.type,
      amount: toMajor(Math.abs(signed(l))),
      date: l.date!,
      description: s.description ?? label,
      merchant: label,
      recipientId: s.recipientId ?? null,
      categoryId: s.categoryId ?? undefined,
      idSeed: seedOf(l),
      editable: s.type !== 'transfer',
      ...extra,
    }
    if (s.type === 'transfer') {
      if (incoming) base.fromAccountId = s.otherAccountId ?? undefined
      else base.toAccountId = s.otherAccountId ?? undefined
    }
    return base
  }
  const shapeLabel = (s: Shape) => {
    if (s.type === 'transfer') {
      const other = s.otherAccountId ? accountById.get(s.otherAccountId)?.name ?? 'hesap' : 'hesap'
      return `Transfer: ${other}`
    }
    const who = s.recipientId ? peopleById.get(s.recipientId)?.name : undefined
    return `${s.type === 'income' ? 'Gelir' : 'Gider'}: ${s.description}${who && who !== s.description ? ` (${who})` : ''}`
  }
  const createOpt = (key: string, label: string, d: DraftTx): RowOption => ({ key, label, actions: [{ type: 'create', draft: d }] })
  const skip = (label = 'Girme'): RowOption => ({ key: 'skip', label, actions: [] })

  const sideEffectsFor = (txIds: string[], label?: string): Action[] => {
    const out: Action[] = []
    for (const id of txIds) {
      const t = byId.get(id)
      if (!t) continue
      const patch: Partial<Transaction> = {}
      if (t.approvalStatus === 'pending' && t.date <= input.todayStr) patch.approvalStatus = 'approved'
      // Karşı tarafın adı öğrenilir (tek kayda karşılık gelen satırda)
      if (label && txIds.length === 1 && !t.merchant) patch.merchant = label
      if (Object.keys(patch).length) out.push({ type: 'patch', txId: id, patch })
    }
    return out
  }
  const describeTx = (t: Transaction) => {
    const who = t.recipientId ? peopleById.get(t.recipientId)?.name : undefined
    const other = t.type === 'transfer' ? accountById.get(t.accountId === A ? t.toAccountId ?? '' : t.accountId)?.name : undefined
    return `${fmtDay(t.date)} · ${t.description}${who ? ` · ${who}` : ''}${other ? ` · ${other}` : ''} · ${fmtTr(t.amount)} ₺${t.approvalStatus === 'pending' ? ' · onay bekliyor' : ''}`
  }

  type Row = Omit<PlanRow, 'stableKey'>
  const rows: Row[] = []
  const rowBase = (ls: StatementLine[], kind: RowKind, title: string) => ({
    key: `l${ls.map(l => l.index).join('-')}`,
    lines: ls.map(l => l.index),
    kind,
    date: ls[0].date!,
    amount: toMajor(ls.reduce((s, l) => s + minor(l.amount!), 0)),
    bonus: null,
    title,
    raw: ls.map(l => l.description).join(' + '),
    foreign: null,
  })
  const kindOf = (s: Shape['type'], incoming: boolean): RowKind => (s === 'transfer' ? (incoming ? 'transfer-in' : 'transfer-out') : s === 'income' ? 'income' : 'purchase')
  const decorate = (r: Row, d?: DraftTx): Row => {
    if (!d || d.type === 'transfer') {
      const other = d?.fromAccountId ?? d?.toAccountId
      return { ...r, note: other ? `${d?.fromAccountId ? '←' : '→'} ${accountById.get(other)?.name ?? ''}` : r.note }
    }
    return { ...r, recipientId: d.recipientId ?? undefined, recipientName: d.recipientId ? peopleById.get(d.recipientId)?.name : d.newRecipient, newRecipient: !!d.newRecipient, categoryId: d.categoryId }
  }

  // Satırlar: önce eşleşenler (grup halinde), sonra kalanlar
  const done = new Set<number>()
  for (const l of lines) {
    if (done.has(l.index)) continue
    const it = infoOf.get(l.index)!
    const m = matchOf.get(l.index)
    if (m) {
      const group = lines.filter(x => matchOf.get(x.index) === m)
      group.forEach(x => done.add(x.index))
      const txs = m.txIds.map(id => byId.get(id)!).filter(Boolean)
      const sum = txs.reduce((s, t) => s + effectOn(t, A), 0)
      const diff = group.reduce((s, x) => s + signed(x), 0) - sum
      rows.push({
        ...rowBase(group, it.type === 'broker' ? 'investment' : txs.length === 1 && txs[0].type !== 'expense' ? kindOf(txs[0].type, effectOn(txs[0], A) > 0) : 'purchase', txs.length === 1 ? txs[0].description : it.label),
        status: 'exists',
        recipientId: txs.length === 1 ? txs[0].recipientId ?? undefined : undefined,
        categoryId: txs.length === 1 ? txs[0].categoryId ?? undefined : undefined,
        match: { txIds: m.txIds, text: txs.map(describeTx).join('\n') },
        note: m.how === 'many-lines' ? `${group.length} satır tek kayıt` : m.how === 'many-tx' || m.how === 'many-many' ? `${txs.length} kayıt toplamı` : undefined,
        reason: m.how === 'imported' ? 'Bu satır daha önce içe aktarılmış.'
          : m.how === 'many-lines' ? `Bu ${group.length} satırın toplamı sistemdeki tek kayda eşit.`
          : m.how === 'many-tx' || m.how === 'many-many' ? `Sistemdeki ${txs.length} kaydın bu hesaba net etkisi ${group.length > 1 ? `bu ${group.length} satırın toplamına` : 'bu satıra'} eşit${diff ? ` (${fmtTr(Math.abs(toMajor(diff)))} ₺ farkla)` : ''}.`
          : `Sistemde aynı tutarda kayıt var${dayDiff(txs[0].date, l.date!) ? ` (${dayDiff(txs[0].date, l.date!)} gün farkla)` : ''}.`,
        options: [], recommended: null, defaultOption: null,
        sideEffects: sideEffectsFor(m.txIds, it.label),
      })
      continue
    }
    done.add(l.index)
    const incoming = signed(l) > 0

    if (it.type === 'sweep') {
      rows.push({ ...rowBase([l], 'internal', 'Oksijen vadeli aktarımı'), status: 'info', reason: 'Oksijen hesabın parayı gece vadeliye alıp ertesi gün geri koyması; hesap içi, kayda girmez. Faizi ve stopajı ayrı satırlardadır.', options: [], recommended: null, defaultOption: null, sideEffects: [] })
      continue
    }
    if (it.type === 'fund') {
      rows.push({ ...rowBase([l], 'untracked', it.label), status: 'info', note: 'Takip dışı', reason: 'Fon alım/satımları takip edilmiyor; kayda girmez.', options: [], recommended: null, defaultOption: null, sideEffects: [] })
      continue
    }

    const shapes = shapesFor(l)
    // Geçmiş: aynı karşı tarafla daha önce nasıl girilmiş
    if (shapes.length) {
      const groups = new Map<string, Shape[]>()
      for (const s of shapes) { const k = shapeKey(s); const g = groups.get(k); if (g) g.push(s); else groups.set(k, [s]) }
      const ranked = [...groups.values()]
        .map(g => g.sort((a, b) => b.date.localeCompare(a.date)))
        .sort((a, b) => b.length - a.length || b[0].date.localeCompare(a[0].date))
        .slice(0, 3)
      const opts = ranked.map((g, i) => {
        const tally = new Map<string, number>()
        for (const x of g) tally.set(x.description, (tally.get(x.description) ?? 0) + 1)
        const desc = [...tally].sort((a, b) => b[1] - a[1])[0][0]   // en sık; eşitlikte en yeni (g yeniden eskiye)
        return createOpt(`h${i}`, shapeLabel({ ...g[0], description: desc }), draft(l, { ...g[0], description: desc }, it.label))
      })
      const d0 = (opts[0].actions[0] as { draft: DraftTx }).draft
      const sure = ranked.length === 1 && (d0.type === 'transfer' ? !!(d0.fromAccountId ?? d0.toAccountId) : true)
      rows.push(decorate({
        ...rowBase([l], it.type === 'interest' || it.type === 'tax' ? it.type : kindOf(d0.type, incoming), d0.description),
        status: sure ? 'new' : 'review',
        issue: sure ? undefined : 'Bu karşı tarafla farklı kayıtlar var',
        reason: sure
          ? `Geçmişte ${it.label} ile ${shapes.length} kayıt aynı biçimde girilmiş.`
          : `Geçmişte ${it.label} ile ${shapes.length} kayıt ${ranked.length} farklı biçimde girilmiş; en sık olanı önerildi.`,
        options: [...opts, skip()],
        recommended: 0, defaultOption: sure ? 0 : null, sideEffects: [],
      }, d0))
      continue
    }

    // Geçmiş yok: türüne göre öneri
    if (it.type === 'broker') {
      rows.push({
        ...rowBase([l], 'investment', it.label),
        status: 'review',
        issue: incoming ? 'Yatırım satışı sistemde yok' : 'Yatırım alımı sistemde yok',
        reason: `${it.label} ${incoming ? 'hesabından gelen' : 'hesabına giden'} ${fmtTr(Math.abs(toMajor(signed(l))))} ₺ sistemde bulunamadı. ` +
          `Döküm pay miktarını bilmediği için buradan girilmez: ${incoming ? 'satışı' : 'alımı'} Yatırımlar'dan girin; bir sonraki yüklemede eşleşir.`,
        options: [skip('Şimdilik girme')], recommended: 0, defaultOption: null, sideEffects: [],
      })
      continue
    }
    if (it.type === 'own' || it.type === 'virman') {
      const bankAccounts = it.bankCode ? otherAccounts.filter(a => bankMatches(a.name, it.bankCode!)) : []
      if (incoming) {
        const tracked = otherAccounts.filter(a => a.type !== 'credit_card' && (it.type === 'own' ? bankAccounts.includes(a) : false))
        if (!tracked.length) {
          rows.push({ ...rowBase([l], 'untracked', it.label), status: 'info', note: 'Takip dışı', reason: `Kendi ${it.type === 'virman' ? 'diğer Odeabank hesabından' : 'hesabından'} gelen para; kaynak hesap sistemde takip edilmiyor, kayda girmez.`, options: [], recommended: null, defaultOption: null, sideEffects: [] })
          continue
        }
        const opts = tracked.map((a, i) => createOpt(`t${i}`, `Transfer: ${a.name}`, draft(l, { type: 'transfer', otherAccountId: a.id, description: 'Transfer' }, it.label)))
        rows.push({ ...rowBase([l], 'transfer-in', it.label), status: 'review', issue: 'Kendi hesabından giriş', reason: `${it.label} hesabından gelen para.`, options: [...opts, skip()], recommended: opts.length === 1 ? 0 : null, defaultOption: null, sideEffects: [] })
        continue
      }
      // Kendi hesabına giden: çoğunlukla o bankadaki kartın ödemesi
      const cards = bankAccounts.length ? bankAccounts : otherAccounts.filter(a => a.type === 'credit_card')
      const opts = cards.slice(0, 6).map((a, i) => createOpt(`t${i}`, `${a.type === 'credit_card' ? 'Kart ödemesi' : 'Transfer'}: ${a.name}`,
        draft(l, { type: 'transfer', otherAccountId: a.id, description: a.type === 'credit_card' ? 'Kredi Kartı Ödemesi' : 'Transfer' }, it.label)))
      rows.push({
        ...rowBase([l], 'transfer-out', it.label), status: 'review', issue: 'Kendi hesabına gönderim',
        reason: `${it.label}: ${bankAccounts.length ? 'o bankadaki hesaplarınız' : 'kartlarınız'} önerildi. Seçtiğin hesap bir dahaki dökümde hatırlanır.`,
        options: [...opts, skip()], recommended: bankAccounts.length === 1 ? 0 : null, defaultOption: null, sideEffects: [],
      })
      continue
    }
    if (it.type === 'card') {
      const sameBank = otherAccounts.filter(a => a.type === 'credit_card' && bankMatches(a.name, '0146'))
      const cards = sameBank.length ? sameBank : otherAccounts.filter(a => a.type === 'credit_card')
      const opts = cards.slice(0, 6).map((a, i) => createOpt(`t${i}`, `Kart ödemesi: ${a.name}`, draft(l, { type: 'transfer', otherAccountId: a.id, description: 'Kredi Kartı Ödemesi' }, it.label)))
      rows.push({
        ...rowBase([l], 'transfer-out', it.label), status: 'review', issue: `*${it.card4 ?? '????'} kartına ödeme`,
        reason: `Kart numarası *${it.card4} hangi hesabınız? Seçtiğin kart bir dahaki dökümde hatırlanır.`,
        options: [...opts, skip()], recommended: sameBank.length === 1 ? 0 : null, defaultOption: null, sideEffects: [],
      })
      continue
    }
    if (it.type === 'interest' || it.type === 'tax') {
      const income = it.type === 'interest'
      const d = draft(l, {
        type: income ? 'income' : 'expense',
        description: income ? 'Faiz' : 'Stopaj',
        recipientId: personByName(income ? 'Odeabank' : 'iTC') ?? null,
        categoryId: catByName(income ? 'Faiz' : 'Vergi', income ? 'income' : 'expense') ?? null,
      }, it.label)
      rows.push(decorate({
        ...rowBase([l], income ? 'interest' : 'tax', d.description),
        status: d.categoryId ? 'new' : 'review', issue: d.categoryId ? undefined : 'Kategori seçin',
        reason: income ? 'Brüt faiz geliri; stopaj ayrı satırda gider olarak girilir.' : 'Faizden kesilen gelir vergisi stopajı.',
        options: [createOpt('c', income ? 'Gelir olarak gir' : 'Gider olarak gir', d), skip()], recommended: 0, defaultOption: d.categoryId ? 0 : null, sideEffects: [],
      }, d))
      continue
    }

    // Kişi / kurum / nakit / diğer
    const person = it.name ? recipientFor(it.name) : undefined
    const type = incoming ? 'income' : 'expense'
    const own = person ? live.filter(t => t.recipientId === person.id && t.type === type) : []
    const categoryId = person ? recipientCategory(person.id, type, own, input.categories as Category[]) : undefined
    const d = draft(l, {
      type, description: person?.name ?? it.label, recipientId: person?.id ?? null, categoryId: categoryId ?? null,
    }, it.label, person || !it.name ? {} : { newRecipient: it.label })
    const dup = inAccount.filter(t => !usedTx.has(t.id) && effectOn(t, A) === signed(l) && dayDiff(t.date, l.date!) <= 15)
      .sort((a, b) => dayDiff(a.date, l.date!) - dayDiff(b.date, l.date!))[0]
    if (dup) {
      usedTx.add(dup.id)
      rows.push(decorate({
        ...rowBase([l], 'possible-dup', person?.name ?? it.label),
        status: 'review', issue: `Sistemde ${dayDiff(dup.date, l.date!)} gün farkla aynı tutar var`,
        match: { txIds: [dup.id], text: describeTx(dup) },
        reason: 'Tarihi farklı ama tutarı aynı bir kayıt var. Aynı işlemse kaydın tarihi dökümdeki gibi düzeltilir (yeni kayıt girilmez, sonraki yüklemelerde doğrudan eşleşir); ayrı bir işlemse gir.',
        options: [
          { key: 'same', label: `Aynı kayıt (tarihi ${fmtDay(l.date!)} olsun)`, actions: [{ type: 'patch', txId: dup.id, patch: { date: l.date!, ...(dup.merchant ? {} : { merchant: it.label }) } }] },
          createOpt('new', 'Ayrı kayıt, gir', d),
        ],
        recommended: 0, defaultOption: null, sideEffects: [],
      }, d))
      continue
    }
    const opts: RowOption[] = [createOpt('c', incoming ? 'Gelir olarak gir' : 'Gider olarak gir', d), skip()]
    rows.push(decorate({
      ...rowBase([l], it.type === 'cash' ? 'unknown' : kindOf(type, incoming), d.description),
      status: 'review',
      issue: person ? 'Yeni karşı taraf' : it.name ? 'Yeni alıcı' : 'Tanınmayan işlem',
      reason: person
        ? `Bu karşı taraf dökümde ilk kez görülüyor; adı "${person.name}" alıcısıyla eşleşti.${categoryId ? '' : ' Kategori seçmen gerekiyor.'}`
        : it.name ? `"${it.label}" sistemde yok; onaylarsan yeni alıcı olarak oluşturulur. Kategori seçmen gerekiyor.`
        : 'Bu işlem türünü tanımıyorum; gir ya da girme. Kararın bir dahaki dökümde hatırlanır.',
      options: opts, recommended: person && categoryId ? 0 : null, defaultOption: null, sideEffects: [],
    }, d))
  }

  // 6) Ters kontrol: dönem içinde sistemde olup dökümde olmayan
  const keep: RowOption = { key: 'keep', label: 'Sistemdeki kayıt kalsın', actions: [] }
  for (const t of inAccount) {
    if (usedTx.has(t.id) || t.date < firstDate || t.date > lastDate) continue
    rows.push({
      key: `sys:${t.id}`, lines: [], status: 'review', kind: 'orphan', date: t.date,
      amount: toMajor(-effectOn(t, A)), bonus: null, title: t.description, raw: describeTx(t), foreign: null,
      recipientId: t.recipientId ?? undefined, categoryId: t.categoryId ?? undefined,
      match: { txIds: [t.id], text: describeTx(t) },
      issue: 'Sistemde var, dökümde yok',
      reason: 'Bu kayıt bu hesapta, döküm dönemi içinde duruyor ama dökümde karşılığı yok. Başka bir hesaptan yapılmış ya da tutarı farklı girilmiş olabilir.',
      options: [keep, { key: 'delete', label: 'Sistemden sil', actions: [{ type: 'delete', txIds: [t.id] }] }],
      recommended: 0, defaultOption: null, sideEffects: [],
    })
  }

  // Sabit anahtar ve önceki "girme / kalsın" kararları
  const finalRows: PlanRow[] = rows.map(r => {
    const stableKey = r.lines.length ? r.lines.map(i => seedByIdx.get(i)!).join('+') : `sys:${r.match?.txIds[0] ?? r.key}`
    const row: PlanRow = { ...r, stableKey }
    if (input.skipped?.has(stableKey) && (r.status === 'review' || r.status === 'new')) {
      return {
        ...row, status: 'exists', issue: undefined,
        reason: (r.kind === 'orphan' ? 'Bu kaydın kalmasına daha önce karar verdin. ' : 'Bu satırı daha önceki bir yüklemede girmemeyi seçtin. ') + r.reason,
        options: [{ key: 'keep', label: r.kind === 'orphan' ? 'Kalsın (önceki kararın)' : 'Girme (önceki kararın)', actions: [] }, ...r.options.filter(o => o.actions.length > 0)],
        recommended: 0, defaultOption: 0,
      }
    }
    return row
  })

  const counted = matchable.length
  return { rows: finalRows, blockers, periodStart: info.periodStart, openingDate: null, matchedLines: matchOf.size, totalLines: counted }
}

/** Hesabın sistemdeki bakiyesi (verilen güne kadar, o gün dahil). */
export function systemBalance(account: Pick<Account, 'id' | 'initialBalance'>, transactions: readonly Transaction[], upTo: string): number {
  let m = minor(account.initialBalance ?? 0)
  for (const t of transactions) if (!t.deleted_at && t.date <= upTo) m += effectOn(t, account.id)
  return toMajor(m)
}

