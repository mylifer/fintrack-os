import type { Account } from '@/types'

/**
 * Hesap düzenleme formunun yamasını üretir: formun AÇILIŞ değerlerinden
 * kurulan kayıt (`opening`) ile kaydetme anındaki kayıt (`edited`) kıyaslanır,
 * yalnız kullanıcının gerçekten değiştirdiği alanlar döner. Yama store'daki
 * GÜNCEL hesabın üzerine yazılır; form açıkken başka yerden değişen alanlar
 * (Kart Takvimi, realtime, bakiye yeniden hesabı) böylece ezilmez.
 *
 * `edited`'de hiç olmayan anahtarlar yamaya girmez (eski tam-kayıt yazımı da
 * onlara dokunmuyordu).
 */
export function accountFormPatch(opening: Partial<Account>, edited: Partial<Account>): Partial<Account> {
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(edited) as (keyof Account)[]) {
    if (!Object.is(opening[key], edited[key])) patch[key] = edited[key]
  }
  return patch as Partial<Account>
}
