/* ── Boş kimlik referanslarının temizliği ─────────────────────────────────────
   Supabase'de kimlik kolonları (accountId, categoryId, debtId, …) uuid tipinde.
   Boş string bir uuid DEĞİLDİR: push kalıcı olarak

     invalid input syntax for type uuid: ""

   ile reddedilir. Hata deterministik olduğu için satır sonsuza dek dead-letter'da
   kalır — "Yeniden dene" çözmez, kuyrukta durur ve kullanıcıya "1 kayıt buluta
   senkronlanamıyor" bandı olarak görünür.

   Boş string uygulama tarafında ZATEN "seçilmedi" anlamına gelir: formların
   çoğu kaydederken `|| undefined` ile temizler (bkz. debts/page.tsx:269), ama
   kaçan tek bir alan bütün kuyruğu bloke etmeye yeter. Bu yüzden temizlik tek
   tek çağrı noktalarında değil, PUSH SINIRINDA yapılır: '' → null. Anlam korunur
   (ikisi de "referans yok"), satır geçer.

   Neden enqueue'da değil de push'ta: enqueue'da temizlemek yalnızca BUNDAN SONRA
   yazılan satırları kurtarırdı; kuyrukta hâlihazırda takılı olan satırın anlık
   görüntüsü bozuk kalır ve kullanıcı elle onarmadan asla gitmezdi. Push sınırında
   çalışınca eski takılı satırlar da bir sonraki denemede kendiliğinden düzelir
   (retryDeadLetters her uygulama açılışında sayaçları sıfırlar).

   `id` bilinçli olarak HARİÇ: birincil anahtar null olamaz. Boş `id` taşıyan bir
   satır zaten onarılamaz; null'a çevirmek hatayı "not-null violation"a dönüştürüp
   asıl sorunu gizlerdi — dead-letter'da görünür kalması doğrusu.

   `workspaceId` de kapsama dâhildir ve güvenlidir: getActiveWorkspaceId()
   `string | null` döndürür, hiçbir zaman '' üretmez — dolayısıyla '' ancak bozuk
   bir satırdan gelir ve null ("varsayılan çalışma alanı") doğru okumadır. */

/** Kimlik kolonu adları `…Id` ile biter (accountId, toAccountId, parentId, …). */
const ID_REF = /Id$/

/** Boş string kimlik referanslarını null'a çevirir. Girdi mutasyona uğramaz;
 *  temizlenecek bir şey yoksa aynı nesne referansı döner. */
export function sanitizeIdRefs<T extends Record<string, unknown>>(payload: T): T {
  let dirty = false
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(payload)) {
    if (value === '' && key !== 'id' && ID_REF.test(key)) {
      out[key] = null
      dirty = true
    } else {
      out[key] = value
    }
  }

  return dirty ? (out as T) : payload
}
