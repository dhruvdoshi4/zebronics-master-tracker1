-- Karan (personal_audio) vs Hari (monitor_projector) on shared amazon/flipkart tables.
--
-- If you get: ERROR 42501: must be owner of table uploads
--   → Use "Option A" (Table Editor) below, OR ask the Supabase project owner to run this file.
--   → Uploads still work WITHOUT this migration (app uses upload notes as fallback).
--
-- Option A — Supabase Dashboard (no ALTER permission needed on your account):
--   1. Table Editor → uploads → Insert column: catalog_workspace, type text, default monitor_projector, not null
--   2. Table Editor → product_master → same column
--   3. (Optional) Database → Constraints: allow only monitor_projector | personal_audio
--
-- Option B — Project owner runs this in SQL Editor (as postgres):

alter table public.uploads
  add column if not exists catalog_workspace text not null default 'monitor_projector';

alter table public.uploads drop constraint if exists uploads_catalog_workspace_check;
alter table public.uploads add constraint uploads_catalog_workspace_check
  check (catalog_workspace in ('monitor_projector', 'personal_audio'));

alter table public.product_master
  add column if not exists catalog_workspace text not null default 'monitor_projector';

alter table public.product_master drop constraint if exists product_master_catalog_workspace_check;
alter table public.product_master add constraint product_master_catalog_workspace_check
  check (catalog_workspace in ('monitor_projector', 'personal_audio'));

create index if not exists uploads_marketplace_workspace_idx
  on public.uploads (marketplace, catalog_workspace, uploaded_at desc);

create index if not exists product_master_marketplace_workspace_idx
  on public.product_master (marketplace, catalog_workspace);
