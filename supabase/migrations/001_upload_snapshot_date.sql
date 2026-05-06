-- Run once on projects created before snapshot_date was added to public.uploads.
-- Safe to re-run: IF NOT EXISTS / only updates null snapshot_date.

alter table public.uploads add column if not exists snapshot_date date;

update public.uploads
set snapshot_date = (uploaded_at at time zone 'utc')::date
where snapshot_date is null;

alter table public.uploads alter column snapshot_date set default (timezone('utc', now()))::date;

alter table public.uploads alter column snapshot_date set not null;
