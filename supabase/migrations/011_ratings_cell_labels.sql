-- Text from sheet when a cell is not numeric (e.g. "New Launch", "-").

alter table public.product_ratings_snapshot
  add column if not exists cell_labels jsonb not null default '{}'::jsonb;
