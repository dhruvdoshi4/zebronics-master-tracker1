-- Run in Supabase SQL Editor if migration 024 is not applied yet.
alter table public.computed_metrics
  add column if not exists current_fy_so_units numeric(14,2) not null default 0;
