-- Quick commerce: platform listing ID when product_code is the shared ASIN from Consolidated.
alter table public.product_master
  add column if not exists listing_code text;

comment on column public.product_master.listing_code is
  'Channel SKU (Item ID, PVID, etc.) when product_code is the ASIN from the Consolidated sheet link.';
