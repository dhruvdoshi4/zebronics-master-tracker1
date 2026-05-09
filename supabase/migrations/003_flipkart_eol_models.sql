-- Normalized model names marked EOL on Flipkart; Amazon ingest excludes matching rows (by model name).
-- Safe to re-run.

create table if not exists public.flipkart_eol_models (
  model_name_normalized text primary key,
  last_seen_at timestamptz not null default now()
);

create index if not exists flipkart_eol_models_last_seen_idx
  on public.flipkart_eol_models (last_seen_at desc);

alter table public.flipkart_eol_models enable row level security;

drop policy if exists flipkart_eol_models_read_policy on public.flipkart_eol_models;
create policy flipkart_eol_models_read_policy
on public.flipkart_eol_models
for select
to authenticated
using (true);

drop policy if exists flipkart_eol_models_write_policy on public.flipkart_eol_models;
create policy flipkart_eol_models_write_policy
on public.flipkart_eol_models
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
