-- Per-user data isolation (default = Hari/Ram/main; dawg = daWg gaming workspace).
-- Uses text + check (not a custom enum) so this runs in Supabase SQL Editor without CREATE TYPE permissions.

alter table public.profiles
  add column if not exists data_scope text not null default 'default';

alter table public.profiles
  drop constraint if exists profiles_data_scope_check;

alter table public.profiles
  add constraint profiles_data_scope_check
  check (data_scope in ('default', 'dawg'));

alter table public.uploads
  add column if not exists data_scope text not null default 'default';

alter table public.uploads
  drop constraint if exists uploads_data_scope_check;

alter table public.uploads
  add constraint uploads_data_scope_check
  check (data_scope in ('default', 'dawg'));

create index if not exists uploads_data_scope_kind_idx
  on public.uploads (data_scope, upload_kind, uploaded_at desc);

create index if not exists uploads_data_scope_marketplace_idx
  on public.uploads (data_scope, marketplace, uploaded_at desc);

create or replace function public.current_data_scope()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.data_scope from public.profiles p where p.id = auth.uid()),
    'default'
  );
$$;

-- uploads
drop policy if exists uploads_read_policy on public.uploads;
create policy uploads_read_policy
on public.uploads
for select
to authenticated
using (data_scope = public.current_data_scope());

drop policy if exists uploads_write_policy on public.uploads;
create policy uploads_write_policy
on public.uploads
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists uploads_insert_scoped_policy on public.uploads;
create policy uploads_insert_scoped_policy
on public.uploads
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and data_scope = public.current_data_scope()
);

drop policy if exists uploads_update_scoped_policy on public.uploads;
create policy uploads_update_scoped_policy
on public.uploads
for update
to authenticated
using (
  uploaded_by = auth.uid()
  and data_scope = public.current_data_scope()
)
with check (
  uploaded_by = auth.uid()
  and data_scope = public.current_data_scope()
);

create or replace function public.upload_belongs_to_current_user_scope(p_upload_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.uploads u
    where u.id = p_upload_id
      and u.uploaded_by = auth.uid()
      and u.data_scope = public.current_data_scope()
  );
$$;

drop policy if exists daily_sales_write_policy on public.daily_sales;
create policy daily_sales_write_policy
on public.daily_sales
for all
to authenticated
using (public.is_admin())
with check (
  public.is_admin()
  or public.upload_belongs_to_current_user_scope(upload_id)
);

drop policy if exists inventory_write_policy on public.inventory_snapshots;
create policy inventory_write_policy
on public.inventory_snapshots
for all
to authenticated
using (public.is_admin())
with check (
  public.is_admin()
  or public.upload_belongs_to_current_user_scope(upload_id)
);

drop policy if exists computed_metrics_write_policy on public.computed_metrics;
create policy computed_metrics_write_policy
on public.computed_metrics
for all
to authenticated
using (public.is_admin())
with check (
  public.is_admin()
  or public.upload_belongs_to_current_user_scope(upload_id)
);

drop policy if exists ingestion_errors_write_policy on public.ingestion_errors;
create policy ingestion_errors_write_policy
on public.ingestion_errors
for all
to authenticated
using (public.is_admin())
with check (
  public.is_admin()
  or public.upload_belongs_to_current_user_scope(upload_id)
);

drop policy if exists category_monthly_sellout_write_policy on public.category_monthly_sellout;
create policy category_monthly_sellout_write_policy
on public.category_monthly_sellout
for all
to authenticated
using (public.is_admin())
with check (
  public.is_admin()
  or public.upload_belongs_to_current_user_scope(upload_id)
);

drop policy if exists ho_stock_snapshot_write_policy on public.ho_stock_snapshot;
create policy ho_stock_snapshot_write_policy
on public.ho_stock_snapshot
for all
to authenticated
using (public.is_admin())
with check (
  public.is_admin()
  or public.upload_belongs_to_current_user_scope(upload_id)
);

-- Child tables: rows tied to an upload in the same scope (legacy null upload_id = default users only).
drop policy if exists daily_sales_read_policy on public.daily_sales;
create policy daily_sales_read_policy
on public.daily_sales
for select
to authenticated
using (
  (
    public.current_data_scope() = 'default'
    and upload_id is null
  )
  or exists (
    select 1 from public.uploads u
    where u.id = daily_sales.upload_id
      and u.data_scope = public.current_data_scope()
  )
);

drop policy if exists inventory_snapshots_read_policy on public.inventory_snapshots;
create policy inventory_snapshots_read_policy
on public.inventory_snapshots
for select
to authenticated
using (
  (
    public.current_data_scope() = 'default'
    and upload_id is null
  )
  or exists (
    select 1 from public.uploads u
    where u.id = inventory_snapshots.upload_id
      and u.data_scope = public.current_data_scope()
  )
);

drop policy if exists computed_metrics_read_policy on public.computed_metrics;
create policy computed_metrics_read_policy
on public.computed_metrics
for select
to authenticated
using (
  (
    public.current_data_scope() = 'default'
    and upload_id is null
  )
  or exists (
    select 1 from public.uploads u
    where u.id = computed_metrics.upload_id
      and u.data_scope = public.current_data_scope()
  )
);

drop policy if exists category_monthly_sellout_read_policy on public.category_monthly_sellout;
create policy category_monthly_sellout_read_policy
on public.category_monthly_sellout
for select
to authenticated
using (
  exists (
    select 1 from public.uploads u
    where u.id = category_monthly_sellout.upload_id
      and u.data_scope = public.current_data_scope()
  )
);

drop policy if exists ho_stock_snapshot_read_policy on public.ho_stock_snapshot;
create policy ho_stock_snapshot_read_policy
on public.ho_stock_snapshot
for select
to authenticated
using (
  exists (
    select 1 from public.uploads u
    where u.id = ho_stock_snapshot.upload_id
      and u.data_scope = public.current_data_scope()
  )
);
