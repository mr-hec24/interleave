-- Interleave v1 — §2 Data Model: The Skill Graph
--
-- A single graph per user, G = (V, E_prereq, E_similar), with ONE node type: Skill.
-- The spec's heterogeneous formulation collapses because with a static set of 4
-- cognitive resource channels the REQUIRES bipartite relation is exactly an n×4
-- matrix — i.e. a per-node feature vector (channel_loadings), not a node type.
--
-- This migration also retires SM-2. The v1 memory model is FSRS-style (§3), so
-- repetitions/ease_factor/interval_days have no counterpart and sr_state is dropped
-- outright after its state is carried across onto the skill node.
--
-- NOTE ON STABILITY UNITS (spec inconsistency, resolved here):
--   §2 defines S_i operationally as "the Δt at which R_i = 0.9", explicitly
--   "decay-form-agnostic". §3 then writes R_i(t) = exp(−Δt / S_i). These cannot both
--   hold: under exp(−Δt/S), R = 0.9 occurs at Δt = 0.105·S, not at S.
--   We keep §2's operational definition, because §3's own rationale for it is that
--   the functional form must be swappable in v2 without migrating stored state.
--   So stability_days is ALWAYS "days until R decays to 0.9", and v1 evaluates
--       R(Δt) = 0.9 ^ (Δt / S)   ≡   exp(−Δt · ln(1/0.9) / S)
--   which is the same exponential family, parameterised by the operational quantity.
--   See src/lib/v1/memory.ts.

create extension if not exists vector;

-- ─────────────────────────────────────────────────────────────────────────────
-- Skill node features (§2, table 1)
-- ─────────────────────────────────────────────────────────────────────────────

alter table skills
  -- S_i — days until R decays to 0.9. Null = never reviewed (cold).
  add column stability_days numeric check (stability_days is null or stability_days > 0),
  -- d_i — FSRS-style item difficulty on [1,10]; higher is harder.
  add column difficulty numeric not null default 5.0 check (difficulty between 1 and 10),
  -- W_i — user-set importance.
  add column priority_weight numeric not null default 1.0 check (priority_weight > 0),
  -- λ_i ∈ [0,1]^4 — load on {logical, verbal, visual, motor}.
  -- LLM-initialised at import (§8); uniform until then.
  add column channel_loadings numeric[] not null default '{0.25,0.25,0.25,0.25}',
  -- e_i — embedding of the skill's semantic signature; powers E_similar (§2)
  -- and inductive cold-start (§9.2). 384-dim = all-MiniLM-L6-v2.
  add column embedding vector(384),
  -- t_last,i — timestamp of most recent retrieval event.
  add column last_reviewed_at timestamptz;

alter table skills
  add constraint skills_channel_loadings_len check (array_length(channel_loadings, 1) = 4);

-- ─────────────────────────────────────────────────────────────────────────────
-- Carry SM-2 state across onto the node, then drop it
-- ─────────────────────────────────────────────────────────────────────────────

-- S ← interval_days. SM-2 intervals are calibrated to hold retention near ~90%,
-- which is precisely the operational definition of S adopted above, so this is a
-- unit-preserving copy rather than a rescale.
update skills s
set stability_days = greatest(sr.interval_days, 1),
    last_reviewed_at = sr.last_reviewed_at
from sr_state sr
where sr.skill_id = s.id
  and sr.last_reviewed_at is not null;

-- d ← ease_factor, inverted and rescaled. SM-2 ease runs [1.3, 2.5] with HIGHER
-- meaning easier; FSRS difficulty runs [1, 10] with HIGHER meaning harder.
update skills s
set difficulty = greatest(1, least(10,
      1 + 9 * (2.5 - greatest(1.3, least(2.5, sr.ease_factor))) / (2.5 - 1.3)
    ))
from sr_state sr
where sr.skill_id = s.id
  and sr.repetitions > 0;

drop trigger if exists on_skill_created on skills;
drop function if exists handle_new_skill();
drop table sr_state;

