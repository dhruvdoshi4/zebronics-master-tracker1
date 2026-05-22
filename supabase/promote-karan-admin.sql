-- Run once if karan@zebronics.com shows "viewer" and Upload Center is blocked.

update public.profiles
set role = 'admin'
where id in (
  select id from auth.users where lower(email) = 'karan@zebronics.com'
);
