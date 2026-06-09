-- Category / sub-category defaults for net-real factor and coupon fields.
-- SKU overrides live on product_pricing (null = inherit from scope).

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

alter table public.product_pricing
  add column if not exists net_real_factor numeric(8, 6),
  add column if not exists coupon_value numeric(14, 2),
  add column if not exists coupon_support_pct numeric(8, 6);

comment on column public.product_pricing.net_real_factor is
  'SKU override for net-real multiplier (null = inherit sub-category/category/workspace default).';
comment on column public.product_pricing.coupon_value is
  'SKU override coupon face value (null = inherit scope default).';
comment on column public.product_pricing.coupon_support_pct is
  'SKU override coupon support fraction (null = inherit scope default).';
