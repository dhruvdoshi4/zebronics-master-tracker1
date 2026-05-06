-- Zebronics Master Tracker schema
-- Run in Supabase SQL Editor.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'marketplace_type') then
    create type public.marketplace_type as enum ('amazon', 'flipkart');
  end if;
  if not exists (select 1 from pg_type where typname = 'app_role_type') then
    create type public.app_role_type as enum ('admin', 'viewer');
  end if;
end$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.app_role_type not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create table if not exists public.product_master (
  id bigint generated always as identity primary key,
  marketplace public.marketplace_type not null,
  product_code text not null,
  product_name text not null,
  category text,
  sub_category text,
  brand text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_master_unique unique (marketplace, product_code)
);

drop trigger if exists product_master_set_updated_at on public.product_master;
create trigger product_master_set_updated_at
before update on public.product_master
for each row execute procedure public.set_updated_at();

create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  marketplace public.marketplace_type not null,
  file_name text not null,
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  snapshot_date date not null default (timezone('utc', now()))::date,
  status text not null check (status in ('processing', 'completed', 'failed')),
  raw_row_count integer not null default 0,
  valid_row_count integer not null default 0,
  rejected_row_count integer not null default 0,
  notes text
);

-- Existing databases: add snapshot_date and backfill from uploaded_at (UTC date).
alter table public.uploads add column if not exists snapshot_date date;
update public.uploads
set snapshot_date = (uploaded_at at time zone 'utc')::date
where snapshot_date is null;
alter table public.uploads alter column snapshot_date set default (timezone('utc', now()))::date;
alter table public.uploads alter column snapshot_date set not null;

create table if not exists public.daily_sales (
  id bigint generated always as identity primary key,
  marketplace public.marketplace_type not null,
  product_code text not null,
  sale_date date not null,
  units_sold numeric(14,2) not null default 0,
  sales_value numeric(14,2),
  upload_id uuid references public.uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint daily_sales_unique unique (marketplace, product_code, sale_date)
);

create index if not exists daily_sales_marketplace_date_idx
  on public.daily_sales (marketplace, sale_date);

create table if not exists public.inventory_snapshots (
  id bigint generated always as identity primary key,
  marketplace public.marketplace_type not null,
  product_code text not null,
  snapshot_date date not null,
  inventory_units numeric(14,2) not null default 0,
  unsellable_units numeric(14,2) not null default 0,
  upload_id uuid references public.uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_snapshots_unique unique (marketplace, product_code, snapshot_date)
);

create index if not exists inventory_snapshots_marketplace_date_idx
  on public.inventory_snapshots (marketplace, snapshot_date);

create table if not exists public.computed_metrics (
  id bigint generated always as identity primary key,
  marketplace public.marketplace_type not null,
  product_code text not null,
  as_of_date date not null,
  upload_id uuid references public.uploads(id) on delete set null,
  total_so_units numeric(14,2) not null default 0,
  may_mtd_units numeric(14,2) not null default 0,
  apr_so_units numeric(14,2) not null default 0,
  drr_units numeric(14,2) not null default 0,
  doc_days numeric(14,2) not null default 0,
  inventory_units numeric(14,2) not null default 0,
  purchase_order_units numeric(14,2) not null default 0,
  generated_at timestamptz not null default now(),
  constraint computed_metrics_unique unique (marketplace, product_code, as_of_date)
);

alter table public.computed_metrics add column if not exists upload_id uuid references public.uploads(id) on delete set null;

create index if not exists computed_metrics_marketplace_date_idx
  on public.computed_metrics (marketplace, as_of_date desc);

create index if not exists computed_metrics_upload_id_idx
  on public.computed_metrics (upload_id);

create table if not exists public.ingestion_errors (
  id bigint generated always as identity primary key,
  upload_id uuid not null references public.uploads(id) on delete cascade,
  row_number integer not null,
  reason text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists ingestion_errors_unique_idx
  on public.ingestion_errors (upload_id, row_number, reason);

create or replace view public.latest_metrics as
select distinct on (marketplace, product_code)
  marketplace,
  product_code,
  as_of_date,
  total_so_units,
  may_mtd_units,
  apr_so_units,
  drr_units,
  doc_days,
  inventory_units,
  purchase_order_units
from public.computed_metrics
order by marketplace, product_code, as_of_date desc, generated_at desc;

alter table public.profiles enable row level security;
alter table public.product_master enable row level security;
alter table public.uploads enable row level security;
alter table public.daily_sales enable row level security;
alter table public.inventory_snapshots enable row level security;
alter table public.computed_metrics enable row level security;
alter table public.ingestion_errors enable row level security;

drop policy if exists profiles_read_policy on public.profiles;
create policy profiles_read_policy
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_policy on public.profiles;
create policy profiles_update_policy
on public.profiles
for update
to authenticated
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists product_master_read_policy on public.product_master;
create policy product_master_read_policy
on public.product_master
for select
to authenticated
using (true);

drop policy if exists product_master_write_policy on public.product_master;
create policy product_master_write_policy
on public.product_master
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists uploads_read_policy on public.uploads;
create policy uploads_read_policy
on public.uploads
for select
to authenticated
using (true);

drop policy if exists uploads_write_policy on public.uploads;
create policy uploads_write_policy
on public.uploads
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists daily_sales_read_policy on public.daily_sales;
create policy daily_sales_read_policy
on public.daily_sales
for select
to authenticated
using (true);

drop policy if exists daily_sales_write_policy on public.daily_sales;
create policy daily_sales_write_policy
on public.daily_sales
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists inventory_read_policy on public.inventory_snapshots;
create policy inventory_read_policy
on public.inventory_snapshots
for select
to authenticated
using (true);

drop policy if exists inventory_write_policy on public.inventory_snapshots;
create policy inventory_write_policy
on public.inventory_snapshots
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists computed_metrics_read_policy on public.computed_metrics;
create policy computed_metrics_read_policy
on public.computed_metrics
for select
to authenticated
using (true);

drop policy if exists computed_metrics_write_policy on public.computed_metrics;
create policy computed_metrics_write_policy
on public.computed_metrics
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists ingestion_errors_read_policy on public.ingestion_errors;
create policy ingestion_errors_read_policy
on public.ingestion_errors
for select
to authenticated
using (public.is_admin());

drop policy if exists ingestion_errors_write_policy on public.ingestion_errors;
create policy ingestion_errors_write_policy
on public.ingestion_errors
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.latest_metrics to authenticated;

-- Storage bucket for product image uploads.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read
on storage.objects
for select
to public
using (bucket_id = 'product-images');

drop policy if exists product_images_admin_insert on storage.objects;
create policy product_images_admin_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists product_images_admin_update on storage.objects;
create policy product_images_admin_update
on storage.objects
for update
to authenticated
using (bucket_id = 'product-images' and public.is_admin())
with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists product_images_admin_delete on storage.objects;
create policy product_images_admin_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'product-images' and public.is_admin());

