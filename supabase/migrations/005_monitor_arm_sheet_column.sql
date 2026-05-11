-- Amazon sheet Sub Category column: "Monitor Arm" (stored with spaces / mixed case).
-- Model codes DM5200, DM5500, etc. (not only DMS*).

update public.product_master
set
  sub_category = 'monitor_arm',
  updated_at = now()
where
  regexp_replace(lower(trim(coalesce(sub_category, ''))), '[\s_]+', ' ', 'g') in ('monitor arm', 'monitor arms');

-- DM#### arms that were still under "monitor"
update public.product_master
set
  sub_category = 'monitor_arm',
  updated_at = now()
where
  lower(trim(coalesce(sub_category, ''))) = 'monitor'
  and product_name ~* '(^|[^a-z0-9])dm[0-9]{3,5}([^a-z0-9]|$)';
