-- Workspace isolation (Hari monitor_projector vs Karan personal_audio vs daWg data_scope).
-- The app enforces isolation in TypeScript via upload_id + catalog_workspace + data_scope.
-- Run 016_catalog_workspace.sql first if not applied.

comment on table public.uploads is
  'Each sellout/ratings/ho_stock row must belong to one manager workspace (catalog_workspace or data_scope).';

-- Help scoped lookups used by getLatestUploadContextByMarketplace
create index if not exists uploads_sellout_workspace_idx
  on public.uploads (marketplace, catalog_workspace, upload_kind, status, uploaded_at desc)
  where upload_kind = 'sellout' and status = 'completed';

create index if not exists computed_metrics_upload_marketplace_idx
  on public.computed_metrics (upload_id, marketplace, product_code);

-- Optional hardening (not enabled by default): row-level security per JWT claim.
-- Requires custom claim catalog_workspace on auth.users and policies on uploads/product_master/computed_metrics.
-- Contact ops before enabling RLS; the SPA currently uses the anon/authenticated key with app-layer filters.