-- Compatibility shim. sr_state has five readers (Dashboard, dashboard/page,
-- SessionForm, and both notification routes) that are ported to the v1 controller
-- in later branches. Rather than leave those branches unbuildable, the name
-- survives as a read-only projection of the node features until the last reader
-- is migrated, at which point the view is dropped (007_notifications_v1.sql).
--
-- It is deliberately WRITABLE (via the INSTEAD OF trigger below) so the legacy
-- session-logging path keeps functioning at every commit in the chain rather than
-- only after the final merge.
--
-- Honest about the lossy part: `repetitions` cannot be recovered once SM-2 is
-- dropped, so it is synthesised. Every consumer of it is deleted by the end of
-- this chain, and none of it reaches the v1 event log.
create view sr_state
with (security_invoker = true)
as select
  s.id                                        as skill_id,
  coalesce(round(s.stability_days)::int, 0)   as interval_days,
  s.last_reviewed_at,
  case when s.last_reviewed_at is null then 0 else 2 end            as repetitions,
  round((2.5 - (s.difficulty - 1) * (2.5 - 1.3) / 9)::numeric, 2)   as ease_factor,
  case
    when s.last_reviewed_at is null then null
    else s.last_reviewed_at + (coalesce(s.stability_days, 1) || ' days')::interval
  end                                         as due_at
from skills s;

create or replace function sr_state_compat_write()
returns trigger
language plpgsql
as $$
begin
  -- Only the two fields that survive into the v1 node are honoured; the SM-2
  -- columns are accepted and discarded so legacy writes neither fail nor lie.
  update skills
  set stability_days = greatest(new.interval_days, 1),
      last_reviewed_at = new.last_reviewed_at
  where id = old.skill_id;
  return new;
end;
$$;

create trigger sr_state_compat_update
  instead of update on sr_state
  for each row execute function sr_state_compat_write();

-- ─────────────────────────────────────────────────────────────────────────────
-- E_prereq (§2) — directed, must remain a DAG (cycle-check on insert)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- An edge (prereq_skill_id → skill_id) reads "skill_id requires prereq_skill_id".
-- Source: LLM extraction from user materials — noisy by construction (§2), which
-- is why v3 carries a link-prediction head to prune and propose (§9.3). In v1 the
-- user is the only cleaner, so every edge is confirmable and every edit is logged.

create table skill_prereq_edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  prereq_skill_id uuid not null references skills(id) on delete cascade,
  -- LLM-proposed edges start unconfirmed and do not gate scheduling until the
  -- user accepts them; §9.3's rule (surface, don't silently apply) applied in v1.
  confirmed boolean not null default false,
  source text not null default 'llm' check (source in ('llm', 'user')),
  created_at timestamptz not null default now(),
  unique (skill_id, prereq_skill_id),
  check (skill_id <> prereq_skill_id)
);

create index skill_prereq_edges_skill_idx on skill_prereq_edges(skill_id);
create index skill_prereq_edges_prereq_idx on skill_prereq_edges(prereq_skill_id);

-- The DAG invariant is enforced in the database, not just in app code: a cycle in
-- E_prereq would make reachable() (§6) non-terminating and the hard mask meaningless.
create or replace function assert_prereq_acyclic()
returns trigger
language plpgsql
as $$
begin
  -- A cycle is created iff the new edge's prerequisite is already reachable by
  -- following prereq→dependent edges forward from the new edge's dependent skill.
  if exists (
    with recursive reach(node) as (
      select e.skill_id
      from skill_prereq_edges e
      where e.prereq_skill_id = new.skill_id
      union
      select e.skill_id
      from skill_prereq_edges e
      join reach r on e.prereq_skill_id = r.node
    )
    select 1 from reach where node = new.prereq_skill_id
  ) then
    raise exception 'prerequisite edge %→% would create a cycle in E_prereq',
      new.prereq_skill_id, new.skill_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger prereq_acyclic
  before insert or update on skill_prereq_edges
  for each row execute function assert_prereq_acyclic();

