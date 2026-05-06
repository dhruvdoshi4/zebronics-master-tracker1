-- Links each metric row to the upload that created it so "delete upload" removes the right rows.
-- Run after 001. Safe to re-run (IF NOT EXISTS).

alter table public.computed_metrics
  add column if not exists upload_id uuid references public.uploads(id) on delete set null;

create index if not exists computed_metrics_upload_id_idx
  on public.computed_metrics (upload_id);
