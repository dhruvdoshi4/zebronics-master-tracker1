-- Reset Quick Commerce sellout so charts match Excel month columns (Apr-26, Mar-26, …).
-- Run once in Supabase SQL Editor, then re-upload the master from Upload Center.
--
-- Why: older ingests stored BOTH month totals AND per-day cells, which doubled months
-- (e.g. Bro Black Apr 18,218 + 24,336 = 42,554). Partial fixes can leave bad rows until
-- you purge and upload again with the latest app build.

-- 1) Remove all QCom sellout rows (adjust channel list if needed)
delete from public.daily_sales
where marketplace in ('zepto', 'blinkit', 'bigbasket', 'instamart');

delete from public.category_monthly_sellout
where marketplace in ('zepto', 'blinkit', 'bigbasket', 'instamart');

delete from public.computed_metrics
where marketplace in ('zepto', 'blinkit', 'bigbasket', 'instamart');

-- 2) Optional: remove failed/processing sellout uploads for QCom (keeps product names/images)
-- delete from public.uploads
-- where marketplace in ('zepto', 'blinkit', 'bigbasket', 'instamart')
--   and upload_kind = 'sellout';

-- 3) Re-upload "Quick-com Sell Out Report till 18th May 2026.xlsx" in the app (coverage 2026-05-18).
