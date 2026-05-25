-- Workspace isolation indexes (run after 016_catalog_workspace.sql).
-- App-layer rules: no cross-manager fallbacks; each dashboard uses its own upload_id.

create index if not exists uploads_sellout_workspace_idx
  on public.uploads (marketplace, catalog_workspace, upload_kind, status, uploaded_at desc)
  where upload_kind = 'sellout' and status = 'completed';

create index if not exists computed_metrics_upload_marketplace_idx
  on public.computed_metrics (upload_id, marketplace, product_code);
