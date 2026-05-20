-- Consolidated tab from qcom master workbook (HO Stock category catalogue).
do $$
begin
  alter type public.marketplace_type add value if not exists 'consolidated';
exception when duplicate_object then null;
end$$;

do $$
begin
  if exists (select 1 from pg_type where typname = 'product_category') then
    begin alter type public.product_category add value if not exists 'consolidated'; exception when duplicate_object then null; end;
  end if;
end$$;
