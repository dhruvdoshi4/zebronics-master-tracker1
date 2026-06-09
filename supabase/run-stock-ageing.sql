-- Run in Supabase SQL Editor (Dashboard → SQL → New query).
-- Enables admin stock ageing uploads (Consolidated sheet → rolled-up Prdcode buckets).

alter table public.uploads drop constraint if exists uploads_upload_kind_check;
alter table public.uploads add constraint uploads_upload_kind_check
  check (upload_kind in ('sellout', 'bau', 'gms_plan', 'ho_stock', 'ratings_ranking', 'stock_ageing'));

create table if not exists public.stock_ageing_snapshot (
  id bigint generated always as identity primary key,
  upload_id uuid not null references public.uploads(id) on delete cascade,
  prdcode text not null,
  model_name text not null default '',
  total_qty numeric(14, 2) not null default 0,
  qty_0_90 numeric(14, 2) not null default 0,
  qty_91_180 numeric(14, 2) not null default 0,
  qty_181_365 numeric(14, 2) not null default 0,
  qty_365_plus numeric(14, 2) not null default 0,
  constraint stock_ageing_snapshot_upload_prdcode unique (upload_id, prdcode)
);

create index if not exists stock_ageing_snapshot_upload_idx
  on public.stock_ageing_snapshot (upload_id);

create index if not exists stock_ageing_snapshot_prdcode_idx
  on public.stock_ageing_snapshot (prdcode);

alter table public.stock_ageing_snapshot enable row level security;

drop policy if exists stock_ageing_snapshot_read_policy on public.stock_ageing_snapshot;
create policy stock_ageing_snapshot_read_policy on public.stock_ageing_snapshot
  for select to authenticated using (true);

drop policy if exists stock_ageing_snapshot_write_policy on public.stock_ageing_snapshot;
create policy stock_ageing_snapshot_write_policy on public.stock_ageing_snapshot
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
