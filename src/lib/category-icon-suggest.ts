/* ── Kategori adından ikon + renk önerisi ─────────────────────────────────
   Yeni bir kategori eklenirken kullanıcının ikon/renk seçmesine gerek
   kalmasın diye kategori adını bir anahtar kelime tablosuyla eşleştirip
   Tabler ikon adı ve semantik bir renk döndürür.

   Neden model değil de deterministik bir eşleştirici:
   • Uygulama çevrimdışı-önce (Dexie + outbox) çalışıyor; kategori ekleme
     akışı ağ çağrısı bekleyemez, isim yazılırken anında sonuç gerekir.
   • Aynı isim her zaman aynı ikonu/rengi vermeli — yedek geri yükleme ve
     tek seferlik geçiş (migration) tekrar çalıştığında sonuç değişmemeli.

   Eşleştirme Türkçe'ye göre: normalize ederken Türkçe küçük harf kuralı
   (I→ı, İ→i) uygulanır, aksanlar ASCII'ye indirilir ve sondan eklerle
   uzayan sözcükler (market+ler, kira+sı) önek eşleşmesiyle yakalanır. */

import { SUGGEST_PALETTE, DEFAULT_COLOR, DEFAULT_ICON } from './category-palette'
import type { CategoryScope } from '@/types'

/* ── Alan renkleri — DEFAULT_CATEGORIES ile aynı tonlar ──────────────── */
const C = {
  food:      '#F97316',
  grocery:   '#10B981',
  cafe:      '#F59E0B',
  transport: '#3B82F6',
  home:      '#EAB308',
  shopping:  '#EC4899',
  bills:     '#F97316',
  subs:      '#8B5CF6',
  fun:       '#A855F7',
  health:    '#EF4444',
  insurance: '#64748B',
  invest:    '#6366F1',
  tax:       '#78716C',
  bank:      '#1D4ED8',
  edu:       '#0EA5E9',
  travel:    '#0EA5E9',
  pet:       '#84CC16',
  tech:      '#3B82F6',
  nature:    '#84CC16',
  income:    '#10B981',
  neutral:   '#6B7280',
} as const

interface Rule {
  icon: string
  color: string
  /** Normalize edilmiş (ASCII, küçük harf) anahtar kelimeler. */
  kw: readonly string[]
}

/* Tablo sırası yalnızca eşit puanlı eşleşmelerde belirleyici: daha uzun ve
   daha spesifik anahtar kelime her zaman kazanır (bkz. scoreKeyword). */
