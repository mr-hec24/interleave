-- Interleave v1 schema
-- Core principle: sessions is append-only event log, sr_state is derived cache

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
create policy "Users read own profile" on profiles for select using (auth.uid() = id);
create policy "Users update own profile" on profiles for update using (auth.uid() = id);
create policy "Users insert own profile" on profiles for insert with check (auth.uid() = id);

create table skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  description text,
  default_session_minutes int not null default 25,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table skills enable row level security;
create policy "Users manage own skills" on skills for all using (auth.uid() = user_id);

create table sr_state (
  skill_id uuid primary key references skills(id) on delete cascade,
  repetitions int not null default 0,
  ease_factor numeric(4,2) not null default 2.50,
  interval_days int not null default 0,
  last_reviewed_at timestamptz,
  due_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table sr_state enable row level security;
create policy "Users manage own sr_state" on sr_state for all
  using (exists (select 1 from skills where skills.id = sr_state.skill_id and skills.user_id = auth.uid()));

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  started_at timestamptz not null default now(),
  duration_minutes int not null,
  quality smallint not null check (quality between 0 and 5),
  note text,
  recall_prompt text,
  sm2_repetitions_before int not null,
  sm2_ease_before numeric(4,2) not null,
  sm2_interval_before int not null,
  sm2_repetitions_after int not null,
  sm2_ease_after numeric(4,2) not null,
  sm2_interval_after int not null,
  due_at_after timestamptz not null,
  created_at timestamptz not null default now()
);

alter table sessions enable row level security;
create policy "Users manage own sessions" on sessions for all using (auth.uid() = user_id);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  reason_json jsonb not null,
  reason_text text not null,
  chosen boolean,
  acted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table recommendations enable row level security;
create policy "Users manage own recommendations" on recommendations for all using (auth.uid() = user_id);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Auto-create sr_state when a skill is created
create or replace function handle_new_skill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sr_state (skill_id) values (new.id);
  return new;
end;
$$;

create trigger on_skill_created
  after insert on skills
  for each row execute function handle_new_skill();
