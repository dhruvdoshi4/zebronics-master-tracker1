-- Flipkart FSNs explicitly marked Remarks = EOL on the sellout master (HO Stock exclusion).
-- Safe to re-run.

create table if not exists public.flipkart_eol_fsns (
  product_code text primary key,
  last_seen_at timestamptz not null default now()
);

create index if not exists flipkart_eol_fsns_last_seen_idx
  on public.flipkart_eol_fsns (last_seen_at desc);

alter table public.flipkart_eol_fsns enable row level security;

drop policy if exists flipkart_eol_fsns_read_policy on public.flipkart_eol_fsns;
create policy flipkart_eol_fsns_read_policy
on public.flipkart_eol_fsns
for select
to authenticated
using (true);

drop policy if exists flipkart_eol_fsns_write_policy on public.flipkart_eol_fsns;
create policy flipkart_eol_fsns_write_policy
on public.flipkart_eol_fsns
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
