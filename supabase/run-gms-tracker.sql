-- Run in Supabase SQL Editor (after 006_category_monthly_sellout.sql).

alter table public.product_master
  add column if not exists bau_price numeric(14, 2);

comment on column public.product_master.bau_price is
  'Override BAU (INR). When set, replaces submitted BAU for all GMS calculations (current + prior FY).';

alter table public.uploads
  add column if not exists upload_kind text not null default 'sellout';

alter table public.uploads drop constraint if exists uploads_upload_kind_check;
alter table public.uploads add constraint uploads_upload_kind_check
  check (upload_kind in ('sellout', 'bau', 'gms_plan'));

create table if not exists public.product_bau_benchmark (
  id bigint generated always as identity primary key,
  marketplace public.marketplace_type not null,
  product_code text not null,
  bau_price numeric(14, 2) not null default 0,
  upload_id uuid references public.uploads(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint product_bau_benchmark_unique unique (marketplace, product_code)
);

create table if not exists public.gms_plan_monthly (
  id bigint generated always as identity primary key,
  marketplace public.marketplace_type not null,
  product_code text not null,
  month_ym text not null,
  planned_gms numeric(14, 2) not null default 0,
  target_gms numeric(14, 2) not null default 0,
  upload_id uuid references public.uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint gms_plan_monthly_unique unique (marketplace, product_code, month_ym)
);

create index if not exists gms_plan_monthly_lookup_idx
  on public.gms_plan_monthly (marketplace, month_ym);

create table if not exists public.gms_daily_snapshot (
  id bigint generated always as identity primary key,
  marketplace public.marketplace_type not null,
  product_code text not null,
  as_of_date date not null,
  upload_id uuid references public.uploads(id) on delete set null,
  so_units_mtd numeric(14, 3) not null default 0,
  bau_price_used numeric(14, 2) not null default 0,
  gms_inr_mtd numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  constraint gms_daily_snapshot_unique unique (marketplace, product_code, as_of_date)
);

create index if not exists gms_daily_snapshot_lookup_idx
  on public.gms_daily_snapshot (marketplace, as_of_date);

alter table public.product_bau_benchmark enable row level security;
alter table public.gms_plan_monthly enable row level security;
alter table public.gms_daily_snapshot enable row level security;

drop policy if exists product_bau_benchmark_read_policy on public.product_bau_benchmark;
create policy product_bau_benchmark_read_policy on public.product_bau_benchmark
  for select to authenticated using (true);

drop policy if exists product_bau_benchmark_write_policy on public.product_bau_benchmark;
create policy product_bau_benchmark_write_policy on public.product_bau_benchmark
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists gms_plan_monthly_read_policy on public.gms_plan_monthly;
create policy gms_plan_monthly_read_policy on public.gms_plan_monthly
  for select to authenticated using (true);

drop policy if exists gms_plan_monthly_write_policy on public.gms_plan_monthly;
create policy gms_plan_monthly_write_policy on public.gms_plan_monthly
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists gms_daily_snapshot_read_policy on public.gms_daily_snapshot;
create policy gms_daily_snapshot_read_policy on public.gms_daily_snapshot
  for select to authenticated using (true);

drop policy if exists gms_daily_snapshot_write_policy on public.gms_daily_snapshot;
create policy gms_daily_snapshot_write_policy on public.gms_daily_snapshot
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
