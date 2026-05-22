-- 28-day average DRR from master sheet ("28 Days Avg" column) — used for PO projection.
alter table public.computed_metrics
  add column if not exists drr_28d_avg_units numeric(14,2) not null default 0;
