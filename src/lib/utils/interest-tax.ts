import type { Category, Transaction } from '@/types'
import { foldText } from '@/lib/auto-category'
import { deterministicUuid } from './id'
import { toMajor, toMinor } from './money'

/* ────────────────────────────────────────────────────────────────────────
   Faiz geliri stopajı — İşlem Ekle'de Faiz kategorisiyle girilen gelirde
   bankanın kestiği stopaj ayrı bir VERGİ gideri olarak yazılır:

     faiz geliri (brüt, Faiz kategorisi)   +brüt
     stopaj gideri (Vergi, alıcı İTC)      −stopaj
     hesaba etkisi                          net  (= bankanın yatırdığı)

   Bağ: stopaj satırının kimliği faiz satırının kimliğinden TÜRETİLİR
   (interestTaxId). Böylece şemaya alan eklemeden faiz satırından stopajı
   bulmak mümkündür; silme ikisini birlikte siler, düzenleme stopajı
   yeniden hesaplar. Saf fonksiyonlar: store'a dokunmaz.
──────────────────────────────────────────────────────────────────────── */

export const INTEREST_TAX_SUFFIX = 'stopajı'

/** Faiz satırına bağlı stopaj gider satırının kimliği. */
export function interestTaxId(interestTxId: string): string {
  return deterministicUuid(`interest-tax:${interestTxId}`)
}

/** Faiz kategorisi mi — adında (ya da bir üst kategorisinin adında) "faiz"
 *  geçen GELİR kategorisi ("Faiz", "Faiz Geliri", "Mevduat Faizi" …). */
export function isInterestCategory(
  categoryId: string | undefined | null,
  categories: readonly Pick<Category, 'id' | 'name' | 'scope' | 'parentId'>[],
): boolean {
  let cur = categoryId ? categories.find(c => c.id === categoryId) : undefined
  if (!cur || cur.scope !== 'income') return false
  for (let depth = 0; cur && depth < 5; depth++) {
    if (foldText(cur.name).includes('faiz')) return true
    const parentId: string | undefined = cur.parentId
    cur = parentId ? categories.find(c => c.id === parentId) : undefined
  }
  return false
}

export interface InterestSplit { gross: number; tax: number; net: number }

/** Girilen tutardan brüt / stopaj / net üçlüsü.
 *  - 'gross': stopaj = brüt × oran (kuruşa yuvarlı), net = brüt − stopaj.
 *  - 'net'  : bankanın yatırdığı tutar girildi. Brüt, stopajı kesildiğinde
 *    tam bu neti veren tutardır; stopaj = brüt − net, böylece hesaba etki
 *    girilen tutarla KURUŞU KURUŞUNA aynı kalır. */
export function splitInterest(amount: number, ratePct: number, mode: 'gross' | 'net'): InterestSplit {
  const amt = toMinor(Math.max(0, amount))
  const r = Math.min(Math.max(ratePct, 0), 99.99) / 100
  if (mode === 'gross') {
    const tax = Math.round(amt * r)
    return { gross: toMajor(amt), tax: toMajor(tax), net: toMajor(amt - tax) }
  }
  // net = brüt − round(brüt × r) denklemini sağlayan brüt aranır (en yakın
  // aday ±1 kuruş içinde); bulunamazsa yaklaşık değer kullanılır.
  const approx = Math.round(amt / (1 - r))
  let gross = approx
  for (const g of [approx, approx - 1, approx + 1]) {
    if (g - Math.round(g * r) === amt) { gross = g; break }
  }
  return { gross: toMajor(gross), tax: toMajor(gross - amt), net: toMajor(amt) }
}

/** Kayıtlı faiz + stopaj satırından oranı geri çıkarır (düzenleme formu için). */
export function impliedTaxRate(gross: number, tax: number): number {
  if (gross <= 0) return 0
  return Math.round((tax / gross) * 10000) / 100
}

/** Silinecek satırlara, içlerindeki faiz satırlarının stopaj satırlarını ekler. */
export function withLinkedInterestTax<T extends Pick<Transaction, 'id' | 'type'>>(
  group: readonly T[],
  all: readonly T[],
): T[] {
  const ids = new Set(group.map(t => t.id))
  const extra: T[] = []
  for (const t of group) {
    if (t.type !== 'income') continue
    const tax = all.find(x => x.id === interestTaxId(t.id))
    if (tax && !ids.has(tax.id)) { ids.add(tax.id); extra.push(tax) }
  }
  return extra.length ? [...group, ...extra] : [...group]
}
