-- Run in Supabase SQL Editor (service role) if charts still show stale totals (e.g. Flipkart Apr 25 = 216).
-- Then re-upload masters from Upload Center while logged in as admin.

delete from public.daily_sales where marketplace = 'flipkart';
delete from public.daily_sales where marketplace = 'amazon';
delete from public.category_monthly_sellout where marketplace = 'flipkart';
delete from public.category_monthly_sellout where marketplace = 'amazon';
delete from public.computed_metrics where upload_id is null;
