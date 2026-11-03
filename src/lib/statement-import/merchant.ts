import { foldText, keywordCategory, recipientCategory } from '@/lib/auto-category'
import type { Category, Person, Transaction } from '@/types'

/* ── Banka işyeri adı → alıcı / kategori öğrenimi ─────────────────────────────
   Banka işyerini kendi biçiminde yazar ("YEMEKPAY *Y. RESTORAN"); kullanıcı
   aynı harcamayı platformun alıcısıyla (Yemeksepeti) ve kendi açıklamasıyla
   ("Dilay Ocakbaşı") girer. Eşleşme hafızası ayrı bir tabloda değil, işlemin
   kendisinde durur: içe aktarılan ya da ekstreyle eşleşen her işleme bankanın
   yazdığı ad `merchant` alanına yazılır (eşitlenir, yedeğe girer). Kural her
   seferinde bu geçmişten yeniden çıkarılır — kullanıcı sonradan bir işlemin
   alıcısını değiştirirse sonraki ekstre bunu kendiliğinden görür.

   Öncelik: 1) aynı işyeri adıyla geçmiş işlemler  2) adı işyeri metninde geçen
   alıcı (onun geçmişteki kategorisiyle)  3) kategori anahtar kelime kuralı. */

/** Karşılaştırma anahtarı: Türkçe harfler katlanır, taksit eki ve fazla boşluk atılır. */
export function merchantKey(description: string): string {
  return foldText(description.replace(/\(\d+\/\d+\)/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** İşlemin `merchant` alanına yazılan biçim (bankanın metni, boşluklar tekil). */
export function merchantLabel(description: string): string {
  return description.replace(/\(\d+\/\d+\)/g, ' ').replace(/\s+/g, ' ').trim()
}

const alnum = (s: string) => foldText(s).replace(/[^a-z0-9]/g, '')

// Ödeme aracısı önekleri: asıl işyeri arkadan gelir ("IYZICO *AMAZON.COM.T")
const GATEWAY_RE = /^(iyzico|paytr odeme|hepsipay-hep|mokaunited|tami-odeme|yemekpay|parati|garantipay|param|papara|sipay|craftgate)\s*[*/]\s*/i

/** Büyük harfli banka metnini kelime kelime "Baş Harf" biçimine çevirir. Bankalar
 *  marka adlarında ASCII "I" kullanır (IKEA, IYZICO): "I" → "i" sayılır; "İ" ile
 *  başlayan kelime "İ" ile başlar. Kullanıcı adı onay ekranında düzeltebilir. */
function titleCase(s: string): string {
  return s.split(' ').map(w => {
    if (!w) return w
    const lower = w.replace(/İ/g, 'i').toLowerCase()
    const first = w[0] === 'İ' ? 'İ' : lower[0].toUpperCase()
    return first + lower.slice(1)
  }).join(' ')
}

/** Yeni alıcı için okunur ad: "PAYTR ODEME /AROASTINGLAB" → "Aroastinglab",
 *  "WWW.İDEFİX.COM" → "İdefix", "İDDAALI BÜFE TEKEL" → "İddaali Büfe Tekel". */
export function prettyMerchant(description: string): string {
  let s = merchantLabel(description)
  const gw = foldText(s).match(GATEWAY_RE)
  if (gw) s = s.slice(gw[0].length)
  s = s.replace(/^www\./i, '').replace(/\.(com|net|org)(\.tr)?\b.*$/i, '').replace(/\s*\d{5,}.*$/, '')
  s = s.replace(/[*/]+/g, ' ').replace(/\s+/g, ' ').trim()
  // Sondaki il plakası, şehir ve ülke kodu: "BITAKSI 34 TR" → "Bitaksi", "UBER EATS İSTANBUL TRTR" → "Uber Eats"
  const words = s.split(' ')
  while (words.length > 1 && /^(\d{1,3}|tr|tu|trtr|tur|istanbul|stanbul|ankara|izmir)$/.test(foldText(words[words.length - 1]))) words.pop()
  s = words.join(' ')
  return titleCase(s) || description.trim()
}

/** Ad, metinde kelime olarak geçiyor mu: "Yemeksepeti" ⊂ "YEMEKPAY /YEMEKSEPETI",
 *  "Selman Malkoç" ⊂ "Mehmet Selman Malkoç"; ama "Aksi" ⊄ "BITAKSI". Bitişik
 *  yazılmış iki kelime de tutar ("YEMEK SEPETI" = "Yemeksepeti"). */
export function nameInText(name: string, text: string): boolean {
  const words = (s: string) => foldText(s).split(/[^a-z0-9]+/).filter(Boolean)
  const n = words(name), t = words(text)
  const joined = n.join('')
  if (joined.length < 4 || !t.length) return false
  for (let i = 0; i < t.length; i++) {
    if (n.length > 1 && n.every((w, k) => t[i + k] === w)) return true
    let acc = ''
    for (let k = i; k < Math.min(t.length, i + 3); k++) {
      acc += t[k]
      if (acc === joined) return true
      if (acc.length >= joined.length) break
    }
  }
  return false
}

export interface MerchantRule {
  recipientId?: string
  categoryId?: string
  /** Bu işyerinde kategori hep aynıysa true; değişkense en sık olan önerilir */
  categorySure: boolean
  /** Açıklama hep aynıysa o; değilse alıcının adı */
  description?: string
  familyMemberId?: string
  tags?: string[]
  /** Kuralı besleyen işlem sayısı */
  count: number
  source: 'history' | 'recipient' | 'keyword'
}

type Tx = Pick<Transaction, 'id' | 'type' | 'amount' | 'date' | 'description' | 'merchant' | 'recipientId' | 'categoryId' | 'familyMemberId' | 'tags' | 'deleted_at'>

function mode<T>(values: readonly (T | undefined | null)[], dates: readonly string[]): T | undefined {
  const tally = new Map<T, { n: number; last: string }>()
  values.forEach((v, i) => {
    if (v === undefined || v === null) return
    const t = tally.get(v)
    if (t) { t.n++; if (dates[i] > t.last) t.last = dates[i] }
    else tally.set(v, { n: 1, last: dates[i] })
  })
  let best: [T, { n: number; last: string }] | undefined
  for (const e of tally) if (!best || e[1].n > best[1].n || (e[1].n === best[1].n && e[1].last > best[1].last)) best = e
  return best?.[0]
}

const allSame = <T,>(values: readonly (T | undefined | null)[]) => values.length > 0 && values.every(v => v === values[0])

/** Harcama geçmişinden bir kural çıkarır (iade/transfer sayılmaz). */
/** Alıcı + kategori çiftinde kullanıcının hep aynı açıklamayı yazdığı durum
 *  (iTC + HGS → "HGS"); en az iki kayıt ve tek açıklama gerekir. */
function pairDescription(all: readonly Tx[], recipientId?: string, categoryId?: string): string | undefined {
  if (!recipientId || !categoryId) return undefined
  const descs = all.filter(t => t.recipientId === recipientId && t.categoryId === categoryId && t.type === 'expense' && t.amount > 0 && !t.deleted_at).map(t => t.description)
  return descs.length >= 2 && allSame(descs) ? descs[0] : undefined
}

function ruleFromHistory(txs: readonly Tx[], people: ReadonlyMap<string, Person>, refundTag: string, all: readonly Tx[]): MerchantRule | undefined {
  const rows = txs.filter(t => t.type === 'expense' && t.amount > 0 && !t.deleted_at)
  if (!rows.length) return undefined
  const dates = rows.map(t => t.date)
  const recipientId = mode(rows.map(t => t.recipientId ?? undefined), dates)
  const categoryId = mode(rows.map(t => t.categoryId ?? undefined), dates)
  const descs = rows.map(t => t.description)
  const recipientName = recipientId ? people.get(recipientId)?.name : undefined
  const tagLists = rows.map(t => (t.tags ?? []).filter(x => foldText(x).replace('#', '') !== foldText(refundTag).replace('#', '')))
  const tags = rows.length >= 2 ? tagLists.reduce<string[]>((acc, l, i) => (i === 0 ? [...l] : acc.filter(x => l.includes(x))), []) : []
  const fam = rows.map(t => t.familyMemberId ?? undefined)
  return {
    recipientId,
    categoryId,
    categorySure: allSame(rows.map(t => t.categoryId ?? undefined)),
    // Tek kayıttan genelleme yapılmaz: bir kez "Meross Akıllı Priz" yazılan
    // işyerinin her alımı o ürün değildir
    description: rows.length >= 2 && allSame(descs) ? descs[0] : (pairDescription(all, recipientId, categoryId) ?? recipientName),
    familyMemberId: rows.length >= 2 && allSame(fam) && fam[0] ? fam[0] : undefined,
    tags: tags.length ? tags : undefined,
    count: rows.length,
    source: 'history',
  }
}

export interface RuleBook {
  ruleFor(description: string): MerchantRule | undefined
}

/** Kural kitabı. `extra`: bu ekstrede eşleşen (henüz merchant'ı yazılmamış)
 *  satır–işlem çiftleri — ilk yüklemede de geçmişten öğrenilebilsin diye. */
export function buildRuleBook(opts: {
  transactions: readonly Tx[]
  extra?: readonly { description: string; tx: Tx }[]
  people: readonly Person[]
  categories: readonly Category[]
  refundTag: string
}): RuleBook {
  const byKey = new Map<string, Tx[]>()
  const push = (key: string, tx: Tx) => {
    const list = byKey.get(key)
    if (list) { if (!list.some(t => t.id === tx.id)) list.push(tx) } else byKey.set(key, [tx])
  }
  for (const t of opts.transactions) if (t.merchant && !t.deleted_at) push(merchantKey(t.merchant), t)
  for (const e of opts.extra ?? []) push(merchantKey(e.description), e.tx)

  const peopleById = new Map(opts.people.map(p => [p.id, p]))
  const recipients = opts.people
    .filter(p => p.role === 'recipient' && !p.isArchived && !p.deleted_at)
    .map(p => ({ p, key: alnum(p.name) }))
    .filter(r => r.key.length >= 4)
    .sort((a, b) => b.key.length - a.key.length)

  return {
    ruleFor(description) {
      const hist = byKey.get(merchantKey(description))
      const fromHist = hist ? ruleFromHistory(hist, peopleById, opts.refundTag, opts.transactions) : undefined
      if (fromHist) return fromHist

      const hit = recipients.find(r => nameInText(r.p.name, description))
      if (hit) {
        const own = opts.transactions.filter(t => t.recipientId === hit.p.id && t.type === 'expense' && t.amount > 0 && !t.deleted_at)
        const categoryId = recipientCategory(hit.p.id, 'expense', own as Transaction[], opts.categories as Category[])
        return {
          recipientId: hit.p.id,
          categoryId,
          categorySure: !!categoryId && allSame(own.map(t => t.categoryId ?? undefined)),
          description: pairDescription(opts.transactions, hit.p.id, categoryId) ?? hit.p.name,
          count: own.length,
          source: 'recipient',
        }
      }

      const categoryId = keywordCategory(description, 'expense', opts.categories as Category[])
      if (categoryId) return { categoryId, categorySure: false, count: 0, source: 'keyword' }
      return undefined
    },
  }
}
