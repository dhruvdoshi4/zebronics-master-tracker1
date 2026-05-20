-- Quick commerce channels on the same product_master / daily_sales / computed_metrics tables.
-- Run supabase/run-qcom-marketplaces.sql in SQL Editor if not using CLI migrations.

do $$
begin
  alter type public.marketplace_type add value if not exists 'zepto';
exception when duplicate_object then null;
end$$;

do $$
begin
  alter type public.marketplace_type add value if not exists 'blinkit';
exception when duplicate_object then null;
end$$;

do $$
begin
  alter type public.marketplace_type add value if not exists 'bigbasket';
exception when duplicate_object then null;
end$$;

do $$
begin
  alter type public.marketplace_type add value if not exists 'instamart';
exception when duplicate_object then null;
end$$;

do $$
begin
  if exists (select 1 from pg_type where typname = 'product_category') then
    begin alter type public.product_category add value if not exists 'zepto'; exception when duplicate_object then null; end;
    begin alter type public.product_category add value if not exists 'blinkit'; exception when duplicate_object then null; end;
    begin alter type public.product_category add value if not exists 'bigbasket'; exception when duplicate_object then null; end;
    begin alter type public.product_category add value if not exists 'instamart'; exception when duplicate_object then null; end;
  end if;
end$$;
