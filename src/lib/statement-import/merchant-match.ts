import { foldText } from '@/lib/auto-category'

/* ── Banka işyeri metni ile alıcı adı arasında bulanık eşleştirme ─────────────
   Bankalar aynı işyerini farklı yazar: adı ~20-25 karakterde keser
   ("ÖZEL DURU VETERİNERL"), şehri bitiştirir ("YEMEKSEPISTANBUL"), başa ödeme
   aracısını ekler ("MONEYPAY/MIGROSONE"), şube adı ekler ("IKEA-KARTAL
   MAĞAZASI"). Birebir karşılaştırma bunları kaçırır ve kullanıcının zaten
   sistemde olan alıcısı "yeni alıcı" sanılır.

   Üç adım:
     1. merchantCore: metni gürültüden arındırır → anlamlı kelimeler
     2. brandOf:     ilk ayırt edici kelime ("ikea", "migros")
     3. nameScore:   alıcı adının metinde ne kadar karşılandığı (0..1);
                     kesik kelimeye (önek) ve küçük yazım farkına toleranslı

   SAF modül: yalnız metin alır. Hiçbir veri dışarı gönderilmez. */

/** Ödeme aracıları: asıl işyeri arkadan gelir. Aracının kendisi de bazen
 *  alıcıdır (Yemeksepeti) — bu yüzden `gatewayOf` ayrıca döner. */
const GATEWAYS = [
  'iyzico', 'paytr odeme', 'paytr', 'hepsipay-hep', 'hepsipay', 'moneypay', 'yemekpay', 'yemeksepetipay',
  'mokaunited', 'tami-odeme', 'tami', 'parati', 'garantipay', 'param', 'papara', 'sipay', 'craftgate', 'ininal',
  'paycell', 'payu', 'paypal', 'lidio', 'esnekpos', 'vepara',
]
export const GATEWAY_RE = new RegExp(`^(${GATEWAYS.map(g => g.replace(/[-]/g, '\\-')).join('|')})\\s*[*/]\\s*`)

/** Bankaların işyeri adının sonuna eklediği şehirler (bitişik de yazılabilir) */
const CITIES = [
  'istanbul', 'stanbul', 'ankara', 'izmir', 'bursa', 'antalya', 'mersin', 'adana', 'konya', 'kocaeli', 'izmit',
  'eskisehir', 'gaziantep', 'kayseri', 'samsun', 'trabzon', 'mugla', 'bodrum', 'aydin', 'denizli', 'sakarya',
  'tekirdag', 'edirne', 'canakkale', 'balikesir', 'manisa', 'hatay', 'diyarbakir', 'malatya', 'erzurum',
  'london', 'dublin', 'cork', 'luxembourg', 'amsterdam', 'paris', 'berlin',
]
// Uzun önce: "istanbul" "stanbul"dan önce denenmeli
const CITY_SUFFIX_RE = new RegExp(`(${[...CITIES].sort((a, b) => b.length - a.length).join('|')})$`)

/** Ayırt edici olmayan kelimeler: tek başına bir alıcıyı tanımlamaz. */
const GENERIC = new Set([
  've', 'ile', 'the', 'and', 'of', 'co', 'com', 'net', 'org', 'www', 'tr',
  'ltd', 'sti', 'ltdsti', 'as', 'aas', 'san', 'tic', 'ticaret', 'sanayi', 'ltd.sti', 'limited', 'sirketi', 'anonim',
  'magaza', 'magazasi', 'magazacilik', 'magazalari', 'sube', 'subesi', 'avm', 'store', 'shop', 'market', 'marketi',
  'gida', 'cafe', 'kafe', 'restoran', 'restaurant', 'lokanta', 'eczane', 'eczanesi', 'ozel', 'hizmetleri',
  'hizmet', 'insaat', 'otomotiv', 'turizm', 'tekstil', 'kozmetik', 'saglik', 'pazarlama', 'dis', 'ic', 'ithalat',
  'ihracat', 'urunleri', 'mamulleri', 'bilisim', 'teknoloji', 'elektronik', 'yemek', 'kahve', 'park', 'center',
  'merkez', 'merkezi', 'pos', 'online', 'sanal', 'odeme', 'bill', 'payment', 'internet', 'mobil',
])

/** Sondaki ülke/il kodu: "TR", "TU", "TRTR", "GBGB", "IRIR", "34" */
const TAIL_NOISE_RE = /^([a-z]{2}|([a-z]{2})\2|\d{1,6})$/

export interface MerchantCore {
  /** Anlamlı kelimeler, sırayla */
  tokens: string[]
  /** Kelimeler bitişik: "yemeksep", "ikeakartal" */
  joined: string
  /** Baştaki ödeme aracısı ("yemeksepetipay"), yoksa null */
  gateway: string | null
}

