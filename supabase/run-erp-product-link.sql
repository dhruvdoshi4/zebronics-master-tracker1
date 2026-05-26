-- Run in Supabase SQL Editor if migration 018 was not applied via CLI.

create table if not exists public.erp_product_link (
  erp_product_id text primary key,
  asin text not null default '',
  fsn text not null default '',
  model_name text not null default '',
  last_upload_id uuid references public.uploads(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists erp_product_link_asin_idx
  on public.erp_product_link (upper(asin))
  where asin <> '';

create index if not exists erp_product_link_updated_idx
  on public.erp_product_link (updated_at desc);

alter table public.erp_product_link enable row level security;

drop policy if exists erp_product_link_read_policy on public.erp_product_link;
create policy erp_product_link_read_policy on public.erp_product_link
  for select to authenticated using (true);

drop policy if exists erp_product_link_write_policy on public.erp_product_link;
create policy erp_product_link_write_policy on public.erp_product_link
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
