-- ============================================================================
-- 0014 — categories.matchKeywords (otomatik kategori kuralları)
--
-- Kategoriye tanımlanan anahtar kelimeler: işlem açıklaması bunlardan birini
-- içerirse kategori formda ve CSV içe aktarmada kendiliğinden seçilir
-- (src/lib/auto-category.ts). Küçük harfli, tekil bir metin dizisi. Kural
-- girilmemiş kategoride sütun NULL kalır — mevcut veriye DOKUNULMAZ.
--
-- ⚠️ Bu migration, kural özelliğini içeren istemci deploy edildikten sonra
-- İLK kural kaydedilmeden ÖNCE çalıştırılmalıdır. İstemci alanı yalnızca
-- kullanıcı bir kategoriye kural girdiğinde yazar (CategoryEditModal), bu
-- yüzden kural kullanmayanların senkronu migration'dan bağımsız çalışır; ama
-- kural girilmiş bir kategori sütun yokken 4xx alıp outbox'ta dead-letter'a
-- düşer (0003 bilezik vakası, 0012'deki aynı uyarı).
--
-- NOT: restore_user_backup sütun listesini 0009'dan beri şemadan türetiyor,
-- bu yüzden yedek/geri yükleme tarafında ek bir değişiklik GEREKMEZ.
-- Idempotent: tekrar çalıştırmak güvenlidir.
-- ============================================================================

alter table public.categories
  add column if not exists "matchKeywords" text[];
