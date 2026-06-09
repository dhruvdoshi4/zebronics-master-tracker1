-- Product Master pricing (Amazon + Flipkart only — not Qcom).
-- Editable: BAU SP, margins, Event SP, event margins, flat price, Top up IBD.
-- Computed columns are derived in app code (src/pricing.ts).

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
  upload_id uuid references public.uploads(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint product_pricing_unique unique (marketplace, product_code),
  constraint product_pricing_marketplace_ecom_check
    check (marketplace in ('amazon', 'flipkart'))
);

create index if not exists product_pricing_workspace_idx
  on public.product_pricing (catalog_workspace, marketplace);

comment on table public.product_pricing is
  'Per-SKU Amazon/Flipkart pricing for Product Master. Qcom excluded. GMS uses product_bau_benchmark separately.';

alter table public.product_pricing enable row level security;

drop policy if exists product_pricing_read_policy on public.product_pricing;
create policy product_pricing_read_policy on public.product_pricing
  for select to authenticated using (true);

drop policy if exists product_pricing_write_policy on public.product_pricing;
create policy product_pricing_write_policy on public.product_pricing
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
