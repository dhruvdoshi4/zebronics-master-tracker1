-- =============================================================================
-- Flipkart sellout — monthly accuracy audit (Supabase SQL Editor)
-- =============================================================================
--
-- Why this exists
-- --------------
-- Monthly shapes for Flipkart consolidated files are computed at **upload time**
-- in the app (`src/parsers.ts`): Excel-serial columns → max per calendar month;
-- `Apr-25`-style columns → summed. PostgreSQL cannot “re-walk” the raw Excel,
-- so if old bad rows exist you must **re-upload** after deploying parser fixes.
--
-- This suite is **read-only**: it surfaces mismatches so you can re-upload or
-- investigate — it does not auto-correct numeric fiction.
--
-- How to run
-- ----------
-- 1) Replace `YOUR_WORKSPACE_HERE` everywhere below (same value in each block),
--    e.g. `rithika_it_gaming`, `monitor_projector`, `roma_powerbank`.
-- 2) Run section by section or the whole script in SQL Editor.
--
-- Operational habit
-- -----------------
-- After each Flipkart sellout deployment or template change from Flipkart side,
-- run section B on the affected workspace weekly (or automate via Scheduled
-- Supabase Edge Function invoking similar SQL via RPC if you expose one).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- A) Context — latest completed Flipkart upload for the workspace
-- ---------------------------------------------------------------------------
select
  u.id as upload_id,
  u.snapshot_date,
  u.uploaded_at,
  u.file_name,
  u.catalog_workspace
from public.uploads u
where u.marketplace = 'flipkart'
  and u.status = 'completed'
  and coalesce(u.catalog_workspace, '') = 'YOUR_WORKSPACE_HERE'
order by u.uploaded_at desc
limit 1;


-- ---------------------------------------------------------------------------
-- B) Prior-FY anomalies (per SKU) for LATEST Flipkart upload in workspace
--
-- Uses Indian FY anchored to snapshot_date of that upload.
-- Flags:
--   missing_months — prior_fy_so_units > 0 but no daily_sales rows in prior FY window
--   sum_mismatch   — summed monthly units differ from KPI by > 2%
--   flat_shape     — >=10 months populated and almost identical (FY÷12 pattern)
-- ---------------------------------------------------------------------------
with params as (
  select 'YOUR_WORKSPACE_HERE'::text as ws
),
latest as (
  select u.id as upload_id, u.snapshot_date
  from public.uploads u
  cross join params p
  where u.marketplace = 'flipkart'
    and u.status = 'completed'
    and coalesce(u.catalog_workspace, '') = p.ws
  order by u.uploaded_at desc
  limit 1
),
fy_anchor as (
  select
    l.upload_id,
    l.snapshot_date,
    case
      when extract(month from l.snapshot_date) >= 4
      then extract(year from l.snapshot_date)::int
      else extract(year from l.snapshot_date)::int - 1
    end as current_fy_start
  from latest l
),
fy as (
  select
    f.upload_id,
    f.snapshot_date,
    f.current_fy_start,
    f.current_fy_start - 1 as prior_fy_start
  from fy_anchor f
),
prior_window as (
  select
    f.prior_fy_start,
    gs::date as month_start
  from fy f
  cross join lateral generate_series(
    make_date(f.prior_fy_start, 4, 1),
    make_date(f.prior_fy_start + 1, 3, 1),
    interval '1 month'
  ) as gs
),
cm_scope as (
  select
    upper(trim(cm.product_code)) as product_code_norm,
    cm.product_code,
    cm.prior_fy_so_units
  from public.computed_metrics cm
  cross join fy
  where cm.upload_id = fy.upload_id
    and cm.marketplace = 'flipkart'
),
ds_scope as (
  select
    upper(trim(ds.product_code)) as product_code_norm,
    date_trunc('month', ds.sale_date)::date as month_start,
    sum(ds.units_sold)::numeric as units
  from public.daily_sales ds
  cross join fy
  where ds.upload_id = fy.upload_id
    and ds.marketplace = 'flipkart'
  group by upper(trim(ds.product_code)), date_trunc('month', ds.sale_date)::date
),
rolled as (
  select
    c.product_code,
    c.prior_fy_so_units::numeric as prior_fy_kpi,
    coalesce(
      sum(d.units) filter (where d.month_start in (select month_start from prior_window)),
      0
    )::numeric as prior_fy_month_sum,
    count(d.units) filter (
      where d.month_start in (select month_start from prior_window) and coalesce(d.units, 0) > 0
    )::int as prior_fy_months_populated,
    min(d.units) filter (
      where d.month_start in (select month_start from prior_window) and coalesce(d.units, 0) > 0
    ) as min_nonzero,
    max(d.units) filter (
      where d.month_start in (select month_start from prior_window) and coalesce(d.units, 0) > 0
    ) as max_nonzero
  from cm_scope c
  left join ds_scope d on d.product_code_norm = c.product_code_norm
  where coalesce(c.prior_fy_so_units, 0) > 0
  group by c.product_code, c.prior_fy_so_units
)
select
  r.product_code,
  r.prior_fy_kpi,
  r.prior_fy_month_sum,
  r.prior_fy_months_populated,
  case
    when r.prior_fy_month_sum = 0 then 'missing_months'
    when r.prior_fy_month_sum < r.prior_fy_kpi * 0.98
      or r.prior_fy_month_sum > r.prior_fy_kpi * 1.02
      then 'sum_mismatch'
    when r.prior_fy_months_populated >= 10
      and coalesce(r.max_nonzero, 0) > 0
      and (r.max_nonzero - r.min_nonzero) <= greatest(1::numeric, r.max_nonzero * 0.02)
      then 'flat_shape'
    else 'ok'
  end as health
