-- ============================================================================
-- 0027 — Hata kayıtlarını kullanıcı KENDİSİ okuyabilsin (Ayarlar → Hata kayıtları)
--
-- 0020 error_logs'u yalnız-ekleme olarak kurmuştu; kayıtlar yalnız Supabase
-- panelinden okunuyordu. Ayarlar'daki kart (src/components/settings/
-- ErrorLogsCard.tsx) kullanıcının KENDİ son 30 günlük hatalarını listeler.
--
-- Yalnız iki şey eklenir: SELECT yetkisi + sahip-yalnız SELECT politikası.
-- Güncelleme/silme yetkisi YOK (kayıtlar 0020'deki tetikleyiciyle 30 günde
-- temizlenir). Paylaşılan çalışma alanı üyeleri birbirinin kaydını görmez.
--
-- Idempotent.
-- ============================================================================

grant select on table public.error_logs to authenticated;

drop policy if exists error_logs_select_own on public.error_logs;
create policy error_logs_select_own on public.error_logs
  for select to authenticated
  using (user_id = (select auth.uid()));
