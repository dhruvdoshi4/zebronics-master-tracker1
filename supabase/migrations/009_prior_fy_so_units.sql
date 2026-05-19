-- Prior completed FY sellout total from master column (e.g. Flipkart "FY 2025-26 SO").
alter table public.computed_metrics
  add column if not exists prior_fy_so_units numeric(14,2) not null default 0;
