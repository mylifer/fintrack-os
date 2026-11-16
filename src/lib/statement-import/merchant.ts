import { foldText, keywordCategory, recipientCategory } from '@/lib/auto-category'
import type { Category, Person, Transaction } from '@/types'
import { SUBSCRIPTION_TAG, isSubscriptionTag } from '@/lib/subscriptions/brands'
import { brandOf, GATEWAY_RE, MAYBE, merchantCore, nameScore, sameCore, SURE } from './merchant-match'

/* ── Banka işyeri adı → alıcı / kategori öğrenimi ─────────────────────────────
   Banka işyerini kendi biçiminde yazar ("YEMEKPAY *Y. RESTORAN"); kullanıcı
   aynı harcamayı platformun alıcısıyla (Yemeksepeti) ve kendi açıklamasıyla
   ("Dilay Ocakbaşı") girer. Eşleşme hafızası ayrı bir tabloda değil, işlemin
   kendisinde durur: içe aktarılan ya da ekstreyle eşleşen her işleme bankanın
   yazdığı ad `merchant` alanına yazılır (eşitlenir, yedeğe girer). Kural her
   seferinde bu geçmişten yeniden çıkarılır — kullanıcı sonradan bir işlemin
   alıcısını değiştirirse sonraki ekstre bunu kendiliğinden görür.

   Öncelik (alıcı):
     1) aynı işyeri adıyla geçmiş işlemler (birebir, sonra bankadan bankaya
        yazım farkıyla: "ÖZEL DURU VETERİNERL" = "OZEL DURU VETERINERL ISTANBUL")
     2) adı işyeri metninde geçen alıcı — kesik/bitişik yazıma toleranslı
        ("Yemeksepeti" ~ "YEMEKSEPETIPAY/YEMEKSEPISTANBUL")
     3) aynı markanın geçmişi ("IKEA-KARTAL" → IKEA-ÜMRANİYE alımlarının alıcısı)
   Emin olunamayan benzerlik `confidence: 'maybe'` döner: önerilir ama sorulur.
   Kategori: alıcının geçmişi > bankanın kendi kategorisi (Garanti "Etiket")
   > anahtar kelime kuralı. */

