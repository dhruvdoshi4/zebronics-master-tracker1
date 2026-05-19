-- Ratings & ranking — run in Supabase SQL Editor.

alter table public.uploads drop constraint if exists uploads_upload_kind_check;
alter table public.uploads add constraint uploads_upload_kind_check
  check (upload_kind in ('sellout', 'bau', 'gms_plan', 'ho_stock', 'ratings_ranking'));

create table if not exists public.product_ratings_snapshot (
  id bigint generated always as identity primary key,
  upload_id uuid not null references public.uploads(id) on delete cascade,
  marketplace public.marketplace_type not null,
  product_code text not null,
  model_name text not null default '',
  category text not null default '',
  sub_category text not null default '',
  remarks text not null default '',
  review_y numeric(6, 2),
  review_count_y numeric(14, 2),
  rank_y numeric(14, 2),
  review_t numeric(6, 2),
  review_count_t numeric(14, 2),
  rank_t numeric(14, 2),
  cell_labels jsonb not null default '{}'::jsonb,
  snapshot_date date not null,
  constraint product_ratings_snapshot_unique unique (upload_id, marketplace, product_code)
);

create index if not exists product_ratings_snapshot_lookup_idx
  on public.product_ratings_snapshot (marketplace, snapshot_date desc);

create index if not exists product_ratings_snapshot_upload_idx
  on public.product_ratings_snapshot (upload_id);

alter table public.product_ratings_snapshot enable row level security;

drop policy if exists product_ratings_snapshot_read_policy on public.product_ratings_snapshot;
create policy product_ratings_snapshot_read_policy
on public.product_ratings_snapshot for select to authenticated using (true);

drop policy if exists product_ratings_snapshot_write_policy on public.product_ratings_snapshot;
create policy product_ratings_snapshot_write_policy
on public.product_ratings_snapshot for all to authenticated using (true) with check (true);

alter table public.product_ratings_snapshot
  add column if not exists cell_labels jsonb not null default '{}'::jsonb;
