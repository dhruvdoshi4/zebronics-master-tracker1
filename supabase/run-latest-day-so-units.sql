-- Required for "Sell out (latest date column)" on QCom dashboards.
-- Run once in Supabase SQL Editor, then re-upload the Quick Commerce master.

alter table public.computed_metrics
  add column if not exists latest_day_so_units numeric(14,2) not null default 0;
