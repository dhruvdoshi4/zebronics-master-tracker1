-- Rithika + Flipkart sellout diagnostics (run in Supabase SQL Editor)

-- 1) Workspace constraint (required once)
-- If this fails, run: supabase/run-rithika-catalog-workspace.sql

-- 2) Latest Flipkart sellout uploads
select
  id,
  snapshot_date,
  catalog_workspace,
  status,
  uploaded_at,
  file_name
from public.uploads
where marketplace = 'flipkart'
  and status = 'completed'
order by uploaded_at desc
limit 15;

-- 3) Rithika Flipkart upload should exist with catalog_workspace = rithika_it_gaming
select count(*) as rithika_fk_uploads
from public.uploads
where marketplace = 'flipkart'
  and status = 'completed'
  and catalog_workspace = 'rithika_it_gaming';

-- 4) Heat Buster 300 Black (example FSN — adjust if different)
select
  pm.product_code,
  pm.product_name,
  pm.catalog_workspace,
  cm.may_mtd_units,
  cm.apr_so_units,
  cm.prior_fy_so_units,
  cm.as_of_date,
  u.catalog_workspace as upload_workspace
from public.product_master pm
left join public.computed_metrics cm
  on cm.marketplace = pm.marketplace
  and cm.product_code = pm.product_code
left join public.uploads u on u.id = cm.upload_id
where pm.marketplace = 'flipkart'
  and upper(pm.product_code) = 'USGHDZPZSCYJHTHA'
order by cm.as_of_date desc nulls last
limit 5;

-- 5) Monthly sellout rows for that FSN (latest upload)
select ds.sale_date, ds.units_sold, u.snapshot_date, u.catalog_workspace
from public.daily_sales ds
join public.uploads u on u.id = ds.upload_id
where ds.marketplace = 'flipkart'
  and upper(ds.product_code) = 'USGHDZPZSCYJHTHA'
  and u.catalog_workspace = 'rithika_it_gaming'
order by ds.sale_date desc
limit 24;
