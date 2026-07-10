/* Deterministic UUID from a seed string (cyrb128 hash → uuid-v4 format).

   Same seed → same id, always. Used so that generating a recurring occurrence
   for a given (template, date) is IDEMPOTENT: two tabs, a double-click, or a
   retry all produce the same transaction id, which the sync layer upserts
   (put) into a single row instead of creating duplicates. Output is a valid
   uuid string, accepted by the Postgres `uuid` id column. */
export function deterministicUuid(seed: string): string {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  const hex = ((h1 >>> 0).toString(16).padStart(8, '0'))
            + ((h2 >>> 0).toString(16).padStart(8, '0'))
            + ((h3 >>> 0).toString(16).padStart(8, '0'))
            + ((h4 >>> 0).toString(16).padStart(8, '0'))
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
