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

alter table public.gms_daily_snapshot enable row level security;

drop policy if exists gms_daily_snapshot_read_policy on public.gms_daily_snapshot;
create policy gms_daily_snapshot_read_policy on public.gms_daily_snapshot
  for select to authenticated using (true);

drop policy if exists gms_daily_snapshot_write_policy on public.gms_daily_snapshot;
create policy gms_daily_snapshot_write_policy on public.gms_daily_snapshot
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
