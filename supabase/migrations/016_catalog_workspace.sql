-- Isolate Hari (monitor/projector) vs Karan (personal audio / auto / home automation) on shared amazon/flipkart keys.

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

comment on column public.uploads.catalog_workspace is
  'monitor_projector = Hari M/P workspace; personal_audio = Karan KAM workspace.';
comment on column public.product_master.catalog_workspace is
  'Same as uploads.catalog_workspace for the SKU owner.';

create index if not exists uploads_marketplace_workspace_idx
  on public.uploads (marketplace, catalog_workspace, uploaded_at desc);

create index if not exists product_master_marketplace_workspace_idx
  on public.product_master (marketplace, catalog_workspace);
