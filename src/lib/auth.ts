import { supabase } from './supabase'
import { db } from './db'

export async function getUserId(): Promise<string | undefined> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id
}

// Shared-device: son giriş yapan kullanıcının id'sini tutar. Yeni girişte
// kullanıcı değişimini yükleme/sync'ten ÖNCE tespit etmek için kullanılır.
// Oturum açan HER yol (giriş, kayıt, şifre sıfırlama) bu tek işaretçiyi
// paylaşmak zorunda — biri atlarsa sonraki kullanıcı diğerinin kontrolüne
// görünmez olur (Güvenlik denetimi 2026-08-29, bulgu F3).
const LAST_UID_KEY = 'ft_last_uid'

/** Oturum açan kullanıcıyı uygulamaya sokar. Bu cihazda daha önce FARKLI bir
 *  kullanıcı oturum açtıysa yerel Dexie + outbox + tarayıcı deposu önce
 *  temizlenir ve HARD navigasyon yapılır: bellekteki Zustand store'ları ve
 *  DataProvider'ın modül-seviyesi init kilidi yeni kullanıcı için sıfırlanır
 *  (soft push bunları taşıyıp önceki kullanıcının verisini gösterebilirdi). */
export async function enterApp(
  uid: string | undefined,
  push: (href: string) => void,
  tag: string,
): Promise<void> {
  const prevUid = localStorage.getItem(LAST_UID_KEY)
  const switched = !!uid && !!prevUid && prevUid !== uid

  if (switched) {
    try {
      await clearLocalData()
    } catch (err) {
      console.error(`[${tag}:clearLocalData]`, err)
    }
  }

  if (uid) localStorage.setItem(LAST_UID_KEY, uid)

  if (switched) {
    window.location.assign('/dashboard')
  } else {
    push('/dashboard')
  }
}

/** İkinci adım (TOTP) bekleyen bir oturum var mı? Şifreyle girilmiş ama
 *  doğrulama uygulamasıyla henüz onaylanmamış (aal1 → aal2) oturumlarda true. */
export async function needsMfaStep(): Promise<boolean> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  return !!data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2'
}

/* ── Tarayıcı deposu temizliği ──────────────────────────────────────────────
   Paylaşılan cihaz sertleştirmesi: TÜM tarayıcı deposu silinir, böylece hiçbir
   şey (zustand-persist anahtarları,
   ft_last_uid, fintrack.lastSyncUserId, fintrack.activeWorkspaceId ve özellikle
   `fintrack.brandDomain.v1` — ki anahtarları KULLANICININ İŞLEM AÇIKLAMALARIDIR)
   bir sonraki kullanıcıya sızmaz. Kişisel bir finans uygulamasında çıkıştan
   sağ çıkması gereken hiçbir uygulama anahtarı yoktur; tuttuğumuz tek şey
   cihaz seviyesindeki, kiracıdan bağımsız tema tercihidir.

   Ayrı bir fonksiyon olmasının sebebi: sync engine'deki guardUserSwitch() de
   bunu çağırıyor. O, ikinci savunma katmanı olarak Dexie'yi temizliyordu ama
   localStorage'ı clearLocalData'ya devrediyordu — oysa "kayıt olup çıkmadan
   kapat, sonra başkası giriş yapar" akışında clearLocalData hiç çalışmıyor.
   (Güvenlik denetimi 2026-08-29, bulgu F3.) */

/** Cihaz seviyesinde, kiracıdan bağımsız olduğu için korunan anahtarlar. */
const DEVICE_KEYS = ['fintrack-theme'] as const

/** localStorage + sessionStorage'ı temizler, cihaz tercihlerini geri yazar.
 *  Depo kapalıysa (private mode, storage engelli) sessizce hiçbir şey yapmaz. */
export function clearBrowserStorage(): void {
  if (typeof window === 'undefined') return
  try {
    const keep: [string, string][] = []
    for (const k of DEVICE_KEYS) {
      const v = localStorage.getItem(k)
      if (v !== null) keep.push([k, v])
    }
    localStorage.clear()
    sessionStorage.clear()
    for (const [k, v] of keep) localStorage.setItem(k, v)
  } catch {
    /* storage kapalı/dolu — temizlenecek kalıcı bir şey de yok demektir */
  }
}

export async function clearLocalData(): Promise<void> {
  // SIRA ÖNEMLİ — storage ÖNCE, Dexie SONRA.
  // Eskiden tersiydi: Dexie temizliği reddederse (başka bir sekme DB'yi tutuyor,
  // versiyon yükseltmesi bloklanmış) `await Promise.all(...)` fırlatıyor ve
  // localStorage.clear() satırına HİÇ ulaşılmıyordu. Çağıranlar hatayı yutup
  // çıkışa devam ettiği için önceki kullanıcının deposu cihazda kalıyordu.
  // (Güvenlik denetimi 2026-08-29, bulgu F3 — ikinci yol.)
  clearBrowserStorage()

  await Promise.all([
    db.accounts.clear(),
    db.transactions.clear(),
    db.categories.clear(),
    db.budgets.clear(),
    db.debts.clear(),
    db.investmentTransactions.clear(),
    db.people.clear(),
    db.recurringTransactions.clear(),
    db.workspaces.clear(),
    db.paymentPlans.clear(),
    db.paymentOccurrences.clear(),
    db._outbox.clear(), // drop pending mutations on a full local reset
  ])
}
