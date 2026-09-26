import { createClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { clearLocalData } from './auth'
import { removeAllReceipts } from './receipts'

/* ── Hesap yaşam döngüsü (Ayarlar → Hesap) ───────────────────────────────────
   Şifre/e-posta değiştirme ve hesap silme gibi geri dönüşü zor işlemler, kilidi
   açık bırakılmış bir cihazda başkası yapamasın diye MEVCUT şifreyi ister. */

/** Mevcut şifreyi, açık oturuma DOKUNMADAN doğrular: ayrı, kalıcı olmayan bir
 *  istemciyle giriş denenir ve açılan geçici oturum hemen kapatılır. Ana
 *  istemcide signInWithPassword kullanmak aal2 oturumunu aal1'e düşürürdü. */
export async function verifyCurrentPassword(email: string, password: string): Promise<boolean> {
  const probe = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'fintrack-password-probe',
      },
    },
  )
  const { error } = await probe.auth.signInWithPassword({ email, password })
  if (error) return false
  await probe.auth.signOut({ scope: 'local' })
  return true
}

/** Hesabı ve buluttaki TÜM verisini kalıcı olarak siler (0013 →
 *  delete_my_account), ardından cihazdaki kalıntıyı temizleyip giriş
 *  sayfasına HARD navigasyon yapar. Başarısızlıkta hiçbir şey silinmemiştir. */
export async function deleteMyAccount(): Promise<void> {
  // Fiş dosyaları ÖNCE: delete_my_account SQL'den Storage'ı silemez; hesap
  // gittikten sonra bu dosyalara kimse erişip silemezdi (0019).
  try {
    await removeAllReceipts()
  } catch (err) {
    console.error('[account:delete:receipts]', err)
    throw new Error('Fiş dosyaları silinemedi — hesabınız silinmedi, tekrar deneyin.')
  }

  const { error } = await supabase.rpc('delete_my_account')
  if (error) {
    // PGRST202: fonksiyon yok → migration henüz uygulanmamış
    throw new Error(error.code === 'PGRST202'
      ? 'Sunucu tarafı hazır değil (0013 migration uygulanmamış). Hiçbir veri silinmedi.'
      : 'Hesap silinemedi. Hiçbir veri silinmedi.')
  }

  try {
    await clearLocalData()
  } catch (err) {
    console.error('[account:delete:clearLocalData]', err)
  }
  try {
    // Kullanıcı artık yok: global çıkış sunucuda hata verir, yalnız yerel oturum
    await supabase.auth.signOut({ scope: 'local' })
  } catch (err) {
    console.error('[account:delete:signOut]', err)
  } finally {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- bilinçli HARD reload: bellekteki store'lar silinen hesabın verisini taşır
    window.location.assign('/login')
  }
}
