-- Paste into Supabase → SQL Editor → Run (safe to run more than once).
-- Rishabh workspace: rishabh@zebronics.com — Home Audio (Amazon + Flipkart).

alter table public.uploads drop constraint if exists uploads_catalog_workspace_check;
alter table public.uploads add constraint uploads_catalog_workspace_check
  check (catalog_workspace in (
    'monitor_projector',
    'personal_audio',
    'rithika_it_gaming',
    'roma_powerbank',
    'home_audio'
  ));

alter table public.product_master drop constraint if exists product_master_catalog_workspace_check;
alter table public.product_master add constraint product_master_catalog_workspace_check
  check (catalog_workspace in (
    'monitor_projector',
    'personal_audio',
    'rithika_it_gaming',
    'roma_powerbank',
    'home_audio'
  ));
