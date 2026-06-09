-- Run in Supabase SQL Editor after run-gms-tracker.sql.
-- Product Master pricing (Amazon + Flipkart only).

create table if not exists public.product_pricing (
  id bigint generated always as identity primary key,
  marketplace public.marketplace_type not null,
  product_code text not null,
  catalog_workspace text,
  bau_sp numeric(14, 2) not null default 0,
  bau_margin_pct numeric(8, 6) not null default 0,
  event_sp numeric(14, 2) not null default 0,
  event_margin_pct numeric(8, 6) not null default 0,
  is_flat_price boolean not null default false,
  top_up_ibd numeric(14, 2) not null default 0,
  net_real_factor numeric(8, 6),
  coupon_value numeric(14, 2),
  coupon_support_pct numeric(8, 6),
  upload_id uuid references public.uploads(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint product_pricing_unique unique (marketplace, product_code),
  constraint product_pricing_marketplace_ecom_check
    check (marketplace in ('amazon', 'flipkart'))
);

create index if not exists product_pricing_workspace_idx
  on public.product_pricing (catalog_workspace, marketplace);

alter table public.product_pricing enable row level security;

drop policy if exists product_pricing_read_policy on public.product_pricing;
create policy product_pricing_read_policy on public.product_pricing
  for select to authenticated using (true);

drop policy if exists product_pricing_write_policy on public.product_pricing;
create policy product_pricing_write_policy on public.product_pricing
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Scope defaults (category / sub-category / workspace net-real + coupon).
create table if not exists public.pricing_scope_defaults (
  id bigint generated always as identity primary key,
  catalog_workspace text not null,
  marketplace text not null default 'all',
  scope_level text not null,
  scope_key text not null default '',
  net_real_factor numeric(8, 6),
  coupon_value numeric(14, 2),
  coupon_support_pct numeric(8, 6),
  updated_at timestamptz not null default now(),
  constraint pricing_scope_defaults_unique
    unique (catalog_workspace, marketplace, scope_level, scope_key),
  constraint pricing_scope_defaults_marketplace_check
    check (marketplace in ('amazon', 'flipkart', 'all')),
  constraint pricing_scope_defaults_scope_level_check
    check (scope_level in ('workspace', 'category', 'sub_category'))
);

create index if not exists pricing_scope_defaults_workspace_idx
  on public.pricing_scope_defaults (catalog_workspace, marketplace);

alter table public.pricing_scope_defaults enable row level security;

drop policy if exists pricing_scope_defaults_read_policy on public.pricing_scope_defaults;
create policy pricing_scope_defaults_read_policy on public.pricing_scope_defaults
  for select to authenticated using (true);

drop policy if exists pricing_scope_defaults_write_policy on public.pricing_scope_defaults;
create policy pricing_scope_defaults_write_policy on public.pricing_scope_defaults
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
