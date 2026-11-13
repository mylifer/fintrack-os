import { foldText } from '@/lib/auto-category'
import { deterministicUuid } from '@/lib/utils/id'
import { toMajor, toMinor } from '@/lib/utils/money'
import type { Account, Category, Person, Transaction } from '@/types'
import type { ParsedStatement, StatementLine } from './statement'
import { buildRuleBook, merchantKey, merchantLabel, prettyMerchant, type MerchantRule } from './merchant'

/* ── Ekstre satırlarını sistemle karşılaştırma ve karar önerisi ──────────────
   SAF modül: store/DB bilmez. Girdi ayrıştırılmış ekstre + hesabın işlemleri;
   çıktı her satır (ya da birbirine bağlı satır kümesi) için bir PlanRow.

   Durumlar
     exists  sistemde karşılığı var → yazılmaz (onay bekliyorsa onaylanır)
     new     yüksek güvenle eşleşti → girilecek
     review  karar gerekiyor (mükerrer şüphesi, yeni alıcı, iptal, iade…)
     info    kayda girmez (bonus satırı)
   Bütün ekstreyi durduran sorunlar `blockers`ta.

   Mükerrer koruması üç katmanlıdır:
     1. Kimlik: içe aktarılan her satırın kimliği hesap + satırdan türetilir
        (deterministicUuid) — aynı ekstre ikinci kez yüklenirse satırlar "zaten
        içe aktarıldı" olur. Taksit grubunun kimliği alım ayı + işyeri + taksit
        sayısı + toplamdan türetilir: sonraki ayın ekstresindeki 2. taksit,
        bu ay oluşturulan grubun 2. satırını kimliğiyle bulur.
     2. Elle girilmiş kayıtlar: aynı hesap, aynı tutar, ±4 gün.
     3. Ters kontrol: dönem içinde sistemde olup ekstrede olmayan kayıtlar. */

export type RowStatus = 'review' | 'new' | 'exists' | 'info'

export type RowKind =
  | 'purchase' | 'installment-new' | 'installment' | 'installment-missing'
  | 'opening' | 'lump' | 'payment' | 'fee' | 'refund' | 'bonus'
  | 'net-zero' | 'cancel' | 'amount-diff' | 'possible-dup' | 'unknown' | 'orphan'
  // vadesiz hesap dökümü
  | 'income' | 'transfer-in' | 'transfer-out' | 'interest' | 'tax' | 'internal' | 'investment' | 'untracked'

/** Yazılacak bir işlemin taslağı. Kimlik `idSeed`ten türetilir. */
export interface DraftTx {
  type: 'expense' | 'income' | 'transfer'
  /** expense: + harcama, − iade · income: + · transfer: + */
  amount: number
  date: string
  description: string
  merchant?: string
  recipientId?: string | null
  /** Onayda oluşturulacak yeni alıcının adı (recipientId yerine) */
  newRecipient?: string
  categoryId?: string
  familyMemberId?: string | null
  tags?: string[]
  refundOfId?: string
  /** Hesaba GELEN transferin kaynak hesabı (karta ödeme, vadesize giriş) */
  fromAccountId?: string
  /** Hesaptan GİDEN transferin hedef hesabı (vadesizden kart ödemesi vb.) */
  toAccountId?: string
  /** Taksitli grup: her taksitin tutarı ve tarihi */
  installments?: { amounts: number[]; dates: string[] }
  /** Var olan bir taksit grubunun eksik tek taksiti */
  installmentOf?: { groupId: string; index: number; count: number }
  idSeed: string
  /** Onay ekranında açıklama/alıcı/kategori değiştirilebilir mi */
  editable: boolean
  /** "Var olan alıcıyla gir": alıcı seçilmeden kayıt yapılmaz */
  needsRecipient?: boolean
}

export type Action =
  | { type: 'create'; draft: DraftTx }
  | { type: 'delete'; txIds: string[] }
  | { type: 'patch'; txId: string; patch: Partial<Transaction> }

export interface RowOption {
  key: string
  label: string
  actions: Action[]
}

/** Seçeneklerin ekrandaki sırası (indeksler): "Girme" hep en sonda */
export function optionDisplayOrder(options: readonly RowOption[]): number[] {
  const idx = options.map((_, i) => i)
  return [...idx.filter(i => options[i].key !== 'skip'), ...idx.filter(i => options[i].key === 'skip')]
}

export interface PlanRow {
  key: string
  /** Ekstre satır indeksleri (ters kontrol satırında boş) */
  lines: number[]
  status: RowStatus
  kind: RowKind
  date: string
  /** Kart borcuna etkisi (+ borç, − alacak); bonus satırında null */
  amount: number | null
  bonus: number | null
  title: string
  raw: string
  recipientId?: string
  recipientName?: string
  newRecipient?: boolean
  categoryId?: string
  categoryGuess?: boolean
  installment?: { index: number; count: number; total: number }
  foreign?: { amount: number; currency: string } | null
  /** Sistemdeki karşılık(lar) */
  match?: { txIds: string[]; text: string }
  /** Neden bu karar — kullanıcıya gösterilir */
  reason: string
  /** Karar gereken satırın kısa sorunu */
  issue?: string
  note?: string
  options: RowOption[]
  /** Önerilen seçenek (review'da da gösterilir) */
  recommended: number | null
  /** review dışındaki satırlarda seçili seçenek; review'da kullanıcı seçer */
  defaultOption: number | null
  /** Her durumda uygulanan yan etkiler: onaylama, merchant öğrenimi */
  sideEffects: Action[]
  /** Yüklemeler arası sabit anahtar ("girme" kararlarını hatırlamak için) */
  stableKey: string
}

export interface ImportPlan {
  rows: PlanRow[]
  blockers: string[]
  periodStart: string
  openingDate: string | null
  matchedLines: number
  totalLines: number
}

export interface PlanInput {
  statement: ParsedStatement
  account: Pick<Account, 'id' | 'name' | 'currency' | 'createdAt' | 'type'>
  accounts: readonly Pick<Account, 'id' | 'name' | 'type' | 'isArchived'>[]
  /** Aktif çalışma alanının canlı işlemleri (tüm hesaplar) */
  transactions: readonly Transaction[]
  people: readonly Person[]
  categories: readonly Category[]
  todayStr: string
  /** Daha önce "girme" kararı verilmiş satırların stableKey'leri (bu cihazda) */
  skipped?: ReadonlySet<string>
}

// ── Yardımcılar ──────────────────────────────────────────────────────────────

const DAY = 86_400_000
const dayNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY
const dayDiff = (a: string, b: string) => Math.abs(dayNum(a) - dayNum(b))
const minor = toMinor

function isoFromDays(n: number): string {
  const d = new Date(n * DAY)
  return d.toISOString().slice(0, 10)
}

