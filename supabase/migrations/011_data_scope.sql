-- Per-user data isolation (default = Hari/Ram/main; dawg = daWg gaming workspace).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'data_scope_type') then
    create type public.data_scope_type as enum ('default', 'dawg');
  end if;
end$$;

alter table public.profiles
  add column if not exists data_scope public.data_scope_type not null default 'default';

alter table public.uploads
  add column if not exists data_scope public.data_scope_type not null default 'default';

create index if not exists uploads_data_scope_kind_idx
  on public.uploads (data_scope, upload_kind, uploaded_at desc);

create index if not exists uploads_data_scope_marketplace_idx
  on public.uploads (data_scope, marketplace, uploaded_at desc);

create or replace function public.current_data_scope()
returns public.data_scope_type
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.data_scope from public.profiles p where p.id = auth.uid()),
    'default'::public.data_scope_type
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

-- Child tables: rows tied to an upload in the same scope (or legacy null upload_id stays default-only).
drop policy if exists daily_sales_read_policy on public.daily_sales;
create policy daily_sales_read_policy
on public.daily_sales
for select
to authenticated
using (
  (
    public.current_data_scope() = 'default'::public.data_scope_type
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
    public.current_data_scope() = 'default'::public.data_scope_type
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
    public.current_data_scope() = 'default'::public.data_scope_type
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
