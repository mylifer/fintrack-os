import type { PriceData } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   Kapalıçarşı altın kotasyonu — TARAYICIDAN

   /api/prices truncgil'i sunucuda (Vercel) dener; oradan erişim aralıklı
   (6 sn zaman aşımı) ve erişemediği istekte spot türetmeye düşer. Sonuç:
   aynı portföy bir yenilemede Kapalıçarşı alışıyla, ötekinde ~%1,7 yüksek spot
   fiyatla görünüyordu (2026-09-27: 991.654 ⇄ 1.005.340). truncgil tarayıcı
   isteklerine açık (Access-Control-Allow-Origin: *) ve kullanıcı Türkiye'den
   bağlanıyor — kotasyon burada çekilip sunucu yanıtının altın alanlarının
   üstüne yazılır.

   Tarayıcıdan da alınamazsa SON BAŞARILI kotasyon (en çok 24 saatlik) kullanılır:
   birkaç saatlik Kapalıçarşı fiyatı, anlık spot fiyattan tutarlıdır. O da yoksa
   sunucunun verdiği değer olduğu gibi kalır. iOS uygulaması aynı kuralı izler
   (ios/FinTrackKit/Sources/FinTrackData/PricesService.swift).
──────────────────────────────────────────────────────────────────────── */

const URL = 'https://finans.truncgil.com/v4/today.json'
const CACHE_KEY = 'fintrack.trGold.v1'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

interface Quote { current: number; prev: number }
export interface TurkishGold {
  gram?: Quote      // GRA — gram altın
  quarter?: Quote   // CEYREKALTIN
  half?: Quote      // YARIMALTIN
  full?: Quote      // TAMALTIN
  bracelet?: Quote  // YIA — 22 ayar bilezik (gram)
}

/** truncgil yanıtını çözümler — sunucudaki fetchTurkishGold (api/prices) ile aynı kural:
 *  ALIŞ (Buying) fiyatı; önceki kapanış günlük % değişimden geri hesaplanır. */
export function parseTurkishGold(data: unknown): TurkishGold | null {
  const d = data as Record<string, { Buying?: unknown; Change?: unknown } | undefined> | null
  const parse = (key: string): Quote | undefined => {
    const q = d?.[key]
    const current = q?.Buying
    const change = q?.Change
    if (typeof current !== 'number' || !(current > 0)) return undefined
    const prev = typeof change === 'number' && change > -100 ? current / (1 + change / 100) : current
    return { current, prev }
  }
  const gold: TurkishGold = {
    gram: parse('GRA'), quarter: parse('CEYREKALTIN'), half: parse('YARIMALTIN'),
    full: parse('TAMALTIN'), bracelet: parse('YIA'),
  }
  return gold.gram || gold.quarter || gold.half || gold.full || gold.bracelet ? gold : null
}

function readCache(now: number): TurkishGold | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { at, gold } = JSON.parse(raw) as { at: number; gold: TurkishGold }
    return typeof at === 'number' && now - at <= MAX_AGE_MS ? gold : null
  } catch {
    return null
  }
}

function writeCache(gold: TurkishGold, now: number): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, gold })) } catch { /* storage kapalı */ }
}

/** Tarayıcıdan taze kotasyon; olmazsa en çok 24 saatlik son başarılı kotasyon; o da yoksa null. */
export async function fetchTurkishGoldClient(now = Date.now()): Promise<TurkishGold | null> {
  try {
    const res = await fetch(URL, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
    if (res.ok) {
      const gold = parseTurkishGold(await res.json())
      if (gold) {
        writeCache(gold, now)
        return gold
      }
    }
  } catch { /* ağ / zaman aşımı → önbellek */ }
  return readCache(now)
}

/** Sunucu yanıtının altın alanlarını Kapalıçarşı kotasyonuyla değiştirir. Eksik
 *  kalem (ör. yalnız GRA geldiyse ziynetler) sunucunun değerinde kalır. */
export function applyTurkishGold(data: PriceData, tr: TurkishGold | null): PriceData {
  if (!tr) return data
  return {
    ...data,
    ...(tr.gram     && { goldGramTry: tr.gram.current,        prevGoldGramTry: tr.gram.prev }),
    ...(tr.quarter  && { goldQuarterTry: tr.quarter.current,  prevGoldQuarterTry: tr.quarter.prev }),
    ...(tr.half     && { goldHalfTry: tr.half.current,        prevGoldHalfTry: tr.half.prev }),
    ...(tr.full     && { goldFullTry: tr.full.current,        prevGoldFullTry: tr.full.prev }),
    ...(tr.bracelet && { bilezikGramTry: tr.bracelet.current, prevBilezikGramTry: tr.bracelet.prev }),
  }
}
