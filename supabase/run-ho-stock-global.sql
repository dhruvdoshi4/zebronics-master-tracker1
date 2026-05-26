-- Run in Supabase SQL Editor so daWg (and all users) share one HO stock report.

drop policy if exists ho_stock_snapshot_read_policy on public.ho_stock_snapshot;
create policy ho_stock_snapshot_read_policy
on public.ho_stock_snapshot
for select
to authenticated
using (
  exists (
    select 1
    from public.uploads u
    where u.id = ho_stock_snapshot.upload_id
      and u.upload_kind = 'ho_stock'
      and u.status = 'completed'
  )
);

drop policy if exists uploads_read_ho_stock_global_policy on public.uploads;
create policy uploads_read_ho_stock_global_policy
on public.uploads
for select
to authenticated
using (upload_kind = 'ho_stock' and status = 'completed');

drop policy if exists uploads_insert_ho_stock_global_policy on public.uploads;
create policy uploads_insert_ho_stock_global_policy
on public.uploads
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and upload_kind = 'ho_stock'
  and data_scope = 'default'
);

drop policy if exists uploads_update_ho_stock_owner_policy on public.uploads;
create policy uploads_update_ho_stock_owner_policy
on public.uploads
for update
to authenticated
using (
  uploaded_by = auth.uid()
  and upload_kind = 'ho_stock'
  and data_scope = 'default'
)
with check (
  uploaded_by = auth.uid()
  and upload_kind = 'ho_stock'
  and data_scope = 'default'
);

drop policy if exists ho_stock_snapshot_write_owner_policy on public.ho_stock_snapshot;
create policy ho_stock_snapshot_write_owner_policy
on public.ho_stock_snapshot
for all
to authenticated
using (
  exists (
    select 1
    from public.uploads u
    where u.id = ho_stock_snapshot.upload_id
      and u.upload_kind = 'ho_stock'
      and u.uploaded_by = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.uploads u
    where u.id = ho_stock_snapshot.upload_id
      and u.upload_kind = 'ho_stock'
      and u.uploaded_by = auth.uid()
  )
);
