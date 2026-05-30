-- =============================================================================
-- Dashboard KPI schema — run once in Supabase → SQL Editor (safe to re-run).
--
-- This prepares the database so Category Analysis, GMS, PO, and QCom dashboards
-- can read the same sheet columns (FY SO, May MTD, Apr SO, etc.) from uploads.
--
-- IMPORTANT: SQL adds columns only. Sheet numbers are filled when you RE-UPLOAD
-- sellout files AFTER this script (especially FY 2026-27 SO / current_fy_so_units).
-- =============================================================================

-- 1) Workspace tags (all manager dashboards)
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

-- 2) Link metrics to uploads (required for upload-first roll-ups)
alter table public.computed_metrics
  add column if not exists upload_id uuid references public.uploads(id) on delete set null;

create index if not exists computed_metrics_upload_id_idx
  on public.computed_metrics (upload_id);

create index if not exists computed_metrics_marketplace_date_upload_idx
  on public.computed_metrics (marketplace, as_of_date desc, upload_id);

-- 3) Sheet KPI columns on computed_metrics (Category Analysis + dashboards)
alter table public.computed_metrics
  add column if not exists prior_fy_so_units numeric(14,2) not null default 0;

alter table public.computed_metrics
  add column if not exists prior_year_mtd_units numeric(14,2) not null default 0;

alter table public.computed_metrics
  add column if not exists current_fy_so_units numeric(14,2) not null default 0;

alter table public.computed_metrics
  add column if not exists latest_day_so_units numeric(14,2) not null default 0;

alter table public.computed_metrics
  add column if not exists drr_28d_avg_units numeric(14,2) not null default 0;

comment on column public.computed_metrics.prior_fy_so_units is
  'Completed prior FY SO from master (e.g. FY 2025-26 SO).';
comment on column public.computed_metrics.current_fy_so_units is
  'Current in-progress FY SO from master (e.g. FY 2026-27 SO).';
comment on column public.computed_metrics.prior_year_mtd_units is
  'Prior-year same-month MTD (e.g. 2025 May MTD when report is May 2026).';

-- 4) Category MoM table (Flipkart Apr fallback + sub-category month charts)
create table if not exists public.category_monthly_sellout (
  id bigint generated always as identity primary key,
  upload_id uuid not null references public.uploads(id) on delete cascade,
  marketplace public.marketplace_type not null,
  sub_category text not null,
  month_ym text not null,
  units_sold numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  constraint category_monthly_sellout_unique unique (upload_id, marketplace, sub_category, month_ym)
);

create index if not exists category_monthly_sellout_lookup_idx
  on public.category_monthly_sellout (marketplace, sub_category, month_ym);

alter table public.category_monthly_sellout enable row level security;

drop policy if exists category_monthly_sellout_read_policy on public.category_monthly_sellout;
create policy category_monthly_sellout_read_policy
on public.category_monthly_sellout
for select
to authenticated
using (true);

drop policy if exists category_monthly_sellout_write_policy on public.category_monthly_sellout;
create policy category_monthly_sellout_write_policy
on public.category_monthly_sellout
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- =============================================================================
-- 5) VERIFY — run these after the ALTERs (read-only checks)
-- =============================================================================

-- 5a) All KPI columns present?
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'computed_metrics'
  and column_name in (
    'upload_id',
    'may_mtd_units',
    'apr_so_units',
    'prior_fy_so_units',
    'prior_year_mtd_units',
    'current_fy_so_units',
    'latest_day_so_units',
    'drr_28d_avg_units'
  )
order by column_name;
-- Expect 8 rows.

-- 5b) Latest Amazon Hari upload — do KPI columns have data? (zeros = re-upload needed)
select
  u.id as upload_id,
  u.file_name,
  u.snapshot_date,
  u.catalog_workspace,
  count(cm.*) as sku_rows,
  round(sum(cm.prior_fy_so_units)::numeric, 0) as sum_prior_fy_so,
  round(sum(cm.current_fy_so_units)::numeric, 0) as sum_current_fy_so,
  round(sum(cm.may_mtd_units)::numeric, 0) as sum_may_mtd,
  round(sum(cm.apr_so_units)::numeric, 0) as sum_apr_so
from public.uploads u
join public.computed_metrics cm
  on cm.upload_id = u.id
 and cm.marketplace = 'amazon'
where u.marketplace = 'amazon'
  and coalesce(u.catalog_workspace, 'monitor_projector') = 'monitor_projector'
  and coalesce(u.data_scope, 'default') <> 'dawg'
group by u.id, u.file_name, u.snapshot_date, u.catalog_workspace, u.uploaded_at
order by u.uploaded_at desc
limit 3;

-- 5c) Monitors-only spot check (strict sheet filter) on latest Hari Amazon upload
with latest as (
  select u.id as upload_id, u.snapshot_date
  from public.uploads u
  where u.marketplace = 'amazon'
    and coalesce(u.catalog_workspace, 'monitor_projector') = 'monitor_projector'
    and coalesce(u.data_scope, 'default') <> 'dawg'
  order by u.uploaded_at desc
  limit 1
)
select
  count(*) filter (
    where lower(trim(pm.category)) like '%monitor%'
      and lower(trim(pm.category)) like '%acc%'
      and lower(trim(pm.sub_category)) in ('monitor', 'monitors')
  ) as monitor_sku_count,
  round(sum(cm.prior_fy_so_units) filter (
    where lower(trim(pm.category)) like '%monitor%'
      and lower(trim(pm.category)) like '%acc%'
      and lower(trim(pm.sub_category)) in ('monitor', 'monitors')
  )::numeric, 0) as monitor_prior_fy_so,
  round(sum(cm.current_fy_so_units) filter (
    where lower(trim(pm.category)) like '%monitor%'
      and lower(trim(pm.category)) like '%acc%'
      and lower(trim(pm.sub_category)) in ('monitor', 'monitors')
  )::numeric, 0) as monitor_current_fy_so,
  round(sum(cm.may_mtd_units) filter (
    where lower(trim(pm.category)) like '%monitor%'
      and lower(trim(pm.category)) like '%acc%'
      and lower(trim(pm.sub_category)) in ('monitor', 'monitors')
  )::numeric, 0) as monitor_may_mtd,
  round(sum(cm.apr_so_units) filter (
    where lower(trim(pm.category)) like '%monitor%'
      and lower(trim(pm.category)) like '%acc%'
      and lower(trim(pm.sub_category)) in ('monitor', 'monitors')
  )::numeric, 0) as monitor_apr_so
from latest l
join public.computed_metrics cm
  on cm.upload_id = l.upload_id
 and cm.marketplace = 'amazon'
 and cm.as_of_date = l.snapshot_date
join public.product_master pm
  on pm.marketplace = cm.marketplace
 and pm.product_code = cm.product_code;
-- Expected (May 2026 AZ master): ~41 SKUs · 66128 · 11069 · 5562 · 5507
