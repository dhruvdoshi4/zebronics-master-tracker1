-- Diagnose why "Sell out (latest date column)" is 0 on Zepto / QCom dashboards.
-- Run in Supabase → SQL Editor. Expected for 18 May 2026 master: zepto daily sum ≈ 4614.

-- ── 1) Required enum values (upload fails without these) ─────────────────────
select enumlabel as marketplace_type
from pg_enum e
join pg_type t on t.oid = e.enumtypid
where t.typname = 'marketplace_type'
order by 1;

-- ── 2) Required columns ───────────────────────────────────────────────────────
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'computed_metrics'
  and column_name in ('upload_id', 'latest_day_so_units', 'may_mtd_units')
order by column_name;

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'uploads'
  and column_name = 'upload_kind';

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'product_master'
  and column_name = 'listing_code';

-- ── 3) Latest Zepto upload ────────────────────────────────────────────────────
select
  id,
  status,
  upload_kind,
  snapshot_date,
  uploaded_at,
  valid_row_count,
  left(notes, 120) as notes_preview
from public.uploads
where marketplace = 'zepto'
order by uploaded_at desc
limit 3;

-- notes should contain JSON like: {"latestDaySellout":{"saleDate":"2026-05-18","totalUnits":4614}}
-- (only after re-upload with the latest app build)

-- ── 4) Daily sellout for latest snapshot (KPI reads this) ───────────────────
with latest as (
  select id, snapshot_date
  from public.uploads
  where marketplace = 'zepto'
    and status = 'completed'
  order by uploaded_at desc
  limit 1
)
select
  l.snapshot_date,
  ds.sale_date,
  count(*) as row_count,
  round(sum(ds.units_sold)::numeric, 0) as total_units
from latest l
left join public.daily_sales ds
  on ds.marketplace = 'zepto'
 and ds.upload_id = l.id
 and ds.sale_date = l.snapshot_date
group by l.snapshot_date, ds.sale_date;

-- PASS: total_units ≈ 4614 for sale_date = snapshot_date (e.g. 2026-05-18)
-- FAIL: row_count = 0 → re-upload master after running migrations + latest app

-- ── 5) Sum latest_day_so_units on metrics (new column — run migration 014 first) ─
with latest as (
  select id, snapshot_date
  from public.uploads
  where marketplace = 'zepto'
    and status = 'completed'
  order by uploaded_at desc
  limit 1
)
select
  l.snapshot_date,
  count(cm.*) as metric_rows,
  round(sum(cm.latest_day_so_units)::numeric, 0) as sum_latest_day_so_units,
  round(sum(cm.may_mtd_units)::numeric, 0) as sum_may_mtd
from latest l
join public.computed_metrics cm
  on cm.marketplace = 'zepto'
 and cm.upload_id = l.id
 and cm.as_of_date = l.snapshot_date
group by l.snapshot_date;

-- PASS: sum_latest_day_so_units ≈ 4614 (after migration 014 + re-upload)
-- If column missing: run supabase/migrations/014_computed_metrics_latest_day_so.sql

-- ── 6) Any zepto day-level rows at all? ───────────────────────────────────────
select sale_date, count(*) as rows, round(sum(units_sold)::numeric, 0) as units
from public.daily_sales
where marketplace = 'zepto'
  and sale_date::text not like '%-01'
group by sale_date
order by sale_date desc
limit 10;
