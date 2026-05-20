-- Quick commerce channels — run entire script in Supabase SQL Editor before QCom upload.
--
-- If upload fails with: invalid input value for enum product_category: "blinkit"
-- your project still needs these four values on the channel enum (marketplace_type
-- and/or a legacy enum named product_category).

-- Standard enum (see schema.sql)
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

-- Some projects alias marketplace as product_category — extend if present.
do $$
begin
  if exists (select 1 from pg_type where typname = 'product_category') then
    begin alter type public.product_category add value if not exists 'zepto'; exception when duplicate_object then null; end;
    begin alter type public.product_category add value if not exists 'blinkit'; exception when duplicate_object then null; end;
    begin alter type public.product_category add value if not exists 'bigbasket'; exception when duplicate_object then null; end;
    begin alter type public.product_category add value if not exists 'instamart'; exception when duplicate_object then null; end;
  end if;
end$$;

-- Verify (should list zepto, blinkit, bigbasket, instamart):
-- select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'marketplace_type' order by 1;

-- Consolidated ASIN linking (also in migrations/013_qcom_listing_code.sql):
alter table public.product_master add column if not exists listing_code text;
