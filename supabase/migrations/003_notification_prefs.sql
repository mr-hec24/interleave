-- Notification preferences on the profiles table
alter table profiles
  add column email text,
  add column notifications_enabled boolean not null default true,
  add column notification_hour smallint not null default 8,
  add column notification_timezone text not null default 'UTC',
  add column unsubscribe_token uuid not null default gen_random_uuid(),
  add column last_notification_sent_at timestamptz;

-- Backfill email for existing users from auth.users
update profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- Update the new-user trigger to also store email on the profile
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

-- No new RLS policies needed: the cron uses the service role key which bypasses RLS.
