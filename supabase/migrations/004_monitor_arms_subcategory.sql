-- Reclassify monitor mounts / arms that were stored as monitors (e.g. Zeb-DMS*).
-- New uploads: parsers.ts assigns monitor_arm from model name + sheet fields.

update public.product_master
set
  sub_category = 'monitor_arm',
  updated_at = now()
where
  lower(trim(coalesce(sub_category, ''))) = 'monitor'
  and (
    product_name ~* '(^|[^a-z0-9])dms[0-9]{2,4}([^a-z0-9]|$)'
    or lower(product_name) like '%monitor arm%'
    or (
      lower(product_name) like '%desk mount%'
      and lower(product_name) like '%monitor%'
      and (
        lower(product_name) like '%arm%'
        or lower(product_name) like '%bracket%'
      )
    )
  );
