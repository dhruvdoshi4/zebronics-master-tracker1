-- Run in Supabase SQL Editor (after run-gms-tracker.sql).

alter table public.uploads drop constraint if exists uploads_upload_kind_check;
alter table public.uploads add constraint uploads_upload_kind_check
  check (upload_kind in ('sellout', 'bau', 'gms_plan', 'ho_stock'));

create table if not exists public.ho_stock_snapshot (
  id bigint generated always as identity primary key,
  upload_id uuid not null references public.uploads(id) on delete cascade,
  row_key text not null,
  asin text not null default '',
  fsn text not null default '',
  erp_product_id text not null default '',
  model_name text not null,
  blocked_units numeric(14, 2) not null default 0,
  ho_units numeric(14, 2) not null default 0,
  gurgaon_units numeric(14, 2) not null default 0,
  total_units numeric(14, 2) not null default 0,
  constraint ho_stock_snapshot_upload_row unique (upload_id, row_key)
);

create index if not exists ho_stock_snapshot_upload_idx
  on public.ho_stock_snapshot (upload_id);

alter table public.ho_stock_snapshot enable row level security;

drop policy if exists ho_stock_snapshot_read_policy on public.ho_stock_snapshot;
create policy ho_stock_snapshot_read_policy on public.ho_stock_snapshot
  for select to authenticated using (true);

drop policy if exists ho_stock_snapshot_write_policy on public.ho_stock_snapshot;
create policy ho_stock_snapshot_write_policy on public.ho_stock_snapshot
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