/** Metni karşılaştırılabilir çekirdeğe indirir. */
export function merchantCore(text: string): MerchantCore {
  let s = foldText(text)
    .replace(/\(\d+\/\d+\)/g, ' ')        // taksit eki
    .replace(/\d+\s*nolu\b/g, ' ')
  let gateway: string | null = null
  const gw = s.match(GATEWAY_RE)
  if (gw) { gateway = gw[1]; s = s.slice(gw[0].length) }
  s = s.replace(/^www\./, '').replace(/\.(com|net|org)(\.[a-z]{1,2})?\b/g, ' ')
  const tokens = s.split(/[^a-z0-9]+/).filter(Boolean)
  // Sondan gürültü: ülke kodu, il plakası, şehir; şehir bitişik de olabilir
  while (tokens.length > 1 && (TAIL_NOISE_RE.test(tokens[tokens.length - 1]) || CITIES.includes(tokens[tokens.length - 1]))) tokens.pop()
  const last = tokens[tokens.length - 1]
  const glued = last?.match(CITY_SUFFIX_RE)
  if (glued && last.length - glued[1].length >= 3) tokens[tokens.length - 1] = last.slice(0, -glued[1].length)
  // Baştaki şehir ("ISTANBUL POSVITAL VETER…") ve uzun sayılar (sipariş no, vergi dairesi kodu)
  while (tokens.length > 1 && (CITIES.includes(tokens[0]) || /^\d{3,}$/.test(tokens[0]))) tokens.shift()
  const kept = tokens.filter(t => !/^\d{5,}$/.test(t))
  return { tokens: kept, joined: kept.join(''), gateway }
}

/** İlk ayırt edici kelime (≥3 harf, genel değil): marka. "ikea-kartal magazasi" → "ikea" */
export function brandOf(text: string): string | null {
  const { tokens } = merchantCore(text)
  return tokens.find(t => t.length >= 3 && !GENERIC.has(t) && !/^\d+$/.test(t)) ?? null
}

/** İki çekirdek aynı işyeri mi (bankadan bankaya yazım farkı): kelimeler aynı
 *  ya da biri diğerinin kesik hali. */
export function sameCore(a: string, b: string): boolean {
  const x = merchantCore(a).joined, y = merchantCore(b).joined
  if (x.length < 5 || y.length < 5) return false
  if (x === y) return true
  const [s, l] = x.length <= y.length ? [x, y] : [y, x]
  // Kesik ad: kısa olan uzunun başı ve en az 12 harf (rastlantı olmasın)
  return s.length >= 12 && l.startsWith(s)
}

/** Damerau'suz Levenshtein — kelimeler kısa, yeterince hızlı */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

/** Bir alıcı adı kelimesinin metin kelimeleriyle en iyi karşılanma oranı (0..1). */
function tokenMatch(word: string, text: readonly string[]): number {
  let best = 0
  for (const t of text) {
    if (t === word) return 1
    const [s, l] = t.length <= word.length ? [t, word] : [word, t]
    // Kesik yazım: "veterinerl" ↔ "veteriner", "migrosone" ↔ "migros", "yemeksep" ↔ "yemeksepeti"
    // Kısa önek rastlantı olabilir ("duru" ⊂ "durumle"): 4-5 harfte oran da aranır
    if (l.startsWith(s) && (s.length >= 6 || (s.length >= 4 && s.length / l.length >= 0.7))) best = Math.max(best, s.length >= 6 ? 0.9 : 0.75)
    // Küçük yazım farkı: "hepsiburda" ↔ "hepsiburada"
    else if (s.length >= 5 && editDistance(t, word) <= (l.length >= 9 ? 2 : 1)) best = Math.max(best, 0.8)
  }
  return best
}

/** Alıcı adının işyeri metninde ne kadar karşılandığı (0..1). Genel kelimeler
 *  ("Market", "Eczanesi") az ağırlık taşır; yalnız genel kelimelerden oluşan ad
 *  hiç eşleşmez. Bitişik/ayrık yazım farkı da tutar ("YEMEK SEPETI" = "Yemeksepeti"). */
export function nameScore(name: string, text: string): number {
  const n = merchantCore(name).tokens
  const tc = merchantCore(text)
  const t = tc.gateway ? [...tc.tokens, ...merchantCore(tc.gateway).tokens] : tc.tokens
  const distinctive = n.filter(w => !GENERIC.has(w) && w.length >= 3 && !/^\d+$/.test(w))
  if (!distinctive.length || !t.length || n.join('').length < 4) return 0
  let got = 0, total = 0
  for (const w of n) {
    const weight = distinctive.includes(w) ? w.length : 1
    total += weight
    got += weight * tokenMatch(w, t)
  }
  let score = got / total
  // Bitişik yazım: "yemeksepeti" ↔ "yemek sepeti", "ikeakartal" ⊃ "ikea"
  // Bitişik ad tümüyle kullanılır ("lcwaikiki"); metin kelimesi adın kesik hali
  // sayılırsa adın çoğunu kapsamalı ("yemeksep" ~ "yemeksepeti", ama "universal" ≁ "universalveteriner")
  const nj = n.join(''), tj = [tc.joined, ...t].find(x => x.startsWith(nj) || (x.length >= 6 && x.length >= nj.length * 0.7 && nj.startsWith(x)))
  if (tj && nj.length >= 5) score = Math.max(score, tj === nj ? 1 : 0.9)
  // En ayırt edici kelime hiç karşılanmadıysa ad tutmuyor demektir
  const key = [...distinctive].sort((a, b) => b.length - a.length)[0]
  if (tokenMatch(key, t) === 0 && !tj) return Math.min(score, 0.4)
  return Math.round(score * 100) / 100
}

/** Puan eşikleri: üstü otomatik, arası "bu mu?" önerisi, altı yeni alıcı. */
export const SURE = 0.9
export const MAYBE = 0.7
