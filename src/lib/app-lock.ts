/* ── Uygulama kilidi (PIN) — özet hesabı ─────────────────────────────────────
   PIN düz metin saklanmaz: PBKDF2-SHA256 (150.000 tur, 16 baytlık rastgele
   tuz) özeti tutulur. Bu bir GÖRÜNTÜ kilididir — telefonu masada bırakınca ya
   da ekranı başkasına gösterince verinin görünmemesi için. Cihaza tam erişimi
   olan biri tarayıcı depolamasını doğrudan okuyabilir; o tehdit için hesap
   şifresi ve iki adımlı doğrulama var. */

const ITERATIONS = 150_000

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export const PIN_PATTERN = /^\d{4,8}$/

/** PIN'in özetini döndürür; tuz verilmezse yenisi üretilir. */
export async function hashPin(pin: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS },
    key,
    256,
  )
  return { hash: toB64(new Uint8Array(bits)), salt: toB64(salt) }
}

export async function verifyPin(pin: string, hash: string, saltB64: string): Promise<boolean> {
  const { hash: candidate } = await hashPin(pin, saltB64)
  // Uzunluk sabit (32 bayt); sabit zamanlı karşılaştırma
  let diff = candidate.length ^ hash.length
  for (let i = 0; i < Math.min(candidate.length, hash.length); i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i)
  return diff === 0
}
