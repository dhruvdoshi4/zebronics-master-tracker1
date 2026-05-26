-- Rithika workspace on shared amazon/flipkart tables.
-- Run in Supabase SQL Editor (project owner) if migration 020 was not applied via CLI.

alter table public.uploads drop constraint if exists uploads_catalog_workspace_check;
alter table public.uploads add constraint uploads_catalog_workspace_check
  check (catalog_workspace in ('monitor_projector', 'personal_audio', 'rithika_it_gaming'));

alter table public.product_master drop constraint if exists product_master_catalog_workspace_check;
alter table public.product_master add constraint product_master_catalog_workspace_check
  check (catalog_workspace in ('monitor_projector', 'personal_audio', 'rithika_it_gaming'));
