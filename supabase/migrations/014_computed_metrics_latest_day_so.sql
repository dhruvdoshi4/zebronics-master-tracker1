-- Per-SKU units in the latest day column (e.g. 18/May) for dashboard KPIs.
-- Run in Supabase SQL Editor if not using CLI migrations, then re-upload the QCom master.

alter table public.computed_metrics
  add column if not exists latest_day_so_units numeric(14,2) not null default 0;

comment on column public.computed_metrics.latest_day_so_units is
  'Sellout units in the leftmost day column on the channel sheet (e.g. 18/May) for that upload snapshot.';