const RULES: readonly Rule[] = [
  /* ── Yeme-içme ─────────────────────────────────────────────────────── */
  { icon: 'tools-kitchen-2', color: C.food, kw: ['yemek', 'restoran', 'restaurant', 'lokanta', 'food', 'dining', 'yemekhane', 'yemeksepeti', 'getir yemek', 'ogle yemegi', 'aksam yemegi', 'siparis', 'fast food'] },
  { icon: 'pizza',           color: C.food, kw: ['pizza', 'italyan', 'makarna'] },
  { icon: 'burger',          color: C.food, kw: ['burger', 'hamburger', 'mcdonalds', 'burger king'] },
  { icon: 'meat',            color: C.food, kw: ['kebap', 'doner', 'mangal', 'kasap', 'izgara', 'kofte', 'steak'] },
  { icon: 'ice-cream',       color: C.food, kw: ['tatli', 'dessert', 'pastane', 'dondurma', 'cikolata', 'sekerleme'] },
  { icon: 'bread',           color: C.food, kw: ['ekmek', 'firin', 'bakery', 'borek', 'simit'] },
  { icon: 'egg-fried',       color: C.food, kw: ['kahvalti', 'brunch', 'breakfast'] },
  { icon: 'salad',           color: C.food, kw: ['salata', 'salad', 'vegan', 'vejetaryen', 'diyet'] },
  { icon: 'fish',            color: C.food, kw: ['balik', 'susi', 'sushi', 'deniz urunleri'] },
  { icon: 'coffee',          color: C.cafe, kw: ['kahve', 'coffee', 'cafe', 'kafe', 'starbucks', 'espresso', 'latte', 'kahveci'] },
  { icon: 'cup',             color: C.cafe, kw: ['cay', 'cay ocagi', 'tea'] },
  { icon: 'beer',            color: C.cafe, kw: ['bira', 'beer', 'pub', 'bar', 'meyhane', 'birahane'] },
  { icon: 'glass-full',      color: C.cafe, kw: ['alkol', 'sarap', 'wine', 'raki', 'viski', 'icki', 'tekel'] },

  /* ── Market ────────────────────────────────────────────────────────── */
  { icon: 'shopping-cart',   color: C.grocery, kw: ['market', 'bakkal', 'grocery', 'gida', 'erzak', 'migros', 'a101', 'bim', 'carrefour', 'sok market', 'macrocenter', 'market alisverisi'] },
  { icon: 'apple',           color: C.grocery, kw: ['manav', 'sebze', 'meyve', 'pazar'] },

  /* ── Ulaşım ────────────────────────────────────────────────────────── */
  { icon: 'car',             color: C.transport, kw: ['ulasim', 'transport', 'arac', 'araba', 'otomobil', 'oto', 'car', 'taksi', 'taxi', 'uber', 'bitaksi'] },
  { icon: 'bus',             color: C.transport, kw: ['otobus', 'bus', 'dolmus', 'minibus', 'metrobus', 'toplu tasima', 'istanbulkart'] },
  { icon: 'train',           color: C.transport, kw: ['metro', 'tren', 'train', 'tramvay', 'yht', 'rayli', 'marmaray'] },
  { icon: 'plane',           color: C.travel,    kw: ['ucak', 'plane', 'flight', 'ucus', 'havayolu', 'thy', 'pegasus', 'duty free'] },
  { icon: 'sailboat',        color: C.transport, kw: ['vapur', 'ferry', 'feribot', 'gemi', 'tekne'] },
  { icon: 'gas-station',     color: C.transport, kw: ['benzin', 'yakit', 'mazot', 'dizel', 'motorin', 'lpg', 'fuel', 'akaryakit', 'benzinlik', 'petrol'] },
  { icon: 'parking',         color: C.transport, kw: ['otopark', 'parking', 'park ucreti', 'ispark'] },
  { icon: 'road',            color: C.transport, kw: ['hgs', 'ogs', 'kopru', 'otoyol', 'gise', 'gecis ucreti'] },
  { icon: 'tool',            color: C.transport, kw: ['lastik', 'oto bakim', 'arac bakim', 'otomobil bakim', 'yedek parca', 'tamirci', 'servis'] },
  { icon: 'bike',            color: C.transport, kw: ['bisiklet', 'bike', 'scooter'] },
  { icon: 'motorbike',       color: C.transport, kw: ['motosiklet', 'motorsiklet'] },
  { icon: 'bolt',            color: '#EAB308',   kw: ['sarj', 'charge', 'elektrikli arac'] },
  { icon: 'droplet',         color: '#06B6D4',   kw: ['arac yikama', 'oto yikama', 'yikama', 'car wash'] },
  { icon: 'alert-triangle',  color: C.health,    kw: ['ceza', 'trafik cezasi', 'para cezasi'] },
  { icon: 'license',         color: C.tax,       kw: ['ehliyet', 'ruhsat', 'noter'] },

  /* ── Ev ────────────────────────────────────────────────────────────── */
  { icon: 'home',            color: C.home, kw: ['ev', 'home', 'konut', 'hane'] },
  { icon: 'key',             color: C.home, kw: ['kira', 'rent', 'kiralama', 'depozito'] },
  { icon: 'building',        color: C.home, kw: ['aidat', 'apartman', 'site aidati', 'yonetim'] },
  { icon: 'hammer',          color: C.home, kw: ['tadilat', 'tamirat', 'usta', 'boya', 'insaat', 'renovasyon', 'onarim'] },
  { icon: 'sofa',            color: C.home, kw: ['mobilya', 'furniture', 'dekorasyon', 'ikea', 'ev esyasi'] },
  { icon: 'wash-machine',    color: C.home, kw: ['beyaz esya', 'camasir', 'bulasik makinesi', 'kurutma'] },
  { icon: 'tools-kitchen-2', color: C.home, kw: ['mutfak', 'kitchen'] },
  { icon: 'bath',            color: C.home, kw: ['banyo', 'tuvalet'] },
  { icon: 'spray',           color: C.home, kw: ['temizlik', 'deterjan', 'cleaning', 'hijyen', 'temizlikci'] },
  { icon: 'plant-2',         color: C.nature, kw: ['bahce', 'garden', 'cicek', 'bitki', 'saksi', 'peyzaj'] },
  { icon: 'building-estate', color: C.home, kw: ['emlak', 'tapu', 'gayrimenkul', 'daire'] },

  /* ── Faturalar ─────────────────────────────────────────────────────── */
  { icon: 'receipt',         color: C.bills, kw: ['fatura', 'faturalar', 'bill', 'abonman'] },
  { icon: 'bolt',            color: C.bills, kw: ['elektrik', 'electric', 'enerji'] },
  { icon: 'flame',           color: C.bills, kw: ['dogalgaz', 'gaz', 'kombi', 'isinma', 'yakacak', 'komur'] },
  { icon: 'droplet',         color: C.bills, kw: ['su', 'water', 'damacana', 'su faturasi'] },
  { icon: 'wifi',            color: C.bills, kw: ['internet', 'wifi', 'fiber', 'modem', 'ttnet'] },
  { icon: 'phone',           color: C.bills, kw: ['telefon', 'phone', 'gsm', 'mobil hat', 'turkcell', 'vodafone', 'telekom', 'kontor'] },
  { icon: 'device-tv',       color: C.bills, kw: ['televizyon', 'kablo tv', 'digiturk', 'tivibu', 'tv'] },
  { icon: 'trash',           color: C.bills, kw: ['cop', 'atik', 'cevre temizlik'] },

  /* ── Abonelik & dijital ────────────────────────────────────────────── */
  { icon: 'refresh',         color: C.subs, kw: ['abonelik', 'abone', 'subscription', 'uyelik', 'membership', 'yenileme'] },
  { icon: 'movie',           color: C.fun,  kw: ['netflix', 'disney', 'blutv', 'exxen', 'dizi', 'film', 'sinema', 'cinema', 'movie', 'mubi'] },
  { icon: 'music',           color: C.fun,  kw: ['spotify', 'muzik', 'music', 'konser', 'concert', 'festival', 'apple music'] },
  { icon: 'device-gamepad-2', color: C.fun, kw: ['oyun', 'game', 'gaming', 'steam', 'playstation', 'xbox', 'epic', 'nintendo'] },
  { icon: 'cloud',           color: C.tech, kw: ['bulut', 'cloud', 'icloud', 'dropbox', 'depolama', 'google drive', 'hosting', 'sunucu', 'domain'] },
  { icon: 'device-desktop',  color: C.tech, kw: ['yazilim', 'software', 'uygulama', 'lisans', 'adobe', 'office', 'saas'] },
  { icon: 'robot',           color: C.subs, kw: ['yapay zeka', 'chatgpt', 'openai', 'claude', 'midjourney'] },

  /* ── Eğlence & hobi ────────────────────────────────────────────────── */
  { icon: 'confetti',        color: C.fun, kw: ['eglence', 'etkinlik', 'event', 'parti', 'kutlama', 'dogum gunu', 'dugun', 'nisan'] },
  { icon: 'masks-theater',   color: C.fun, kw: ['tiyatro', 'opera', 'gosteri', 'sahne', 'stand up'] },
  { icon: 'book',            color: C.fun, kw: ['kitap', 'book', 'dergi', 'gazete', 'yayin', 'okuma'] },
  { icon: 'palette',         color: C.fun, kw: ['hobi', 'hobby', 'sanat', 'resim', 'boyama', 'el isi'] },
  { icon: 'camera',          color: C.fun, kw: ['fotograf', 'foto', 'kamera', 'photography'] },
  { icon: 'ticket',          color: C.fun, kw: ['bilet', 'ticket', 'mac bileti'] },
  { icon: 'building-monument', color: C.fun, kw: ['muze', 'sergi', 'galeri'] },
  { icon: 'tent',            color: C.nature, kw: ['kamp', 'camping', 'doga', 'trekking'] },

  /* ── Seyahat ───────────────────────────────────────────────────────── */
  { icon: 'beach',           color: C.travel, kw: ['tatil', 'vacation', 'holiday', 'plaj', 'beach', 'deniz'] },
  { icon: 'map-pin',         color: C.travel, kw: ['seyahat', 'travel', 'gezi', 'tur', 'yurtdisi'] },
  { icon: 'bed',             color: C.travel, kw: ['otel', 'hotel', 'konaklama', 'airbnb', 'hostel', 'pansiyon'] },
  { icon: 'luggage',         color: C.travel, kw: ['valiz', 'bavul', 'bagaj'] },
  { icon: 'id',              color: C.travel, kw: ['vize', 'pasaport'] },

  /* ── Sağlık & spor ─────────────────────────────────────────────────── */
  { icon: 'building-hospital', color: C.health, kw: ['saglik', 'health', 'hastane', 'klinik', 'doktor', 'muayene', 'tedavi'] },
  { icon: 'pill',            color: C.health, kw: ['eczane', 'ilac', 'pharmacy', 'medicine', 'vitamin', 'recete', 'takviye'] },
  { icon: 'dental',          color: C.health, kw: ['dis hekimi', 'dentist', 'ortodonti', 'implant', 'dis'] },
  { icon: 'eyeglass',        color: C.health, kw: ['gozluk', 'optik', 'lens'] },
  { icon: 'brain',           color: C.health, kw: ['psikolog', 'terapi', 'psikiyatri', 'mental'] },
  { icon: 'test-pipe',       color: C.health, kw: ['tahlil', 'laboratuvar', 'kan tahlili', 'check up'] },
  { icon: 'vaccine',         color: C.health, kw: ['asi', 'igne'] },
  { icon: 'stethoscope',     color: C.health, kw: ['ameliyat', 'cerrahi', 'hemsire'] },
  { icon: 'barbell',         color: C.health, kw: ['spor', 'fitness', 'gym', 'spor salonu', 'antrenman', 'pilates', 'yoga', 'crossfit'] },
  { icon: 'run',             color: C.health, kw: ['kosu', 'running', 'maraton'] },
  { icon: 'swimming',        color: C.health, kw: ['yuzme', 'havuz'] },

  /* ── Kişisel bakım ─────────────────────────────────────────────────── */
  { icon: 'sparkles',        color: C.shopping, kw: ['kisisel bakim', 'kozmetik', 'makyaj', 'cilt bakimi', 'guzellik', 'parfum', 'spa', 'masaj', 'bakim'] },
  { icon: 'scissors',        color: C.shopping, kw: ['kuafor', 'berber', 'tiras', 'manikur', 'pedikur', 'sac'] },

  /* ── Alışveriş ─────────────────────────────────────────────────────── */
  { icon: 'shopping-bag',    color: C.shopping, kw: ['alisveris', 'shopping', 'magaza', 'trendyol', 'hepsiburada', 'amazon', 'n11'] },
  { icon: 'hanger',          color: C.shopping, kw: ['giyim', 'kiyafet', 'tekstil', 'elbise', 'pantolon', 'gomlek', 'tisort', 'moda', 'fashion', 'ic giyim'] },
  { icon: 'shoe',            color: C.shopping, kw: ['ayakkabi', 'sneaker', 'terlik'] },
  { icon: 'backpack',        color: C.shopping, kw: ['canta', 'sirt cantasi'] },
  { icon: 'diamond',         color: C.shopping, kw: ['taki', 'mucevher', 'yuzuk', 'kolye', 'pirlanta', 'kuyumcu'] },
  { icon: 'device-watch',    color: C.shopping, kw: ['kol saati', 'saat'] },
  { icon: 'device-laptop',   color: C.tech,     kw: ['teknoloji', 'elektronik', 'bilgisayar', 'laptop', 'notebook', 'macbook', 'tablet', 'donanim'] },
  { icon: 'device-mobile',   color: C.tech,     kw: ['cep telefonu', 'akilli telefon', 'iphone', 'android'] },
  { icon: 'headphones',      color: C.tech,     kw: ['kulaklik', 'headphone', 'airpods', 'hoparlor'] },
  { icon: 'horse-toy',       color: C.shopping, kw: ['oyuncak'] },
  { icon: 'baby-carriage',   color: C.shopping, kw: ['bebek', 'cocuk', 'kres', 'emzik'] },
  { icon: 'gift',            color: C.shopping, kw: ['hediye', 'gift', 'hediyelik'] },
  { icon: 'pencil',          color: C.invest,   kw: ['kirtasiye', 'defter', 'kalem', 'ofis malzemesi'] },
  { icon: 'tool',            color: C.neutral,  kw: ['hirdavat', 'nalbur', 'yapi market', 'malzeme'] },
  { icon: 'smoking',         color: C.tax,      kw: ['sigara', 'tutun', 'tobacco', 'puro', 'elektronik sigara'] },

  /* ── Eğitim ────────────────────────────────────────────────────────── */
  { icon: 'school',          color: C.edu, kw: ['egitim', 'okul', 'universite', 'kurs', 'ders', 'sinav', 'harc', 'dershane', 'sertifika', 'yurt', 'education', 'ogrenci', 'udemy', 'dil kursu', 'seminer'] },

  /* ── Evcil hayvan ──────────────────────────────────────────────────── */
  { icon: 'paw',             color: C.pet, kw: ['evcil', 'pet', 'petshop', 'kedi', 'kopek', 'mama', 'veteriner', 'akvaryum'] },

  /* ── Banka & finans ────────────────────────────────────────────────── */
  { icon: 'building-bank',   color: C.bank, kw: ['banka', 'bank', 'banka masrafi', 'banka giderleri', 'hesap isletim', 'komisyon', 'eft', 'havale', 'atm', 'iban', 'masraf'] },
  { icon: 'credit-card',     color: C.bank, kw: ['kredi karti', 'kart', 'card', 'credit card'] },
  { icon: 'report-money',    color: C.bank, kw: ['kredi', 'loan', 'ihtiyac kredisi', 'konut kredisi', 'tuketici kredisi'] },
  { icon: 'coins',           color: C.tax,  kw: ['borc', 'debt', 'alacak'] },
  { icon: 'calendar-repeat', color: C.subs, kw: ['taksit', 'installment', 'vade'] },
  { icon: 'receipt-tax',     color: C.tax,  kw: ['vergi', 'tax', 'mtv', 'kdv', 'otv', 'stopaj', 'beyanname'] },
  { icon: 'shield',          color: C.insurance, kw: ['sigorta', 'insurance', 'kasko', 'dask', 'police', 'sgk', 'prim'] },
  { icon: 'pig-money',       color: C.income, kw: ['birikim', 'tasarruf', 'saving', 'kumbara', 'acil fon', 'emeklilik', 'bes'] },
  { icon: 'trending-up',     color: C.invest, kw: ['yatirim', 'invest', 'borsa', 'hisse', 'fon', 'portfoy', 'temettu'] },
  { icon: 'coin',            color: '#EAB308', kw: ['altin', 'gold', 'gumus', 'ziynet'] },
  { icon: 'currency-dollar', color: C.income, kw: ['doviz', 'dolar', 'euro', 'sterlin', 'forex'] },
  { icon: 'currency-bitcoin', color: C.food,  kw: ['kripto', 'bitcoin', 'btc', 'ethereum', 'binance'] },
  { icon: 'cash',            color: C.income, kw: ['nakit', 'cash', 'para'] },
  { icon: 'arrows-exchange', color: C.neutral, kw: ['transfer', 'virman', 'gonderim'] },
  { icon: 'gavel',           color: C.neutral, kw: ['avukat', 'hukuk', 'legal', 'mahkeme', 'dava'] },
  { icon: 'scale',           color: C.neutral, kw: ['adalet', 'noter ucreti'] },

  /* ── İş & gelir ────────────────────────────────────────────────────── */
  { icon: 'briefcase',       color: C.income, kw: ['maas', 'salary', 'ucret', 'mesai', 'bordro', 'freelance', 'serbest', 'danismanlik', 'proje', 'musteri'] },
  { icon: 'building-store',  color: C.income, kw: ['satis', 'sale', 'ticaret', 'dukkan', 'isletme'] },
  { icon: 'moneybag',        color: C.income, kw: ['gelir', 'income', 'kazanc', 'hasilat', 'ek gelir'] },
  { icon: 'arrow-up-right',  color: C.income, kw: ['cashback', 'iade', 'refund', 'geri odeme', 'puan'] },
  { icon: 'heart-handshake', color: C.health, kw: ['bagis', 'yardim', 'sadaka', 'zekat', 'charity', 'donation', 'burs'] },
  { icon: 'ad',              color: C.shopping, kw: ['reklam', 'pazarlama', 'marketing', 'sponsorluk'] },
  { icon: 'truck-delivery',  color: C.tax,   kw: ['kargo', 'nakliye', 'gonderi', 'posta', 'teslimat'] },
  { icon: 'building-skyscraper', color: C.neutral, kw: ['ofis', 'is yeri', 'sirket', 'personel'] },
  { icon: 'home',            color: C.income, kw: ['kira geliri'] },

  /* ── Diğer ─────────────────────────────────────────────────────────── */
  { icon: 'package',         color: C.neutral, kw: ['diger', 'other', 'cesitli', 'genel'] },
]

