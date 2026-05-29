-- Current in-progress FY sellout total from master column (e.g. Amazon "FY 2026-27 SO").
alter table public.computed_metrics
  add column if not exists current_fy_so_units numeric(14,2) not null default 0;
