-- Prior-year same-period MTD from master column (e.g. **2025 May MTD** when report is May 2026).
alter table public.computed_metrics
  add column if not exists prior_year_mtd_units numeric(14,2) not null default 0;