-- ─────────────────────────────────────────────────────────────────────────────
-- E_similar (§2) — undirected, weighted by cos(e_i, e_j)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- This edge type carries the semantic-spacing thesis: it defines the interference
-- penalty (§7) and, in v3, the transfer pathway (§9.4). Without it "semantic
-- saturation" is unmeasurable hand-waving.
-- Stored canonically with skill_a < skill_b so each pair appears exactly once.

create table skill_similar_edges (
  user_id uuid not null references profiles(id) on delete cascade,
  skill_a uuid not null references skills(id) on delete cascade,
  skill_b uuid not null references skills(id) on delete cascade,
  sim numeric not null check (sim > 0.6 and sim <= 1),
  -- Which EmbeddingProvider produced this, so a provider swap is visible in the
  -- data rather than silently changing what "similar" means mid-experiment.
  provider text not null,
  computed_at timestamptz not null default now(),
  primary key (skill_a, skill_b),
  check (skill_a < skill_b)
);

create index skill_similar_edges_a_idx on skill_similar_edges(skill_a);
create index skill_similar_edges_b_idx on skill_similar_edges(skill_b);

-- ─────────────────────────────────────────────────────────────────────────────
-- §5 channel saturation state
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Persisted across sessions so idle decay is computed against wall clock rather
-- than assumed to reset — fatigue you slept off and fatigue from ten minutes ago
-- are not the same state.

create table user_channel_state (
  user_id uuid primary key references profiles(id) on delete cascade,
  sat numeric[] not null default '{0,0,0,0}',
  updated_at timestamptz not null default now(),
  check (array_length(sat, 1) = 4)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- §7 hyperparameters
-- ─────────────────────────────────────────────────────────────────────────────
--
-- §7 names every one of these as a candidate for bandit-style tuning post-launch,
-- and §11 requires ε to be randomisable across users for the block-granularity
-- experiment. They are therefore data, not constants. Defaults are the v1 values.

create table scheduler_config (
  user_id uuid primary key references profiles(id) on delete cascade,
  alpha numeric not null default 1.0,    -- urgency weight
  beta numeric not null default 0.7,     -- fatigue weight
  gamma numeric not null default 0.5,    -- readiness weight
  delta numeric not null default 0.3,    -- interference weight
  epsilon numeric not null default 0.15, -- hysteresis margin; sole granularity control
  theta numeric not null default 0.35,   -- target retrievability
  sigma numeric not null default 0.15,   -- desirable-difficulty tolerance
  -- τ_j: time-to-fatigue under full load, per channel (minutes)
  tau_minutes numeric[] not null default '{50,50,50,50}',
  -- ρ_j: recovery constant, per channel (minutes)
  rho_minutes numeric[] not null default '{75,75,75,75}',
  -- Similarity edge construction
  sim_threshold numeric not null default 0.6,
  sim_degree_cap int not null default 10,
  updated_at timestamptz not null default now(),
  check (array_length(tau_minutes, 1) = 4),
  check (array_length(rho_minutes, 1) = 4)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Provision per-user rows
-- ─────────────────────────────────────────────────────────────────────────────

insert into user_channel_state (user_id) select id from profiles
  on conflict (user_id) do nothing;
insert into scheduler_config (user_id) select id from profiles
  on conflict (user_id) do nothing;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  insert into public.user_channel_state (user_id) values (new.id);
  insert into public.scheduler_config (user_id) values (new.id);
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table skill_prereq_edges enable row level security;
create policy "Users manage own prereq edges" on skill_prereq_edges
  for all using (auth.uid() = user_id);

alter table skill_similar_edges enable row level security;
create policy "Users manage own similar edges" on skill_similar_edges
  for all using (auth.uid() = user_id);

alter table user_channel_state enable row level security;
create policy "Users manage own channel state" on user_channel_state
  for all using (auth.uid() = user_id);

alter table scheduler_config enable row level security;
create policy "Users manage own scheduler config" on scheduler_config
  for all using (auth.uid() = user_id);