from rolled r
where case
    when r.prior_fy_month_sum = 0 then 'missing_months'
    when r.prior_fy_month_sum < r.prior_fy_kpi * 0.98
      or r.prior_fy_month_sum > r.prior_fy_kpi * 1.02
      then 'sum_mismatch'
    when r.prior_fy_months_populated >= 10
      and coalesce(r.max_nonzero, 0) > 0
      and (r.max_nonzero - r.min_nonzero) <= greatest(1::numeric, r.max_nonzero * 0.02)
      then 'flat_shape'
    else 'ok'
  end <> 'ok'
order by health, r.product_code;


-- ---------------------------------------------------------------------------
-- C) Non–first-of-month sale_date (should be rare for month anchors)
-- ---------------------------------------------------------------------------
with latest as (
  select u.id
  from public.uploads u
  where u.marketplace = 'flipkart'
    and u.status = 'completed'
    and coalesce(u.catalog_workspace, '') = 'YOUR_WORKSPACE_HERE'
  order by u.uploaded_at desc
  limit 1
)
select ds.product_code, ds.sale_date, ds.units_sold, ds.upload_id
from public.daily_sales ds
where ds.upload_id = (select id from latest)
  and ds.marketplace = 'flipkart'
  and extract(day from ds.sale_date) <> 1
order by ds.product_code, ds.sale_date
limit 200;


-- ---------------------------------------------------------------------------
-- D) Category roll-up sanity — compare category_monthly_sellout vs daily_sales
--     for the SAME upload_id (flipkart).
-- Empty result = aligned for that upload (within 5% drift per sub_category+month).
-- ---------------------------------------------------------------------------
with latest as (
  select u.id
  from public.uploads u
  where u.marketplace = 'flipkart'
    and u.status = 'completed'
    and coalesce(u.catalog_workspace, '') = 'YOUR_WORKSPACE_HERE'
  order by u.uploaded_at desc
  limit 1
),
from_table as (
  select cms.sub_category, cms.month_ym::text as month_ym, sum(cms.units_sold)::numeric as u
  from public.category_monthly_sellout cms
  where cms.marketplace = 'flipkart'
    and cms.upload_id = (select id from latest)
  group by cms.sub_category, cms.month_ym
),
from_daily as (
  select
    coalesce(trim(pm.sub_category), '') as sub_category,
    to_char(date_trunc('month', ds.sale_date), 'YYYY-MM') as month_ym,
    sum(ds.units_sold)::numeric as u
  from public.daily_sales ds
  join public.product_master pm
    on pm.marketplace = ds.marketplace
    and pm.product_code = ds.product_code
    and coalesce(pm.catalog_workspace, '') = 'YOUR_WORKSPACE_HERE'
  where ds.marketplace = 'flipkart'
    and ds.upload_id = (select id from latest)
  group by coalesce(trim(pm.sub_category), ''), to_char(date_trunc('month', ds.sale_date), 'YYYY-MM')
),
merged as (
  select
    coalesce(t.sub_category, d.sub_category) as sub_category,
    coalesce(t.month_ym, d.month_ym) as month_ym,
    coalesce(t.u, 0) as table_u,
    coalesce(d.u, 0) as daily_u
  from from_table t
  full outer join from_daily d
    on d.sub_category = t.sub_category
    and d.month_ym = t.month_ym
)
select
  sub_category,
  month_ym,
  round(table_u) as category_monthly_sellout,
  round(daily_u) as daily_sales_rollup,
  case
    when greatest(table_u, daily_u) <= 0 then 0::numeric
    else round(
      abs(table_u - daily_u) / nullif(greatest(table_u, daily_u), 0) * 100,
      2
    )
  end as pct_drift
from merged
where greatest(table_u, daily_u) > 0
  and (
    table_u <= 0
    or daily_u <= 0
    or abs(table_u - daily_u) / greatest(table_u, daily_u) > 0.05
  )
order by pct_drift desc nulls last, sub_category, month_ym;


-- =============================================================================
-- There is no one-off SQL UPDATE that magically fixes inaccurate historical
-- `daily_sales` after a buggy ingest; re-upload Flipkart masters on the patched
-- app so parsers emit correct anchors. Keep this audit on a schedule instead.
-- =============================================================================