/** Ay ekler; gün kısa ayda ay sonuna sıkışır. */
export function addMonthsIso(iso: string, months: number): string {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + months, d = +iso.slice(8, 10)
  const first = new Date(Date.UTC(y, m, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

const fmtTr = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const fmtDay = (iso: string) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]}`
const fmtDayYear = (iso: string) => `${fmtDay(iso)} ${iso.slice(0, 4)}`

/** Bankanın taksit bölüşümü: ilk taksit kalanı taşır, diğerleri eşit
 *  (366,65 / 366,63 / 366,63). İlk taksit ekstreden bilinir. */
export function bankInstallmentAmounts(total: number, count: number, first: number): number[] {
  if (count <= 1) return [total]
  const restMinor = Math.floor((minor(total) - minor(first)) / (count - 1))
  const amounts = [first, ...Array.from({ length: count - 1 }, () => toMajor(restMinor))]
  // Kuruş kalanı son taksite: toplam her durumda birebir korunur
  const drift = minor(total) - amounts.reduce((s, a) => s + minor(a), 0)
  amounts[count - 1] = toMajor(minor(amounts[count - 1]) + drift)
  return amounts
}

/** Satırın alım tarihi: taksit satırının tarihi alım + (k−1) aydır. */
export function purchaseDateOf(line: StatementLine, fallback: string): string {
  const d = line.date ?? fallback
  return line.installment ? addMonthsIso(d, -(line.installment.index - 1)) : d
}

/** Taksit grubunun kimlik tohumu: alım AYI + işyeri + taksit sayısı + toplam
 *  (gün değil: 31'inde yapılan alımın taksitleri kısa aylarda 28'ine kayar). */
export function installmentGroupSeed(accountId: string, line: StatementLine, statementDate: string, occurrence = 0): string {
  const inst = line.installment!
  const month = purchaseDateOf(line, statementDate).slice(0, 7)
  return `stmt-inst:${accountId}:${month}|${merchantKey(line.description)}|${inst.count}|${minor(inst.total)}|${occurrence}`
}

/** Tek satırın kimlik tohumu (aynı gün aynı tutarda aynı işyerinden iki
 *  satır varsa sıra numarası ayırır). */
export function lineSeed(accountId: string, line: StatementLine, statementDate: string, occurrence: number): string {
  return `stmt:${accountId}:${line.date ?? statementDate}|${minor(line.amount ?? 0)}|${merchantKey(line.description)}|${occurrence}`
}

export const txIdFromSeed = (seed: string, index?: number) => deterministicUuid(index === undefined ? seed : `${seed}:${index}`)

const FEE_LABELS: Record<string, string> = {
  'donem faizi': 'Dönem Faizi',
  'gec odeme faizi': 'Geç Ödeme Faizi',
  'gecikme faizi': 'Gecikme Faizi',
  'kkdf + bsmv': 'KKDF + BSMV',
  'nakit avans faizi': 'Nakit Avans Faizi',
}

function feeLabel(desc: string): string {
  const f = foldText(desc)
  return FEE_LABELS[f] ?? desc.replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR').replace(/(^|\s)(\p{L})/gu, (_, s: string, c: string) => s + c.toLocaleUpperCase('tr-TR'))
}

// ── Ana fonksiyon ────────────────────────────────────────────────────────────

export function buildImportPlan(input: PlanInput): ImportPlan {
  const { statement: st, account } = input
  const acc = account.id
  const blockers: string[] = []
  if (!st.check.ok) blockers.push(...st.check.issues)
  if (account.currency !== st.currency) blockers.push(`Ekstre ${st.currency}, seçili hesap ${account.currency}. TL ekstre yalnız TL hesaba yüklenebilir.`)
  if (account.type !== 'credit_card') blockers.push('Kredi kartı ekstresi yalnız kredi kartı hesabına yüklenebilir.')

  const live = input.transactions.filter(t => !t.deleted_at)
  const byId = new Map(live.map(t => [t.id, t]))
  const accTx = live.filter(t => t.accountId === acc || t.toAccountId === acc)
  const peopleById = new Map(input.people.map(p => [p.id, p]))
  const catById = new Map(input.categories.map(c => [c.id, c]))
  const accName = new Map(input.accounts.map(a => [a.id, a.name]))

  const catPath = (id?: string | null): string | undefined => {
    let c = id ? catById.get(id) : undefined
    const parts: string[] = []
    for (let i = 0; c && i < 4; i++) { parts.unshift(c.name); c = c.parentId ? catById.get(c.parentId) : undefined }
    return parts.length ? parts.join(' › ') : undefined
  }
  const describeTx = (t: Transaction): string => {
    const bits = [fmtDay(t.date), `“${t.description}”`]
    if (t.type === 'transfer') bits.push(`${accName.get(t.accountId) ?? 'hesap'} → ${accName.get(t.toAccountId ?? '') ?? 'kart'}`)
    else if (t.workspaceTransferId) bits.push('çalışma alanları arası transfer')
    else {
      bits.push(t.recipientId ? peopleById.get(t.recipientId)?.name ?? 'alıcı' : 'alıcısız')
      bits.push(catPath(t.categoryId) ?? 'kategorisiz')
    }
    bits.push(`${fmtTr(Math.abs(t.amount))} ₺`)
    if (t.isInstallment) bits.push(`taksit ${t.installIndex}/${t.installTotal}`)
    if (t.approvalStatus === 'pending') bits.push('onay bekliyor')
    return bits.join(' · ')
  }

  // Kullanıcının iade etiketi (en sık kullanılan; yoksa "İade")
  const refundTag = (() => {
    const tally = new Map<string, number>()
    for (const t of live) if (t.refundOfId || t.description.startsWith('[İade]')) for (const g of t.tags ?? []) if (foldText(g).replace('#', '') === 'iade') tally.set(g, (tally.get(g) ?? 0) + 1)
    return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'İade'
  })()

  // Hesabın açılışı: oluşturulma günü ile ilk işlemin erkeni. Bundan önceki
  // alımların kalan taksitleri açılış bakiyesinin içindedir.
  const firstTx = accTx.reduce<string | null>((m, t) => (!m || t.date < m ? t.date : m), null)
  const created = account.createdAt?.slice(0, 10) || null
  const openingDate = [created, firstTx].filter((x): x is string => !!x).sort()[0] ?? null
  const periodStart = isoFromDays(dayNum(st.prevStatementDate ?? addMonthsIso(st.statementDate, -1)) + 1)

  const lines = st.lines.filter(l => l.kind !== 'carry')
  const lineByIdx = new Map(lines.map(l => [l.index, l]))
  const dateOf = (l: StatementLine) => l.date ?? st.statementDate

  // Satır kimlikleri (aynı imza tekrarında sıra numarası)
  const seedOf = new Map<number, string>()
  const groupSeedOf = new Map<number, string>()
  {
    const seen = new Map<string, number>()
    for (const l of lines) {
      if (l.amount === null) continue
      const base = lineSeed(acc, l, st.statementDate, 0)
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      seedOf.set(l.index, lineSeed(acc, l, st.statementDate, n))
      if (l.installment) {
        const g = installmentGroupSeed(acc, l, st.statementDate, 0)
        const k = `${g}#${l.installment.index}`
        const gn = seen.get(k) ?? 0
        seen.set(k, gn + 1)
        groupSeedOf.set(l.index, installmentGroupSeed(acc, l, st.statementDate, gn))
      }
    }
  }

  // ── 1) Eşleştirme ──
  const used = new Set<string>()
  type Via = 'imported' | 'manual' | 'net'
  const matchOf = new Map<number, { txIds: string[]; via: Via }>()
  const take = (idx: number, txIds: string[], via: Via) => {
    matchOf.set(idx, { txIds, via })
    txIds.forEach(id => used.add(id))
  }

  // 1a) Daha önce içe aktarılmış satırlar (kimlikten)
  for (const l of lines) {
    if (l.amount === null) continue
    const ids = [txIdFromSeed(seedOf.get(l.index)!)]
    if (l.installment) ids.push(txIdFromSeed(groupSeedOf.get(l.index)!, l.installment.index))
    const hit = ids.find(id => byId.has(id) && !used.has(id))
    if (hit) take(l.index, [hit], 'imported')
  }

  // 1b) Birden çok ödeme satırı tek transfere (75.130,15 + 100.000 = 175.130,15)
  // Ödeme bazen kaynak hesapsız "gelir" olarak girilmiş olur ("Kredi Kartı Ödemesi" geliri); o da ödeme sayılır
  const isCardPayment = (t: Transaction) =>
    (t.type === 'transfer' && t.toAccountId === acc) || (t.type === 'income' && t.accountId === acc)
  const payLines = lines.filter(l => l.kind === 'payment' && !matchOf.has(l.index) && l.date)
  for (const t of accTx.filter(isCardPayment)) {
    if (used.has(t.id)) continue
    const near = payLines.filter(l => !matchOf.has(l.index) && dayDiff(l.date!, t.date) <= 3)
    if (near.length < 2) continue
    const target = minor(t.amount)
    let found: StatementLine[] | null = null
    for (let i = 0; i < near.length && !found; i++)
      for (let j = i + 1; j < near.length && !found; j++) {
        if (-minor(near[i].amount!) - minor(near[j].amount!) === target) found = [near[i], near[j]]
        for (let k = j + 1; k < near.length && !found; k++)
          if (-minor(near[i].amount!) - minor(near[j].amount!) - minor(near[k].amount!) === target) found = [near[i], near[j], near[k]]
      }
    if (found) {
      // Tüm satırlar aynı transfere bağlanır; transfer bir kez "kullanılır"
      for (const l of found) matchOf.set(l.index, { txIds: [t.id], via: 'manual' })
      used.add(t.id)
    }
  }

  // 1c) Genel adaylar — en iyi puandan başlayarak açgözlü atama
  interface Cand { idx: number; txId: string; score: number }
  const cands: Cand[] = []
  for (const l of lines) {
    if (l.amount === null || matchOf.has(l.index)) continue
    const d = dateOf(l)
    const amt = minor(l.amount)
    for (const t of accTx) {
      if (used.has(t.id)) continue
      if (l.kind === 'payment') {
        if (isCardPayment(t) && minor(t.amount) === -amt && dayDiff(t.date, d) <= 3) cands.push({ idx: l.index, txId: t.id, score: dayDiff(t.date, d) })
        continue
      }
      if (t.accountId !== acc) continue
      if (l.installment) {
        if (t.type !== 'expense' || !t.isInstallment || t.installIndex !== l.installment.index) continue
        if (Math.sign(t.amount) !== Math.sign(l.amount)) continue
        const diff = Math.abs(minor(t.amount) - amt)
        if (diff > 5 || dayDiff(t.date, d) > 4) continue
        cands.push({ idx: l.index, txId: t.id, score: dayDiff(t.date, d) + diff / 100 + (t.installTotal !== l.installment.count ? 5 : 0) })
        continue
      }
      if (l.kind === 'fee') {
        if (t.type === 'expense' && minor(t.amount) === amt && dayDiff(t.date, d) <= (l.date ? 4 : 10)) cands.push({ idx: l.index, txId: t.id, score: dayDiff(t.date, d) })
        continue
      }
      if (l.kind === 'refund') {
        const ok = (t.type === 'expense' && minor(t.amount) === amt) ||
          (t.type === 'income' && !t.workspaceTransferId && minor(t.amount) === -amt)
        if (ok && dayDiff(t.date, d) <= 4) cands.push({ idx: l.index, txId: t.id, score: dayDiff(t.date, d) })
        continue
      }
      // Tek çekim harcama
      if (t.type === 'expense' && !t.isInstallment && minor(t.amount) === amt && dayDiff(t.date, d) <= 4) {
        cands.push({ idx: l.index, txId: t.id, score: dayDiff(t.date, d) })
      } else if (st.provisional && l.kind === 'purchase' && t.type === 'expense' && t.isInstallment &&
        Math.abs(minor(t.amount) - amt) <= 5 && dayDiff(t.date, d) <= 4) {
        // Dönem içi listelerde taksit bilgisi olmayabilir (Odeabank, QNB): satır
        // sistemdeki taksidin kendisidir; tek çekimden sonra gelir
        cands.push({ idx: l.index, txId: t.id, score: dayDiff(t.date, d) + 0.5 + Math.abs(minor(t.amount) - amt) / 100 })
      }
    }
  }
  cands.sort((a, b) => a.score - b.score)
  for (const c of cands) {
    if (matchOf.has(c.idx) || used.has(c.txId)) continue
    take(c.idx, [c.txId], 'manual')
  }

  // 1d) İadesi düşülmüş "net" taksitli giriş: 4.199,98 ₺'lik 3 taksitli alımın
  // 2.099,99'u iade edilmiş, kullanıcı alımı 2.099,99 olarak 3 taksitte girmiş.
  // Ekstrede alım ve iade iki ayrı taksit dizisidir; sistemdeki grubun toplamı
  // ikisinin farkını tutarsa her iki dizinin satırları grubun aynı sıradaki
  // taksitine bağlanır.
  {
    const sysGroups = new Map<string, Transaction[]>()
    for (const t of accTx) {
      if (t.accountId !== acc || t.type !== 'expense' || !t.installGroupId) continue
      const g = sysGroups.get(t.installGroupId)
      if (g) g.push(t)
      else sysGroups.set(t.installGroupId, [t])
    }
    const subs = new Map<string, { sign: 1 | -1; total: number; lines: StatementLine[] }>()
    for (const l of lines) {
      if (!l.installment || l.amount === null || matchOf.has(l.index)) continue
      const sign = l.amount > 0 ? 1 : -1
      const k = `${merchantKey(l.description)}|${l.installment.count}|${purchaseDateOf(l, st.statementDate).slice(0, 7)}|${sign}|${minor(l.installment.total)}`
      const e = subs.get(k)
      if (e) e.lines.push(l)
      else subs.set(k, { sign, total: l.installment.total, lines: [l] })
    }
    const entries = [...subs.entries()]
    for (const [kc, c] of entries) {
      if (c.sign !== 1) continue
      const prefix = kc.split('|').slice(0, 3).join('|')
      for (const [kr, r] of entries) {
        if (r.sign !== -1 || kr.split('|').slice(0, 3).join('|') !== prefix) continue
        const n = c.lines[0].installment!.count
        const netMinor = minor(c.total) - minor(r.total)
        const month = kc.split('|')[2]
        const group = [...sysGroups.values()].find(g =>
          g.length > 0 && g[0].installTotal === n && !g.some(t => used.has(t.id)) &&
          Math.abs(g.reduce((s2, t) => s2 + minor(t.amount), 0) - netMinor) <= n * 5 &&
          g.reduce((m, t) => (t.date < m ? t.date : m), g[0].date).slice(0, 7) === month)
        if (!group) continue
        for (const l of [...c.lines, ...r.lines]) {
          const t = group.find(x => x.installIndex === l.installment!.index)
          if (t) matchOf.set(l.index, { txIds: [t.id], via: 'net' })
        }
        group.forEach(t => used.add(t.id))
      }
    }
  }

  // ── 2) Öğrenme: eşleşen satırlar kural kitabını besler ──
  const extra: { description: string; tx: Transaction }[] = []
  for (const [idx, m] of matchOf) {
    const l = lineByIdx.get(idx)!
    const t = byId.get(m.txIds[0])
    if (t && (l.kind === 'purchase') && t.type === 'expense' && t.amount > 0) extra.push({ description: l.description, tx: t })
  }
  // Bankanın kategori etiketi → kullanıcının kategorisi. Önce bu ekstrede sistemle
  // eşleşen satırlardan öğrenilir (Garanti "Market" satırlarını hep "Market"e
  // giriyorsan), yoksa kategori adının benzerliğinden.
  const labelTally = new Map<string, Map<string, number>>()
  for (const [idx, m] of matchOf) {
    const l = lineByIdx.get(idx)!
    const t = byId.get(m.txIds[0])
    if (!l.bankCategory || !t?.categoryId || t.type !== 'expense') continue
    const k = foldText(l.bankCategory)
    const tally = labelTally.get(k) ?? new Map<string, number>()
    tally.set(t.categoryId, (tally.get(t.categoryId) ?? 0) + 1)
    labelTally.set(k, tally)
  }
  const expenseCats = input.categories.filter(c => c.scope === 'expense' && !c.isArchived)
  const bankCategory = (label: string): string | undefined => {
    const tally = labelTally.get(foldText(label))
    if (tally) {
      const [best, n] = [...tally].sort((a, b) => b[1] - a[1])[0]
      const total = [...tally.values()].reduce((s2, x) => s2 + x, 0)
      if (n / total >= 0.6) return best
    }
    // "Yeme / İçme" ~ "Yeme İçme", "Market" ~ "Market"; "Diğer"/"Kart Ödemesi" eşlenmez
    if (/^(diger|kart odemesi)$/.test(foldText(label))) return undefined
    const words = (x: string) => foldText(x).split(/[^a-z0-9]+/).filter(w => w.length >= 3)
    const lw = words(label)
    if (!lw.length) return undefined
    const same = expenseCats.filter(c => words(c.name).join(' ') === lw.join(' '))
    if (same.length === 1) return same[0].id
    // Biri ötekinin kelimelerini kapsıyor ("Sağlık / Bakım" ~ "Sağlık"); tek aday olmalı
    const near = expenseCats.filter(c => { const cw = words(c.name); return cw.length > 0 && (cw.every(w => lw.includes(w)) || lw.every(w => cw.includes(w))) })
    return near.length === 1 ? near[0].id : undefined
  }
  const rules = buildRuleBook({ transactions: live, extra, people: input.people, categories: input.categories, refundTag, bankCategory })

  // Alacak satırı → gelir (QNB "alşv ind", "Indirim": kullanıcı "Yemek Cashback" geliri olarak giriyor).
  // Anahtar tutarsızdır ("… 414.00 alşv ind" → "… alşv ind"); bu kartta aynı anahtarla girilmiş gelirlerden öğrenilir.
  const creditKey = (d: string) => merchantKey(d.replace(/\d[\d.,]*/g, ' '))
  const incomeByKey = new Map<string, Transaction[]>()
  const pushIncome = (k: string, t: Transaction) => {
    const list = incomeByKey.get(k)
    if (!list) incomeByKey.set(k, [t]); else if (!list.some(x => x.id === t.id)) list.push(t)
  }
  for (const t of accTx) if (t.type === 'income' && t.accountId === acc && t.merchant && !t.workspaceTransferId) pushIncome(creditKey(t.merchant), t)
  for (const [idx, m] of matchOf) {
    const l = lineByIdx.get(idx)!
    const t = byId.get(m.txIds[0])
    if (t && l.kind === 'refund' && t.type === 'income' && !t.workspaceTransferId) pushIncome(creditKey(l.description), t)
  }

  // ── 3) Satır satır karar ──
  const rows: Omit<PlanRow, 'stableKey'>[] = []
  const handled = new Set<number>()

  const baseRow = (l: StatementLine): Omit<PlanRow, 'status' | 'kind' | 'title' | 'reason' | 'options' | 'recommended' | 'defaultOption' | 'sideEffects' | 'stableKey'> => ({
    key: `L${l.index}`,
    lines: [l.index],
    date: dateOf(l),
    amount: l.amount,
    bonus: l.bonus,
    raw: l.description,
    installment: l.installment ?? undefined,
    foreign: l.foreign,
  })

  const ruleBits = (rule: MerchantRule | undefined) => ({
    recipientId: rule?.recipientId,
    recipientName: rule?.recipientId ? peopleById.get(rule.recipientId)?.name : undefined,
    categoryId: rule?.categoryId,
    categoryGuess: !!rule?.categoryId && !rule.categorySure,
  })

  const ruleReason = (l: StatementLine, rule: MerchantRule | undefined): string => {
    if (!rule) return ''
    const rn = rule.recipientId ? peopleById.get(rule.recipientId)?.name : undefined
    const cn = catPath(rule.categoryId)
    const catText = rule.categoryFrom === 'bank'
      ? ` Kategori, bankanın “${l.bankCategory}” etiketinden: ${cn}.`
      : rule.categoryFrom === 'keyword' ? ` Kategori, ${cn} kategorisinin anahtar kelime kuralından.` : ''
    if (rule.source === 'history') {
      const seen = rule.via ? `“${merchantLabel(l.description)}”, daha önce “${rule.via}” olarak ${rule.count} kez eşleşen işyeriyle aynı` : `“${merchantLabel(l.description)}” daha önce ${rule.count} kez eşleşti`
      return `${seen}: alıcı ${rn ?? 'yok'}` +
        (rule.categoryFrom === 'history' && cn ? (rule.categorySure ? `, kategori hep ${cn}.` : `, kategori değişken; en sık olanı (${cn}) önerildi.`) : '.') + catText
    }
    if (rule.source === 'brand') {
      return `“${rule.via?.toUpperCase()}” markasının önceki ${rule.count} alımı “${rn}” alıcısına girilmiş` +
        (rule.confidence === 'maybe' ? '; bu şube de aynı alıcı olabilir.' : '; bu şube de ona eşlendi.') +
        (rule.categoryFrom === 'history' && cn ? ` Kategori: ${cn}.` : '') + catText
    }
    if (rule.source === 'recipient') {
      return (rule.confidence === 'maybe'
        ? `İşyeri adı kayıtlı “${rn}” alıcısına benziyor (yazım biraz farklı).`
        : `İşyeri adında “${rn}” geçiyor.`) +
        (rule.categoryFrom === 'history' ? ` Kategori bu alıcıya en sık verdiğin: ${cn ?? 'yok'}.` : '') + catText
    }
    return catText.trim()
  }

  const draftFor = (l: StatementLine, rule: MerchantRule | undefined, extraFields: Partial<DraftTx> = {}): DraftTx => {
    const rn = rule?.recipientId ? peopleById.get(rule.recipientId)?.name : undefined
    return {
      type: 'expense',
      amount: l.amount!,
      date: dateOf(l),
      description: rule?.description ?? rn ?? prettyMerchant(l.description),
      merchant: merchantLabel(l.description),
      recipientId: rule?.recipientId ?? null,
      categoryId: rule?.categoryId,
      familyMemberId: rule?.familyMemberId ?? null,
      tags: rule?.tags,
      idSeed: seedOf.get(l.index)!,
      editable: true,
      ...extraFields,
    }
  }

  const sideEffectsFor = (txIds: string[], l?: StatementLine): Action[] => {
    const out: Action[] = []
    for (const id of txIds) {
      const t = byId.get(id)
      if (!t) continue
      const patch: Partial<Transaction> = {}
      if (t.approvalStatus === 'pending' && t.date <= input.todayStr) Object.assign(patch, { approvalStatus: 'approved' })
      // Faiz/ücret satırları işyeri değildir; öğrenilecek bir eşleşme yok
      if (l && !t.merchant && (l.kind === 'purchase' || l.kind === 'refund') && t.type === 'expense') patch.merchant = merchantLabel(l.description)
      // İndirim / cashback satırını gelir olarak giriyorsan o da öğrenilir
      if (l && !t.merchant && l.kind === 'refund' && t.type === 'income') patch.merchant = merchantLabel(l.description)
      if (Object.keys(patch).length) out.push({ type: 'patch', txId: id, patch })
    }
    return out
  }

  const skip: RowOption = { key: 'skip', label: 'Girme', actions: [] }
  /** Benzer alıcı önerisi: önerilen alıcı / yeni alıcı / girme / başka alıcı */
  const guessOptions = (draft: DraftTx, name: string, l: StatementLine): RowOption[] => {
    const fresh = prettyMerchant(l.description)
    const bare = { ...draft, recipientId: null, description: draft.description === name ? fresh : draft.description }
    return [
      { key: 'create', label: `“${name}” ile gir`, actions: [{ type: 'create', draft }] },
      { key: 'create-new', label: 'Yeni alıcıyla gir', actions: [{ type: 'create', draft: { ...bare, newRecipient: fresh } }] },
      skip,
      { key: 'create-existing', label: 'Başka alıcıyla gir', actions: [{ type: 'create', draft: { ...bare, needsRecipient: true } }] },
    ]
  }
  const keep: RowOption = { key: 'keep', label: 'Sistemdeki kayıt kalsın', actions: [] }

  // 3a) Taksitli iptal / taksitli iade kümeleri (alım hesabın açılışından sonra)
  {
    const sigOf = (l: StatementLine) => `${merchantKey(l.description)}|${l.installment!.count}|${minor(l.installment!.total)}`
    const groups = new Map<string, StatementLine[]>()
    for (const l of lines) if (l.installment && l.amount !== null) {
      const k = sigOf(l)
      const g = groups.get(k)
      if (g) g.push(l)
      else groups.set(k, [l])
    }
    for (const g of groups.values()) {
      const pd = purchaseDateOf(g[0], st.statementDate)
      if (openingDate && pd < openingDate) continue
      const credits = g.filter(l => l.amount! < 0 && !matchOf.has(l.index))
      if (!credits.length) continue
      const members = g.filter(l => !matchOf.has(l.index))
      // Sistemdeki grup: eşleşmiş bir üyenin grubu ya da imzası tutan grup
      const matchedMember = g.find(l => matchOf.has(l.index))
      let groupTx: Transaction[] = []
      const gid = matchedMember ? byId.get(matchOf.get(matchedMember.index)!.txIds[0])?.installGroupId : undefined
      if (gid) groupTx = live.filter(t => t.installGroupId === gid)
      else {
        const seedGroup = txIdFromSeed(installmentGroupSeed(acc, g[0], st.statementDate))
        groupTx = live.filter(t => t.installGroupId === seedGroup)
      }
      const deletable = groupTx.length > 0 && groupTx.every(t => !t.debtId && !t.refundOfId)
      const onlyCredits = members.every(l => l.amount! < 0)
      const hasFirst = members.some(l => l.installment!.index === 1)
      const net = toMajor(members.reduce((s, l) => s + minor(l.amount!), 0))
      const head = members[0]
      const rule = rules.ruleFor(head.description, head.bankCategory)
      const options: RowOption[] = []
      const recommended = 0
      if (deletable) options.push({ key: 'cancel-group', label: `Taksitli alımı iptal et (sistemdeki ${groupTx.length} kaydı sil)`, actions: [{ type: 'delete', txIds: groupTx.map(t => t.id) }] })
      if (onlyCredits && hasFirst && !deletable) {
        const inst = head.installment!
        const amounts = bankInstallmentAmounts(-inst.total, inst.count, members.find(l => l.installment!.index === 1)!.amount!)
        options.push({
          key: 'refund-group',
          label: `Taksitli iade olarak gir (${inst.count} taksit)`,
          actions: [{ type: 'create', draft: draftFor(head, rule, {
            amount: -inst.total, date: pd, description: `[İade] ${rule?.description ?? prettyMerchant(head.description)}`,
            tags: [...(rule?.tags ?? []), refundTag],
            installments: { amounts, dates: amounts.map((_, i) => addMonthsIso(pd, i)) },
            idSeed: installmentGroupSeed(acc, head, st.statementDate),
          }) }],
        })
      }
      options.push({ key: 'skip', label: 'Hiçbirini girme', actions: [] })
      options.push({
        key: 'separate', label: 'Satırları ayrı ayrı gir',
        actions: members.map(l => ({ type: 'create' as const, draft: draftFor(l, rule, l.amount! < 0 ? { description: `[İade] ${rule?.description ?? prettyMerchant(l.description)}`, tags: [...(rule?.tags ?? []), refundTag] } : {}) })),
      })
      const unclear = onlyCredits && !hasFirst && !deletable
      const title = rule?.description ?? peopleById.get(rule?.recipientId ?? '')?.name ?? prettyMerchant(head.description)
      rows.push({
        ...baseRow(head),
        key: `C${head.index}`,
        lines: members.map(l => l.index),
        amount: net,
        status: 'review',
        kind: 'cancel',
        title: `${title} · ${head.installment!.count} taksitli ${onlyCredits ? 'iade' : 'alım iptal edilmiş'}`,
        ...ruleBits(rule),
        issue: onlyCredits ? 'Taksitli iade' : 'İptal edilen taksitli alım',
        reason: unclear
          ? `${fmtTr(head.installment!.total)} ₺'lik bir iade ${head.installment!.count} taksitte karta geri ödeniyor; bu ekstredeki taksitlerin (${members.map(l => `${l.installment!.index}/${l.installment!.count}`).join(', ')}) sistemde karşılığı yok. ` +
            'İadeyi hesabın açılış bakiyesine dahil ettiysen girme; etmediysen satırları ayrı ayrı gir.'
          : deletable
          ? `${fmtDayYear(pd)} tarihli ${fmtTr(head.installment!.total)} ₺'lik alım iade edilmiş ve sistemde bu alımın ${groupTx.length} taksiti var. Önerilen: taksit grubunu iptal et; böylece kart borcu bankayla aynı kalır.`
          : onlyCredits && hasFirst
            ? `${fmtTr(head.installment!.total)} ₺ ${head.installment!.count} taksitte karta geri ödeniyor. Önerilen: iadeyi taksitli olarak bir kez gir; sonraki taksitler sonraki ekstrelerde "zaten var" görünür.`
            : `${fmtDayYear(pd)} tarihli ${fmtTr(head.installment!.total)} ₺'lik taksitli alım iade edilmiş; sistemde bu alımın taksitleri yok. Bu satırların karta net etkisi ${fmtTr(net)} ₺. Önerilen: hiçbirini girme.`,
        options,
        recommended: unclear ? null : recommended,
        defaultOption: null,
        sideEffects: [],
      })
      members.forEach(l => handled.add(l.index))
    }
  }

  // 3b) Aynı işyerinden aynı tutarda çekim + iade (net sıfır) — ikisi de sistemde yoksa
  for (const r of lines) {
    if (r.kind !== 'refund' || r.installment || handled.has(r.index) || matchOf.has(r.index)) continue
    const twin = lines.find(p => p.kind === 'purchase' && !p.installment && !handled.has(p.index) && !matchOf.has(p.index) &&
      merchantKey(p.description) === merchantKey(r.description) && minor(p.amount!) === -minor(r.amount!) && dayDiff(dateOf(p), dateOf(r)) <= 10)
    if (!twin) continue
    const rule = rules.ruleFor(twin.description, twin.bankCategory)
    const purchaseDraft = draftFor(twin, rule)
    const purchaseId = txIdFromSeed(purchaseDraft.idSeed)
    const matchedSibling = lines.find(p => p !== twin && matchOf.has(p.index) && merchantKey(p.description) === merchantKey(twin.description) && minor(p.amount ?? 0) === minor(twin.amount!))
    rows.push({
      ...baseRow(twin),
      key: `N${twin.index}`,
      lines: [twin.index, r.index],
      amount: 0,
      status: 'review',
      kind: 'net-zero',
      title: `${purchaseDraft.description} · çekim ve iadesi`,
      ...ruleBits(rule),
      issue: matchedSibling ? 'Çift çekim + iade' : 'Çekim ve aynı tutarda iade',
      reason: (matchedSibling
        ? `${fmtDay(dateOf(matchedSibling))} tarihli aynı tutardaki çekim sistemde kayıtlı. ${fmtDay(dateOf(twin))} tarihli ikinci çekim ile ${fmtDay(dateOf(r))} tarihli iade birbirini sıfırlıyor.`
        : `${fmtDay(dateOf(twin))} tarihli çekim ${fmtDay(dateOf(r))} tarihinde aynı tutarla iade edilmiş; karta net etkisi 0.`) +
        ' Önerilen: ikisini de girme (daha önce bu tür çiftleri girmemişsin).',
      options: [
        { key: 'skip', label: 'İkisini de girme (net 0)', actions: [] },
        { key: 'both', label: 'İkisini de gir', actions: [
          { type: 'create', draft: purchaseDraft },
          { type: 'create', draft: draftFor(r, rule, { description: `[İade] ${purchaseDraft.description}`, refundOfId: purchaseId, tags: [...(rule?.tags ?? []), refundTag] }) },
        ] },
      ],
      recommended: 0,
      defaultOption: null,
      sideEffects: [],
    })
    handled.add(twin.index)
    handled.add(r.index)
  }

  // 3c) Kalan satırlar
  for (const l of lines) {
    if (handled.has(l.index)) continue
    handled.add(l.index)
    const base = baseRow(l)

    if (l.kind === 'bonus') {
      rows.push({
        ...base, status: 'info', kind: 'bonus', title: l.description, options: [], recommended: null, defaultOption: null, sideEffects: [],
        reason: l.bonus! < 0
          ? 'Bonusla ödenen tutar. Tamamen bonusla ödenen alışveriş girilmez; kısmen ödenende ekstrenin tutar sütunu zaten kalan kısmı gösterir.'
          : 'Kazanılan bonus. Kart borcunu etkilemez.',
      })
      continue
    }

    const m = matchOf.get(l.index)
    if (m) {
      const t = byId.get(m.txIds[0])!
      const pending = m.txIds.some(id => byId.get(id)?.approvalStatus === 'pending')
      const diffMinor = l.installment && m.via !== 'net' ? Math.abs(minor(t.amount) - minor(l.amount!)) : 0
      rows.push({
        ...base,
        status: 'exists',
        kind: l.kind === 'payment' ? 'payment' : l.kind === 'fee' ? 'fee' : l.installment ? 'installment' : l.kind === 'refund' ? 'refund' : 'purchase',
        title: l.kind === 'payment' ? 'Kart ödemesi' : t.description,
        recipientId: t.recipientId ?? undefined,
        recipientName: t.recipientId ? peopleById.get(t.recipientId)?.name : undefined,
        categoryId: t.categoryId,
        match: { txIds: m.txIds, text: describeTx(t) },
        reason: (m.via === 'imported' ? 'Bu satır daha önce içe aktarılmış.'
          : m.via === 'net' ? `Bu alımın bir kısmı taksitli iade edilmiş; sistemde iadesi düşülmüş net tutarla (${fmtTr(t.amount)} ₺) kayıtlı. Tekrar girilmez.`
          : 'Sistemde aynı tutarda, tarihi uyan kayıt bulundu; tekrar girilmez.') +
          (pending ? ' Kayıt "onay bekliyor" durumundaydı; ekstrede görüldüğü için onaylanacak.' : '') +
          (diffMinor ? ` Taksit tutarı bankadakinden ${fmtTr(diffMinor / 100)} ₺ farklı (kuruş yuvarlaması).` : ''),
        note: diffMinor ? `${fmtTr(diffMinor / 100)} ₺ kuruş farkı` : undefined,
        options: [keep], recommended: 0, defaultOption: 0,
        sideEffects: sideEffectsFor(m.txIds, l),
      })
      continue
    }

    if (l.kind === 'payment') {
      // Karta ödeme genelde banka hesabından transfer olarak girilir
      const sources = new Map<string, number>()
      for (const t of accTx) if (t.type === 'transfer' && t.toAccountId === acc) sources.set(t.accountId, (sources.get(t.accountId) ?? 0) + 1)
      const from = [...sources].sort((a, b) => b[1] - a[1])[0]?.[0]
      rows.push({
        ...base, status: 'review', kind: 'payment', title: 'Kart ödemesi',
        issue: 'Ödemenin sistemde karşılığı yok',
        reason: `${fmtDay(dateOf(l))} tarihinde karta ${fmtTr(-l.amount!)} ₺ ödeme yapılmış, ama ±3 gün içinde bu tutarda bir transfer bulunamadı.` +
          ' Ödemeyi hesap dökümünden girecek olsan da burada transfer olarak girebilirsin.',
        options: [
          { key: 'skip', label: 'Girme (hesap dökümünden girilecek)', actions: [] },
          ...(from ? [{ key: 'transfer', label: `Transfer olarak gir: ${accName.get(from)} → kart`, actions: [{ type: 'create' as const, draft: {
            type: 'transfer' as const, amount: -l.amount!, date: dateOf(l), description: 'Kredi Kartı Ödemesi', fromAccountId: from,
            idSeed: seedOf.get(l.index)!, editable: false,
          } }] }] : []),
        ],
        recommended: null, defaultOption: null, sideEffects: [],
      })
      continue
    }

    if (l.kind === 'fee') {
      const label = feeLabel(l.description)
      // Önceki aynı adlı kayıt (önce bu hesapta) alıcı/kategoriyi verir
      const prev = [...accTx, ...live].filter(t => t.type === 'expense' && foldText(t.description) === foldText(label)).sort((a, b) => b.date.localeCompare(a.date))[0]
      const bankCat = input.categories.find(c => c.scope === 'expense' && !c.isArchived && foldText(c.name) === 'banka giderleri')
      const categoryId = prev?.categoryId ?? bankCat?.id
      const recipientId = prev?.recipientId ?? input.people.find(p => p.role === 'recipient' && !p.isArchived && foldText(p.name).includes(st.bank))?.id
      rows.push({
        ...base, status: 'new', kind: 'fee', title: label,
        recipientId, recipientName: recipientId ? peopleById.get(recipientId)?.name : undefined, categoryId,
        reason: `${l.date ? '' : 'Tarihsiz faiz/ücret satırı: kesim tarihine yazılır. '}` +
          (prev ? `Önceki “${label}” kaydın gibi: ${prev.recipientId ? peopleById.get(prev.recipientId)?.name : 'alıcısız'}, ${catPath(categoryId) ?? 'kategorisiz'}.` : `Kategori: ${catPath(categoryId) ?? 'seçilmeli'}.`),
        note: foldText(label).includes('gec odeme') || foldText(label).includes('gecikme') ? 'Son ödeme gününden sonra ödendiği için işlemiş.' : undefined,
        options: [{ key: 'create', label: 'Gir', actions: [{ type: 'create', draft: {
          type: 'expense', amount: l.amount!, date: dateOf(l), description: label, merchant: undefined,
          recipientId: recipientId ?? null, categoryId, idSeed: seedOf.get(l.index)!, editable: true,
        } }] }, skip],
        recommended: 0, defaultOption: 0, sideEffects: [],
      })
      continue
    }

    const rule = rules.ruleFor(l.description, l.bankCategory)
    const rb = ruleBits(rule)
    const title = rule?.description ?? rb.recipientName ?? prettyMerchant(l.description)

    if (l.installment) {
      const inst = l.installment
      const pd = purchaseDateOf(l, st.statementDate)
      // Tek seferde girilmiş taksitli alım (Bluemint 4.600, "Turknet — verilen borç")
      const lump = accTx.find(t => t.accountId === acc && t.type === 'expense' && !t.isInstallment &&
        Math.abs(minor(t.amount) - minor(Math.sign(l.amount!) * inst.total)) <= 5 && dayDiff(t.date, pd) <= 4)
      if (lump) {
        rows.push({
          ...base, ...rb, status: 'exists', kind: 'lump', title: lump.description,
          match: { txIds: [lump.id], text: describeTx(lump) },
          reason: `Bu alımı taksitler yerine tek seferde (${fmtTr(inst.total)} ₺) girmişsin. Taksitleri ayrıca girilmez.`,
          options: [keep], recommended: 0, defaultOption: 0, sideEffects: sideEffectsFor([lump.id]),
        })
        continue
      }
      if (openingDate && pd < openingDate) {
        rows.push({
          ...base, ...rb, status: 'exists', kind: 'opening', title,
          match: { txIds: [], text: `Alım ${fmtDayYear(pd)} · hesabın açılışından (${fmtDayYear(openingDate)}) önce` },
          reason: 'Bu taksit, hesabı açarken girdiğin açılış bakiyesinin içinde. Girilirse iki kez sayılır.',
          options: [keep, { key: 'create', label: 'Yine de gir', actions: [{ type: 'create', draft: draftFor(l, rule) }] }],
          recommended: 0, defaultOption: 0, sideEffects: [],
        })
        continue
      }
      // Aynı sıradaki taksit sistemde farklı tutarla (ör. iadesi düşülmüş net tutar)
      const diffTx = accTx.find(t => !used.has(t.id) && t.type === 'expense' && t.isInstallment && t.installIndex === inst.index &&
        t.installTotal === inst.count && dayDiff(t.date, dateOf(l)) <= 4 &&
        (rule?.recipientId ? t.recipientId === rule.recipientId : true))
      if (diffTx && diffTx.merchant && merchantKey(diffTx.merchant) === merchantKey(l.description)) {
        // Önceki ekstrede iadesiyle birlikte "net" eşleşmiş grubun taksiti
        used.add(diffTx.id)
        rows.push({
          ...base, ...rb, status: 'exists', kind: 'installment', title: diffTx.description,
          match: { txIds: [diffTx.id], text: describeTx(diffTx) },
          reason: `Bu alımın bir kısmı iade edilmiş; sistemde iadesi düşülmüş net tutarla (${fmtTr(diffTx.amount)} ₺) kayıtlı. Önceki ekstrede de böyle eşleşmişti.`,
          options: [keep], recommended: 0, defaultOption: 0, sideEffects: sideEffectsFor([diffTx.id], l),
        })
        continue
      }
      if (diffTx) {
        used.add(diffTx.id)
        rows.push({
          ...base, ...rb, status: 'review', kind: 'amount-diff', title: diffTx.description,
          match: { txIds: [diffTx.id], text: describeTx(diffTx) },
          issue: 'Sistemde farklı tutarla kayıtlı',
          reason: `Ekstrede ${inst.index}/${inst.count}. taksit ${fmtTr(l.amount!)} ₺; sistemdeki aynı taksit ${fmtTr(diffTx.amount)} ₺. ` +
            'Alımın bir kısmını iade edip net tutarı girmiş olabilirsin.',
          options: [
            { key: 'keep', label: 'Sistemdeki tutar doğru', actions: [] },
            { key: 'fix', label: `Ekstredeki tutarla düzelt (${fmtTr(l.amount!)} ₺)`, actions: [{ type: 'patch', txId: diffTx.id, patch: { amount: l.amount! } }] },
          ],
          recommended: null, defaultOption: null, sideEffects: sideEffectsFor([diffTx.id], l),
        })
        continue
      }
      const seed = groupSeedOf.get(l.index)!
      if (l.amount! > 0 && inst.index === 1) {
        const amounts = bankInstallmentAmounts(inst.total, inst.count, l.amount!)
        const draft = draftFor(l, rule, {
          amount: inst.total, date: pd, idSeed: seed,
          installments: { amounts, dates: amounts.map((_, i) => addMonthsIso(pd, i)) },
        })
        const isNew = !rule?.recipientId
        const guess = !isNew && rule?.confidence === 'maybe'
        if (guess) {
          rows.push({
            ...base, ...rb, status: 'review', kind: 'installment-new', title,
            issue: `Alıcı “${rb.recipientName}” mı? · yeni taksitli alım`,
            reason: `Yeni taksitli alım: ${inst.count} taksit oluşturulur (toplam ${fmtTr(inst.total)} ₺). ${ruleReason(l, rule)}`,
            options: guessOptions(draft, rb.recipientName!, l),
            recommended: 0, defaultOption: null, sideEffects: [],
          })
          continue
        }
        rows.push({
          ...base, ...rb, status: isNew ? 'review' : 'new', kind: 'installment-new', title,
          newRecipient: isNew,
          issue: isNew ? 'Yeni alıcı · yeni taksitli alım' : undefined,
          reason: `Yeni taksitli alım: ${inst.count} taksit oluşturulur (toplam ${fmtTr(inst.total)} ₺; bankanın bölüşümüyle ilk taksit ${fmtTr(amounts[0])} ₺, diğerleri ${fmtTr(amounts[1] ?? amounts[0])} ₺). ` +
            (isNew ? `Bu işyeri daha önce hiç geçmemiş; önerilen yeni alıcı “${prettyMerchant(l.description)}”.` : ruleReason(l, rule)),
          options: isNew
            ? [{ key: 'create-new', label: 'Yeni alıcıyla gir', actions: [{ type: 'create', draft: { ...draft, newRecipient: prettyMerchant(l.description), description: draft.description } }] },
               { key: 'create', label: 'Alıcısız gir', actions: [{ type: 'create', draft }] }, skip,
               // Sonda: kayıtlı kararlar seçenek sırasıyla tutulur, eski indeksler kaymasın
               { key: 'create-existing', label: 'Var olan alıcıyla gir', actions: [{ type: 'create', draft: { ...draft, needsRecipient: true } }] }]
            : [{ key: 'create', label: 'Gir', actions: [{ type: 'create', draft }] }, skip],
          recommended: 0, defaultOption: isNew ? null : 0, sideEffects: [],
        })
        continue
      }
      // Grubun önceki taksitleri sistemde yok: tüm grubu oluşturmak önerilir
      if (l.amount! > 0) {
        const amounts = bankInstallmentAmounts(inst.total, inst.count, inst.index === 1 ? l.amount! : toMajor(minor(inst.total) - (inst.count - 1) * minor(l.amount!)))
        const draftAll = draftFor(l, rule, {
          amount: inst.total, date: pd, idSeed: seed,
          installments: { amounts, dates: amounts.map((_, i) => addMonthsIso(pd, i)) },
        })
        rows.push({
          ...base, ...rb, status: 'review', kind: 'installment-missing', title,
          issue: 'Taksitli alımın önceki taksitleri sistemde yok',
          reason: `${fmtDayYear(pd)} tarihli ${fmtTr(inst.total)} ₺'lik ${inst.count} taksitli alımın ${inst.index}. taksiti; sistemde bu alıma ait kayıt bulunamadı. ` +
            `Önerilen: alımı ${inst.count} taksitiyle birlikte gir (geçmiş taksitler kendi tarihlerine yazılır).`,
          options: [
            { key: 'create-all', label: `Tüm taksitleri gir (${inst.count})`, actions: [{ type: 'create', draft: draftAll }] },
            { key: 'create-one', label: 'Yalnız bu taksiti gir', actions: [{ type: 'create', draft: draftFor(l, rule) }] },
            skip,
          ],
          recommended: 0, defaultOption: null, sideEffects: [],
        })
        continue
      }
      // Eşleşmemiş tek taksit iadesi (kümeye girmeyen) → tek iade satırı
      rows.push({
        ...base, ...rb, status: 'review', kind: 'refund', title: `[İade] ${title}`,
        issue: 'Taksitli iadenin karşılığı yok',
        reason: `${inst.count} taksitli bir iadenin ${inst.index}. taksiti; sistemde karşılığı bulunamadı.`,
        options: [
          { key: 'create', label: 'İade olarak gir', actions: [{ type: 'create', draft: draftFor(l, rule, { description: `[İade] ${title}`, tags: [...(rule?.tags ?? []), refundTag] }) }] },
          skip,
        ],
        recommended: 0, defaultOption: null, sideEffects: [],
      })
      continue
    }

    let asIncome = l.kind === 'refund' ? incomeByKey.get(creditKey(l.description)) : undefined
    let learnedIncome = !!asIncome?.length
    // Öğrenilmemiş indirim satırı: bu kartta en sık girilen gelir biçimi önerilir (karar sorulur)
    if (!asIncome?.length && l.kind === 'refund' && /\b(indirim|alsv ind|cashback)\b|kampanya/.test(foldText(l.description))) {
      // Gelir olarak girilmiş kart ödemeleri öneri olamaz: bu ekstrede ödeme satırıyla
      // eşleşenler ve kategorisiz olanlar ("Kredi Kartı Ödemesi" geliri) sayılmaz
      const paymentTx = new Set<string>()
      for (const [idx, m] of matchOf) if (lineByIdx.get(idx)?.kind === 'payment') m.txIds.forEach(id => paymentTx.add(id))
      const incomes = accTx.filter(t => t.type === 'income' && t.accountId === acc && !t.workspaceTransferId && !!t.categoryId && !paymentTx.has(t.id))
      const tally = new Map<string, Transaction[]>()
      for (const t of incomes) { const k = `${t.description}|${t.recipientId ?? ''}|${t.categoryId ?? ''}`; tally.set(k, [...(tally.get(k) ?? []), t]) }
      asIncome = [...tally.values()].sort((a, b) => b.length - a.length)[0]
      learnedIncome = false
    }
    if (asIncome?.length) {
      const last = asIncome.slice().sort((a, b) => b.date.localeCompare(a.date))[0]
      const draft: DraftTx = {
        type: 'income', amount: -l.amount!, date: dateOf(l), description: last.description, merchant: merchantLabel(l.description),
        recipientId: last.recipientId ?? null, categoryId: last.categoryId ?? undefined, idSeed: seedOf.get(l.index)!, editable: true,
      }
      rows.push({
        ...base, status: learnedIncome ? 'new' : 'review', kind: 'income', title: last.description,
        recipientId: last.recipientId ?? undefined, recipientName: last.recipientId ? peopleById.get(last.recipientId)?.name : undefined, categoryId: last.categoryId ?? undefined,
        issue: learnedIncome ? undefined : 'İndirim satırı',
        reason: learnedIncome
          ? `Bu karttaki ${asIncome.length} benzer alacak satırı “${last.description}” geliri olarak girilmiş; bu da öyle girilir.`
          : `İndirim satırı. Bu kartta alacakları genelde “${last.description}” geliri olarak giriyorsun (${asIncome.length} kayıt); öyle önerildi. Seçimin öğrenilir.`,
        options: [{ key: 'income', label: 'Gelir olarak gir', actions: [{ type: 'create', draft }] }, { key: 'standalone', label: 'İade olarak gir', actions: [{ type: 'create', draft: draftFor(l, rule, { description: `[İade] ${title}`, tags: [...(rule?.tags ?? []), refundTag] }) }] }, skip],
        recommended: 0, defaultOption: learnedIncome ? 0 : null, sideEffects: [],
      })
      continue
    }

    if (l.kind === 'refund') {
      const key = merchantKey(l.description)
      const origins = accTx.filter(t => t.accountId === acc && t.type === 'expense' && t.amount > 0 &&
        dayNum(t.date) <= dayNum(dateOf(l)) && dayNum(dateOf(l)) - dayNum(t.date) <= 180 &&
        ((t.merchant && merchantKey(t.merchant) === key) || (rule?.recipientId && t.recipientId === rule.recipientId)) &&
        minor(t.amount) >= -minor(l.amount!))
      const exact = origins.filter(t => minor(t.amount) === -minor(l.amount!)).sort((a, b) => b.date.localeCompare(a.date))[0]
      const standalone = draftFor(l, rule, { description: `[İade] ${title}`, tags: [...(rule?.tags ?? []), refundTag] })
      const options: RowOption[] = []
      if (exact) options.push({ key: 'link', label: `İade olarak gir, ${fmtDay(exact.date)} alımına bağla`, actions: [{ type: 'create', draft: {
        ...standalone, description: `[İade] ${exact.description}`, recipientId: exact.recipientId ?? null, categoryId: exact.categoryId,
        familyMemberId: exact.familyMemberId ?? null, refundOfId: exact.id, tags: [...(exact.tags ?? []).filter(x => x !== refundTag), refundTag],
      } }] })
      options.push({ key: 'standalone', label: 'Bağımsız iade olarak gir', actions: [{ type: 'create', draft: standalone }] }, skip)
      rows.push({
        ...base, ...rb, status: 'review', kind: 'refund', title: `[İade] ${exact?.description ?? title}`,
        match: exact ? { txIds: [exact.id], text: describeTx(exact) } : undefined,
        issue: exact ? 'İade — asıl alım bulundu' : 'İadenin alımı bulunamadı',
        reason: exact
          ? `${fmtTr(-l.amount!)} ₺ iade; ${fmtDay(exact.date)} tarihli aynı tutardaki alımın iadesi görünüyor. Önerilen: “[İade] …” olarak, alıma bağlı gir.`
          : `${fmtTr(-l.amount!)} ₺ iade. Son 180 günde bu işyerinden aynı tutarda alım yok (parça iadesi olabilir). Önerilen: bağımsız iade olarak gir.`,
        options, recommended: 0, defaultOption: null, sideEffects: [],
      })
      continue
    }

    // Tek çekim harcama
    const near = accTx.find(t => !used.has(t.id) && t.accountId === acc && t.type === 'expense' && !t.isInstallment &&
      minor(t.amount) === minor(l.amount!) && dayDiff(t.date, dateOf(l)) <= 10)
    const draft = draftFor(l, rule)
    if (near) {
      used.add(near.id)
      rows.push({
        ...base, ...rb, status: 'review', kind: 'possible-dup', title,
        match: { txIds: [near.id], text: describeTx(near) },
        issue: 'Olası mükerrer',
        reason: `Sistemde ${dayDiff(near.date, dateOf(l))} gün arayla aynı tutarda bir kayıt var. Aynı harcama olabilir.`,
        options: [
          { key: 'keep', label: 'Atla, zaten var', actions: [] },
          { key: 'create', label: 'Yine de gir', actions: [{ type: 'create', draft }] },
        ],
        recommended: 0, defaultOption: null, sideEffects: sideEffectsFor([near.id], l),
      })
      continue
    }
    if (rule?.recipientId && rule.confidence === 'maybe') {
      rows.push({
        ...base, ...rb, status: 'review', kind: 'purchase', title,
        issue: `Alıcı “${rb.recipientName}” mı?`,
        reason: `${ruleReason(l, rule)} Onaylarsan bir dahaki ekstrede kendiliğinden tanınır.`,
        options: guessOptions(draft, rb.recipientName!, l),
        recommended: 0, defaultOption: null, sideEffects: [],
      })
      continue
    }
    if (!rule?.recipientId) {
      const suggested = prettyMerchant(l.description)
      rows.push({
        ...base, ...rb, status: 'review', kind: 'unknown', title: suggested, newRecipient: true,
        recipientName: suggested,
        issue: 'Yeni alıcı',
        reason: `Bu işyeri daha önce hiç geçmemiş. Önerilen yeni alıcı: “${suggested}”${rb.categoryId ? `, kategori ${catPath(rb.categoryId)}${rule?.categoryFrom === 'bank' ? ` (bankanın “${l.bankCategory}” etiketinden)` : ''}` : '; kategori seçmen gerekiyor'}. Onaylarsan bir dahaki ekstrede kendiliğinden tanınır.`,
        options: [
          { key: 'create-new', label: 'Yeni alıcıyla gir', actions: [{ type: 'create', draft: { ...draft, newRecipient: suggested, description: suggested } }] },
          { key: 'create', label: 'Alıcısız gir', actions: [{ type: 'create', draft: { ...draft, description: suggested } }] },
          skip,
          // Sonda: kayıtlı kararlar seçenek sırasıyla tutulur, eski indeksler kaymasın
          { key: 'create-existing', label: 'Var olan alıcıyla gir', actions: [{ type: 'create', draft: { ...draft, description: suggested, needsRecipient: true } }] },
        ],
        recommended: 0, defaultOption: null, sideEffects: [],
      })
      continue
    }
    rows.push({
      ...base, ...rb, status: 'new', kind: 'purchase', title,
      reason: ruleReason(l, rule) + (rule.description === rb.recipientName && rule.source === 'history' ? ' Açıklamaya genelde ürün/restoran adını yazıyorsun; banka bunu vermediği için alıcının adı yazıldı.' : ''),
      options: [{ key: 'create', label: 'Gir', actions: [{ type: 'create', draft }] }, skip],
      recommended: 0, defaultOption: 0, sideEffects: [],
    })
  }

  // ── 4) Ters kontrol: dönem içinde sistemde var, ekstrede yok ──
  const covered = new Set<string>(used)
  for (const r of rows) for (const id of r.match?.txIds ?? []) covered.add(id)
  const bonusLines = lines.filter(l => l.kind === 'bonus' && (l.bonus ?? 0) < 0)
  for (const t of accTx) {
    if (covered.has(t.id) || t.accountId !== acc || t.type !== 'expense') continue
    // Kesim günündeki işlem sonraki ekstreye de kalabilir (banka kesimi gün içinde yapar)
    if (t.date < periodStart || t.date >= st.statementDate) continue
    if (t.isInstallment && (t.installIndex ?? 1) > 1) continue   // sonraki ekstrelerde faturalanır
    if (t.systemKind || t.icon || t.workspaceTransferId) continue
    const bonusPaid = bonusLines.find(b => b.date && dayDiff(b.date, t.date) <= 1 && minor(-(b.bonus ?? 0)) === minor(t.amount))
    const safeDelete = !t.debtId && !t.debtPrincipalId && !t.refundOfId && !t.isInstallment
    rows.push({
      key: `O${t.id}`, lines: [], status: 'review', kind: 'orphan', date: t.date, amount: t.amount, bonus: null,
      title: t.description, raw: bonusPaid ? `Ekstrede karşılığı yok · aynı gün ${fmtTr(t.amount)} ₺ bonusla ödenmiş` : 'Ekstrede karşılığı yok',
      recipientId: t.recipientId ?? undefined, recipientName: t.recipientId ? peopleById.get(t.recipientId)?.name : undefined, categoryId: t.categoryId,
      match: { txIds: [t.id], text: describeTx(t) },
      issue: 'Sistemde var, ekstrede yok',
      reason: bonusPaid
        ? `Bu kayıt kartta duruyor ama ekstrede karşılığı yok. Aynı gün ${fmtTr(t.amount)} ₺ tamamen bonusla ödenmiş görünüyor; kuralına göre bonusla ödenen alışveriş girilmez.`
        : 'Bu kayıt kartta, ekstre dönemi içinde duruyor ama ekstrede karşılığı yok. Tutarı ya da kartı yanlış girilmiş olabilir.',
      options: safeDelete ? [keep, { key: 'delete', label: 'Sistemden sil', actions: [{ type: 'delete', txIds: [t.id] }] }] : [keep],
      recommended: bonusPaid && safeDelete ? 1 : null,
      defaultOption: null, sideEffects: [],
    })
  }

  // ── 5) Sabit anahtar, önceki "girme" kararları, ters kontrol ipuçları ──
  const finalRows: PlanRow[] = rows.map(r => {
    const stableKey = r.lines.length ? r.lines.map(i => seedOf.get(i) ?? `i${i}`).join('+') : `orphan:${r.match?.txIds[0] ?? r.key}`
    const row: PlanRow = { ...r, stableKey }
    if (r.kind === 'orphan') {
      const twin = rows.find(x => x !== r && (x.status === 'new' || x.status === 'review') && x.kind !== 'orphan' && x.amount !== null &&
        x.recipientId && x.recipientId === r.recipientId && dayDiff(x.date, r.date) <= 1)
      if (twin) row.reason += ` Aynı gün aynı alıcıdan ekstrede ${fmtTr(twin.amount!)} ₺ var (“${twin.raw}”); tutar yanlış girilmiş olabilir.`
    }
    if (input.skipped?.has(stableKey) && (r.status === 'review' || r.status === 'new')) {
      return {
        ...row, status: 'exists', issue: undefined,
        reason: 'Bu satırı daha önceki bir yüklemede girmemeyi seçtin. ' + r.reason,
        options: [{ key: 'keep', label: 'Girme (önceki kararın)', actions: [] }, ...r.options.filter(o => o.actions.length > 0)],
        recommended: 0, defaultOption: 0,
      }
    }
    return row
  })

  const totalLines = lines.filter(l => l.amount !== null).length
  return { rows: finalRows, blockers, periodStart, openingDate, matchedLines: matchOf.size, totalLines }
}
