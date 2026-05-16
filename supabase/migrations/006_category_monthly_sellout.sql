-- Category MoM/FY: one row per upload × sub-category × calendar month (from sheet columns Apr-25, May-25, …).

create table if not exists public.category_monthly_sellout (
  id bigint generated always as identity primary key,
  upload_id uuid not null references public.uploads(id) on delete cascade,
  marketplace public.marketplace_type not null,
  sub_category text not null,
  month_ym text not null,
  units_sold numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  constraint category_monthly_sellout_unique unique (upload_id, marketplace, sub_category, month_ym)
);

create index if not exists category_monthly_sellout_lookup_idx
  on public.category_monthly_sellout (marketplace, sub_category, month_ym);

alter table public.category_monthly_sellout enable row level security;

drop policy if exists category_monthly_sellout_read_policy on public.category_monthly_sellout;
create policy category_monthly_sellout_read_policy
on public.category_monthly_sellout
for select
to authenticated
using (true);

drop policy if exists category_monthly_sellout_write_policy on public.category_monthly_sellout;
create policy category_monthly_sellout_write_policy
on public.category_monthly_sellout
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
