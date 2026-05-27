-- Run once in Supabase → SQL Editor (safe to re-run).
-- Required for Pravin sellout KPIs to save and show on the PO dashboard.

-- 1) Workspace tags (if not already applied)
alter table public.uploads drop constraint if exists uploads_catalog_workspace_check;
alter table public.uploads add constraint uploads_catalog_workspace_check
  check (catalog_workspace in (
    'monitor_projector',
    'personal_audio',
    'rithika_it_gaming',
    'roma_powerbank'
  ));

alter table public.product_master drop constraint if exists product_master_catalog_workspace_check;
alter table public.product_master add constraint product_master_catalog_workspace_check
  check (catalog_workspace in (
    'monitor_projector',
    'personal_audio',
    'rithika_it_gaming',
    'roma_powerbank'
  ));

-- 2) Link metrics to uploads (required for dashboard)
alter table public.computed_metrics
  add column if not exists upload_id uuid references public.uploads(id) on delete set null;

create index if not exists computed_metrics_upload_id_idx
  on public.computed_metrics (upload_id);

-- 3) Optional KPI columns (upload may fail or dashboard SELECT may break without these)
alter table public.computed_metrics
  add column if not exists prior_fy_so_units numeric(14,2) not null default 0;

alter table public.computed_metrics
  add column if not exists prior_year_mtd_units numeric(14,2) not null default 0;

alter table public.computed_metrics
  add column if not exists latest_day_so_units numeric(14,2) not null default 0;

-- 4) Quick check after re-upload (replace upload id from Upload Center history if needed)
-- select count(*) from public.computed_metrics where upload_id = 'YOUR_UPLOAD_UUID';