/** Karşılaştırma anahtarı: Türkçe harfler katlanır, taksit eki ve fazla boşluk atılır. */
export function merchantKey(description: string): string {
  return foldText(description.replace(/\(\d+\/\d+\)/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** İşlemin `merchant` alanına yazılan biçim (bankanın metni, boşluklar tekil). */
export function merchantLabel(description: string): string {
  return description.replace(/\(\d+\/\d+\)/g, ' ').replace(/\s+/g, ' ').trim()
}

const alnum = (s: string) => foldText(s).replace(/[^a-z0-9]/g, '')


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
  while (words.length > 1 && /^(\d{1,3}|tr|tu|trtr|istanbul|stanbul|ankara|izmir)$/.test(foldText(words[words.length - 1]))) words.pop()
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
  source: 'history' | 'recipient' | 'brand' | 'keyword' | 'bank'
  /** sure: doğrudan uygulanır · maybe: önerilir, kullanıcıya sorulur */
  confidence: 'sure' | 'maybe'
  /** Eşleşmenin dayandığı metin (geçmişteki işyeri adı ya da marka) */
  via?: string
  /** Kategori nereden: alıcı geçmişi, bankanın kategorisi, anahtar kelime */
  categoryFrom?: 'history' | 'bank' | 'keyword'
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

/** Banka ücreti kaydı (faiz, BSMV, KKDF, aidat …): işyeri değil, bankanın
 *  kestiği masraf. Ekstrenin faiz satırları işyeri adı (`merchant`) taşımaz. */
const BANK_CHARGE_RE = /\b(faiz|bsmv|kkdf|ucret|komisyon|aidat|gecikme|kar payi)/
export function isBankCharge(t: Pick<Tx, 'merchant' | 'description'>): boolean {
  return !t.merchant && BANK_CHARGE_RE.test(foldText(t.description))
}

/** Banka masrafı kategorisi ("Banka Giderleri"). Bir işyerindeki alım ya da
 *  iadesi bu kategoriye öğrenilmez: kartı veren şirketin adı alıcı olarak
 *  işyeriyle aynı olabilir (Getir kartının faizleri "Getir" alıcısında) ve
 *  bu masraflar o işyerinin alışverişlerini Banka Giderleri'ne çekerdi. */
export function isBankChargeCategory(c: Pick<Category, 'name'>): boolean {
  return foldText(c.name) === 'banka giderleri'
}

function ruleFromHistory(txs: readonly Tx[], people: ReadonlyMap<string, Person>, refundTag: string, all: readonly Tx[], skipCategory: (id: string) => boolean): MerchantRule | undefined {
  const rows = txs.filter(t => t.type === 'expense' && t.amount > 0 && !t.deleted_at && !isBankCharge(t))
  if (!rows.length) return undefined
  const dates = rows.map(t => t.date)
  const recipientId = mode(rows.map(t => t.recipientId ?? undefined), dates)
  const cats = rows.map(t => (t.categoryId && !skipCategory(t.categoryId) ? t.categoryId : undefined))
  const categoryId = mode(cats, dates)
  const descs = rows.map(t => t.description)
  const recipientName = recipientId ? people.get(recipientId)?.name : undefined
  const tagLists = rows.map(t => (t.tags ?? []).filter(x => foldText(x).replace('#', '') !== foldText(refundTag).replace('#', '')))
  const common = rows.length >= 2 ? tagLists.reduce<string[]>((acc, l, i) => (i === 0 ? [...l] : acc.filter(x => l.includes(x))), []) : []
  // Abonelik her ay tekrarlanır: tek kayıttan da öğrenilir. Son kayıt belirler —
  // bir kez işaretlenince sonraki ay da abonelik gelir; işaret kaldırılınca gelmez.
  const latest = tagLists[rows.reduce((bi, t, i) => (t.date >= rows[bi].date ? i : bi), 0)]
  const tags = [...common.filter(x => !isSubscriptionTag(x)), ...(latest.some(isSubscriptionTag) ? [SUBSCRIPTION_TAG] : [])]
  const fam = rows.map(t => t.familyMemberId ?? undefined)
  return {
    recipientId,
    categoryId,
    categorySure: !!categoryId && allSame(cats),
    // Tek kayıttan genelleme yapılmaz: bir kez "Meross Akıllı Priz" yazılan
    // işyerinin her alımı o ürün değildir
    description: rows.length >= 2 && allSame(descs) ? descs[0] : (pairDescription(all, recipientId, categoryId) ?? recipientName),
    familyMemberId: rows.length >= 2 && allSame(fam) && fam[0] ? fam[0] : undefined,
    tags: tags.length ? tags : undefined,
    count: rows.length,
    source: 'history',
    confidence: 'sure',
    categoryFrom: categoryId ? 'history' : undefined,
  }
}

export interface RuleBook {
  /** `bankCategory`: bankanın satıra yazdığı kategori ("Market", "Yeme / İçme") */
  ruleFor(description: string, bankCategory?: string | null): MerchantRule | undefined
  /** Yeni alıcı önerilecek işyeri için adı benzeyen kayıtlı alıcılar (en benzeri
   *  önce): kullanıcı kopya alıcı açmadan önce bunları seçebilsin. */
  similar(description: string, limit?: number): Person[]
}

/** Bu puanın üstündeki alıcılar "benzer alıcı" olarak seçenek listesine girer. */
const SIMILAR = 0.5

/** 3 harfli alıcı adı ("BİM", "ŞOK") yalnız işyeri metninin ilk kelimesiyle birebir tutar. */
function shortNameMatch(key: string, description: string): boolean {
  return key.length === 3 && merchantCore(description).tokens[0] === key
}

/** Kural kitabı. `extra`: bu ekstrede eşleşen (henüz merchant'ı yazılmamış)
 *  satır–işlem çiftleri — ilk yüklemede de geçmişten öğrenilebilsin diye. */
export function buildRuleBook(opts: {
  transactions: readonly Tx[]
  extra?: readonly { description: string; tx: Tx }[]
  people: readonly Person[]
  categories: readonly Category[]
  refundTag: string
  /** Bankanın kategori etiketi → kullanıcının kategorisi */
  bankCategory?: (label: string) => string | undefined
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
    .filter(r => r.key.length >= 3)
    .sort((a, b) => b.key.length - a.key.length)

  // Marka → o markanın geçmiş harcamaları ("ikea" → IKEA-KARTAL, IKEA-ÜMRANİYE …)
  const byBrand = new Map<string, { keys: Set<string>; txs: Tx[] }>()
  for (const [key, txs] of byKey) {
    const b = brandOf(key)
    if (!b) continue
    const e = byBrand.get(b) ?? { keys: new Set<string>(), txs: [] }
    e.keys.add(key)
    for (const t of txs) if (!e.txs.some(x => x.id === t.id)) e.txs.push(t)
    byBrand.set(b, e)
  }
  const keys = [...byKey.keys()]

  const chargeCats = new Set(opts.categories.filter(isBankChargeCategory).map(c => c.id))
  const skipCategory = (id: string) => chargeCats.has(id)
  const fromHistory = (txs: readonly Tx[]) => ruleFromHistory(txs, peopleById, opts.refundTag, opts.transactions, skipCategory)

  const recipientRule = (p: Person, confidence: MerchantRule['confidence']): MerchantRule => {
    // Alıcıya kesilen banka masrafları (kartı veren şirketse) işyeri alımının kategorisini belirlemez
    const own = opts.transactions.filter(t => t.recipientId === p.id && t.type === 'expense' && t.amount > 0 && !t.deleted_at &&
      !isBankCharge(t) && !(t.categoryId && skipCategory(t.categoryId)))
    const categoryId = recipientCategory(p.id, 'expense', own as Transaction[], opts.categories as Category[])
    return {
      recipientId: p.id,
      categoryId,
      categorySure: !!categoryId && allSame(own.map(t => t.categoryId ?? undefined)),
      description: pairDescription(opts.transactions, p.id, categoryId) ?? p.name,
      count: own.length,
      source: 'recipient',
      confidence,
      categoryFrom: categoryId ? 'history' : undefined,
    }
  }

  /** Alıcı kararından bağımsız kategori: bankanın etiketi, sonra anahtar kelime */
  const fallbackCategory = (description: string, bankLabel?: string | null) => {
    const fromBank = bankLabel ? opts.bankCategory?.(bankLabel) : undefined
    if (fromBank) return { categoryId: fromBank, categoryFrom: 'bank' as const }
    const kw = keywordCategory(description, 'expense', opts.categories as Category[])
    return kw ? { categoryId: kw, categoryFrom: 'keyword' as const } : undefined
  }
  const withCategory = (rule: MerchantRule, description: string, bankLabel?: string | null): MerchantRule => {
    if (rule.categoryId) return rule
    const fb = fallbackCategory(description, bankLabel)
    return fb ? { ...rule, ...fb, categorySure: false } : rule
  }

  return {
    ruleFor(description, bankLabel) {
      // 1) Geçmiş: birebir aynı işyeri metni, sonra bankadan bankaya yazım farkı
      const exact = byKey.get(merchantKey(description))
      const fromHist = exact ? fromHistory(exact) : undefined
      if (fromHist) return withCategory(fromHist, description, bankLabel)
      const twins = keys.filter(k => sameCore(k, description))
      if (twins.length) {
        const r = fromHistory(twins.flatMap(k => byKey.get(k)!))
        const shown = byKey.get(twins[0])!.find(t => t.merchant)?.merchant ?? twins[0]
        if (r) return withCategory({ ...r, via: shown }, description, bankLabel)
      }

      // 2) Alıcı adı işyeri metninde (kesik/bitişik yazıma toleranslı)
      let best: { p: Person; score: number } | undefined
      for (const r of recipients) {
        const score = nameInText(r.p.name, description) || shortNameMatch(r.key, description) ? 1 : nameScore(r.p.name, description)
        if (score >= MAYBE && (!best || score > best.score || (score === best.score && r.key.length > alnum(best.p.name).length))) best = { p: r.p, score }
      }
      if (best && best.score >= SURE) return withCategory(recipientRule(best.p, 'sure'), description, bankLabel)

      // 3) Aynı markanın geçmişi: hepsi tek alıcıdaysa o alıcı
      const brand = brandOf(description)
      const fam = brand ? byBrand.get(brand) : undefined
      const famRule = fam ? fromHistory(fam.txs) : undefined
      if (fam && famRule?.recipientId) {
        const rows = fam.txs.filter(t => t.type === 'expense' && t.amount > 0 && !t.deleted_at)
        const agree = rows.filter(t => t.recipientId === famRule.recipientId).length
        // İki ayrı işyeri metninde ve hep aynı alıcı: emin; tek kayıt ya da çoğunluk: öneri
        // Kısa ve baştaki kelime değilse ("ÖZEL DURU" → "duru") rastlantı olabilir: yalnız öneri
        const distinctive = merchantCore(description).tokens[0] === brand || brand!.length >= 5
        const sure = distinctive && agree === rows.length && (fam.keys.size >= 2 || rows.length >= 2)
        if (sure || agree / rows.length >= 2 / 3) {
          // Ürün/restoran açıklaması markanın başka şubesine taşınmaz
          const rn = peopleById.get(famRule.recipientId)?.name
          return withCategory({ ...famRule, source: 'brand', confidence: sure ? 'sure' : 'maybe', via: brand!, description: rn ?? famRule.description }, description, bankLabel)
        }
      }

      // 4) Benzer ad, emin değil: öneri olarak sorulur
      if (best) return withCategory(recipientRule(best.p, 'maybe'), description, bankLabel)

      const fb = fallbackCategory(description, bankLabel)
      if (fb) return { ...fb, categorySure: false, count: 0, source: fb.categoryFrom, confidence: 'sure' }
      return undefined
    },
    similar(description, limit = 3) {
      const brand = brandOf(description)
      const scored: { p: Person; score: number }[] = []
      for (const r of recipients) {
        let score = nameInText(r.p.name, description) || shortNameMatch(r.key, description) ? 1 : nameScore(r.p.name, description)
        // Ad markayla başlıyor ama metinde başka kelimeler var ("Migros Jet" ~ "MIGROS 5M")
        if (score < SIMILAR && brand && brand.length >= 4 && brandOf(r.p.name) === brand) score = SIMILAR
        if (score >= SIMILAR) scored.push({ p: r.p, score })
      }
      // Aynı markanın geçmişindeki alıcılar da aday ("IKEA-KARTAL" → IKEA alımlarının alıcısı)
      const fam = brand ? byBrand.get(brand) : undefined
      for (const t of fam?.txs ?? []) {
        const p = t.recipientId ? peopleById.get(t.recipientId) : undefined
        if (p && p.role === 'recipient' && !p.isArchived && !p.deleted_at && !scored.some(x => x.p.id === p.id)) scored.push({ p, score: 0.6 })
      }
      return scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name, 'tr')).slice(0, limit).map(x => x.p)
    },
  }
}
