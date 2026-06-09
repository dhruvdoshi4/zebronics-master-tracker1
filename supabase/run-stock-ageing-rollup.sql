-- Run in Supabase SQL Editor if you already ran the original stock ageing SQL
-- (with qty_0_30, qty_31_90, … columns). Migrates to rolled-up buckets.

alter table public.stock_ageing_snapshot
  add column if not exists qty_0_90 numeric(14, 2) not null default 0,
  add column if not exists qty_181_365 numeric(14, 2) not null default 0,
  add column if not exists qty_365_plus numeric(14, 2) not null default 0;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_ageing_snapshot' and column_name = 'qty_0_30'
  ) then
    update public.stock_ageing_snapshot set
      qty_0_90 = coalesce(qty_0_30, 0) + coalesce(qty_31_90, 0),
      qty_91_180 = coalesce(qty_91_180, 0),
      qty_181_365 = coalesce(qty_181_270, 0) + coalesce(qty_271_365, 0),
      qty_365_plus = coalesce(qty_366_547, 0) + coalesce(qty_547_plus, 0);

    alter table public.stock_ageing_snapshot
      drop column if exists qty_0_30,
      drop column if exists qty_31_90,
      drop column if exists qty_181_270,
      drop column if exists qty_271_365,
      drop column if exists qty_366_547,
      drop column if exists qty_547_plus;
  end if;
end $$;