/* ── Normalizasyon ────────────────────────────────────────────────────── */
const TR_FOLD: Record<string, string> = {
  'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u',
}

/** "Kişisel Bakım" → "kisisel bakim". Türkçe küçük harf (I→ı, İ→i) sonra ASCII. */
export function normalizeCategoryName(raw: string): string {
  return raw
    .toLocaleLowerCase('tr')
    .replace(/[ışğüöçâîû]/g, ch => TR_FOLD[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/* ── Puanlama ─────────────────────────────────────────────────────────── */
/* Tam sözcük > önek (Türkçe ekleri için) > içerme. Uzun anahtar kelime her
   zaman kısasını yener; böylece "kredi karti" > "kart", "kira geliri" >
   "kira" olur. 0 = eşleşme yok. */
function scoreKeyword(kw: string, name: string, tokens: readonly string[]): number {
  if (kw.includes(' ')) {
    return name.includes(kw) ? 300 + kw.length : 0
  }
  if (tokens.includes(kw)) return 200 + kw.length
  // Türkçe ekler: "market+ler", "kira+sı", "fatura+ları". Kısa köklerin
  // rastgele sözcüklere yapışmaması için en az 4 harf ve en fazla 5 harflik
  // ek şartı var — "ev" kökü "evcil"e, "dis" kökü "disiplin"e yapışmasın.
  if (kw.length >= 4 && tokens.some(t => t.startsWith(kw) && t.length - kw.length <= 5)) {
    return 100 + kw.length
  }
  if (kw.length >= 5 && name.includes(kw)) return 50 + kw.length
  return 0
}

/* ── Renk yedeği ──────────────────────────────────────────────────────── */
/* Anahtar kelime bulunamadığında bile renk seçilir: aynı isim her zaman aynı
   rengi alsın diye DONDURULMUŞ paletten deterministik (FNV-1a) bir indeks
   (seçici paleti büyüdükçe var olan adların rengi kaymasın). */
function paletteColorFor(name: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return SUGGEST_PALETTE[h % SUGGEST_PALETTE.length]
}

export interface IconSuggestion {
  icon: string
  color: string
  /** true → anahtar kelime eşleşti (güvenli öneri); false → yalnızca yedek. */
  matched: boolean
}

/**
 * Kategori adına en uygun Tabler ikonunu ve rengi seçer.
 * Eşleşme bulunamazsa kapsamına göre nötr bir ikon + paletten sabit bir renk.
 */
export function suggestCategoryIcon(rawName: string, scope: CategoryScope = 'expense'): IconSuggestion {
  const name = normalizeCategoryName(rawName)
  if (!name) return { icon: DEFAULT_ICON, color: DEFAULT_COLOR, matched: false }

  const tokens = name.split(' ')
  let best: Rule | null = null
  let bestScore = 0

  for (const rule of RULES) {
    for (const kw of rule.kw) {
      const s = scoreKeyword(kw, name, tokens)
      if (s > bestScore) { bestScore = s; best = rule }
    }
  }

  if (best) return { icon: best.icon, color: best.color, matched: true }

  return {
    icon:  scope === 'income' ? 'moneybag' : DEFAULT_ICON,
    color: scope === 'income' ? C.income : paletteColorFor(name),
    matched: false,
  }
}

/* ── Tek seferlik geçiş yardımcıları ──────────────────────────────────── */
/** İkon kullanıcının bilinçli seçimi değil de varsayılan/legacy mi?
 *  package (varsayılan), boş, emoji, Lucide PascalCase ya da iconify "set:ad". */
export function isPlaceholderIcon(icon: string): boolean {
  if (!icon || icon === DEFAULT_ICON) return true
  if (icon.includes(':')) return true      // noto: / iconify
  return !/^[a-z]/.test(icon)              // PascalCase (Lucide) ya da emoji
}

/**
 * Var olan bir kategoriye tek seferlik geçişte yazılacak yamayı döndürür;
 * değişiklik gerekmiyorsa null.
 *  • Ad bir anahtar kelimeyle eşleşiyorsa → önerilen ikon + renk yazılır,
 *    elle seçilmiş olsa bile (geçişin amacı bu; categories.store sonucu
 *    "Geri al" bildirimiyle gösterir).
 *  • Eşleşmiyorsa yalnızca hiç dokunulmamış (yer tutucu ikon + varsayılan
 *    renk) kategoriye yedek ikon/renk verilir — bilinçli bir seçim, adından
 *    anlam çıkarılamayan bir kategoride rastgele görünen bir renkle ezilmez.
 */
export function autoIconPatch(
  cat: { name: string; icon: string; color: string; scope: CategoryScope },
): { icon?: string; color?: string } | null {
  const s = suggestCategoryIcon(cat.name, cat.scope)
  const untouched = isPlaceholderIcon(cat.icon) && cat.color === DEFAULT_COLOR
  if (!s.matched && !untouched) return null

  const patch: { icon?: string; color?: string } = {}
  if (cat.icon  !== s.icon)  patch.icon  = s.icon
  if (cat.color !== s.color) patch.color = s.color
  return patch.icon || patch.color ? patch : null
}
