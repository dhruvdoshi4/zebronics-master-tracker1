-- Rithika IT / gaming / accessories workspace (shared amazon/flipkart with Hari + Karan).

alter table public.uploads drop constraint if exists uploads_catalog_workspace_check;
alter table public.uploads add constraint uploads_catalog_workspace_check
  check (catalog_workspace in ('monitor_projector', 'personal_audio', 'rithika_it_gaming'));

alter table public.product_master drop constraint if exists product_master_catalog_workspace_check;
alter table public.product_master add constraint product_master_catalog_workspace_check
  check (catalog_workspace in ('monitor_projector', 'personal_audio', 'rithika_it_gaming'));

comment on column public.uploads.catalog_workspace is
  'monitor_projector = Hari; personal_audio = Karan; rithika_it_gaming = Rithika.';
comment on column public.product_master.catalog_workspace is
  'Same as uploads.catalog_workspace for the SKU owner.';
