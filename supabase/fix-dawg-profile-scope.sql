-- Run once in SQL Editor after 011_data_scope.sql if dawg@ still sees main-company data.
-- Sets profile + backfills upload scope (existing rows stay default = Hari/Ram only).

update public.profiles p
set data_scope = 'dawg'
from auth.users u
where p.id = u.id
  and lower(u.email) = 'dawg@zebronics.com';

-- Optional: tag future dawg uploads only (do not relabel old company uploads):
-- update public.uploads set data_scope = 'dawg' where uploaded_by in (
--   select p.id from public.profiles p join auth.users u on u.id = p.id
--   where lower(u.email) = 'dawg@zebronics.com'
-- );
