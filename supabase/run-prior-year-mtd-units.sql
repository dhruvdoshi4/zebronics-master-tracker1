-- Run once in Supabase SQL editor before re-uploading sellout (fixes upload error on prior-year MTD).
alter table public.computed_metrics
  add column if not exists prior_year_mtd_units numeric(14,2) not null default 0;
