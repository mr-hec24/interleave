-- Topics: an organizational layer grouping related skills (e.g. "French"
-- holding grammar, spelling, and speaking skills). The notes field doubles as
-- a syllabus/rubric space that a future Claude feature can read to suggest new
-- skills (Phase 2 — see docs/research-synthesis.md §6).
--
-- Topics are purely organizational. They do NOT affect SM-2 or the scheduler:
-- each skill still has its own forgetting curve and is scheduled independently.

create table topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  description text,
  notes text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table topics enable row level security;
create policy "Users manage own topics" on topics for all using (auth.uid() = user_id);

-- Skills optionally belong to a topic. On topic deletion the skill is kept but
-- becomes ungrouped (set null), consistent with preserving the append-only log.
alter table skills
  add column topic_id uuid references topics(id) on delete set null;

create index skills_topic_id_idx on skills(topic_id);
