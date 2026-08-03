-- Interleave v1 — The measurement layer
--
-- The architecture spec defines the controller exhaustively and the plant almost
-- not at all. Every mechanism downstream of §3 — stability updates, the forced
-- 4-point grade, §11's calibration curves — presupposes that a discrete, gradeable
-- retrieval event exists for a "skill". Anki can assume that because its unit is a
-- card: the cue is fixed, so the grade is unambiguous. "How's your Spanish?" is not
-- a gradeable question; "did you recall this specific conjugation pattern?" is.
--
-- Without a defined unit, v1 is a very smart timer and every grade in the §10 log
-- inherits the noise of an undefined measurement procedure — which is exactly the
-- data v2's HLR would later train on.
--
-- v1 does not try to solve item generation. It defines the unit:
--
--     event = (skill_id, prompt_ref, attempt_index, grade, duration)
--
-- A retrieval prompt is a CUE, not an exercise: "Play the F major scale from memory,
-- both hands." The learner performs the retrieval in the real world and grades it.
-- Interleave never verifies the performance. It verifies that a retrieval was
-- attempted against a specific, named cue.
--
-- Honest limitation, not papered over: this only PARTIALLY sidesteps the
-- self-assessment trap §3 invokes Kornell & Bjork (2008) for. The learner still
-- judges their own performance. The mitigations are that the cue is specific (so the
-- judgement is narrower than "how's your Spanish"), the scale is forced, and
-- prompt_ref is logged so per-prompt grade-distribution drift is detectable after
-- the fact. Mitigation, not solution. See docs/research-synthesis.md §3.1.

create table retrieval_prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  text text not null check (length(trim(text)) > 0),

  -- Provenance matters for analysis, not just bookkeeping:
  --   llm      — seeded by the §8 import pass from the learner's own material
  --   user     — written or edited by the learner
  --   migrated — placeholder synthesised for a skill that predates this layer
  -- 'migrated' is the important one. Those prompts stand in for retrievals whose
  -- actual cue was never recorded, so any calibration or training run that treats
  -- them as real items is contaminating itself. Tagging them is what makes the
  -- pre-v1 era separable from the clean dataset.
  source text not null default 'user' check (source in ('llm', 'user', 'migrated')),

  -- Drives the least-recently-served selection policy (see src/lib/v1/prompts.ts).
  last_served_at timestamptz,
  times_served int not null default 0,

  created_at timestamptz not null default now(),
  -- Soft archive only, consistent with the entity-layer principle in
  -- docs/research-synthesis.md §5: routine tidying must never destroy the record
  -- that logged events point at.
  archived_at timestamptz
);

create index retrieval_prompts_skill_idx
  on retrieval_prompts(skill_id) where archived_at is null;
create index retrieval_prompts_serve_order_idx
  on retrieval_prompts(skill_id, last_served_at nulls first) where archived_at is null;

alter table retrieval_prompts enable row level security;
create policy "Users manage own prompts" on retrieval_prompts
  for all using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: every pre-existing skill gets exactly one placeholder cue
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Existing skills were practised against no recorded cue at all. They cannot be
-- retro-fitted with a real one, so they get a generic placeholder that keeps them
-- schedulable (the invariant below would otherwise silently drop every legacy
-- skill out of the rotation) and are tagged 'migrated' so nothing downstream
-- mistakes them for genuine items.

insert into retrieval_prompts (user_id, skill_id, text, source)
select
  s.user_id,
  s.id,
  'Recall and practise: ' || s.name ||
    case when s.description is null or trim(s.description) = ''
         then ''
         else ' — ' || s.description end ||
    E'\n\n(Placeholder cue, carried over from before Interleave recorded what you were actually retrieving. Replace it with something specific you can answer yes or no to having recalled.)',
  'migrated'
from skills s
where s.archived_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- The scheduling invariant
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A skill with no live prompt has no gradeable retrieval. Scheduling it would
-- produce exactly the undefined-measurement grade this whole layer exists to
-- prevent, so it is excluded from the candidate set and surfaced as "needs setup"
-- instead. This view is the single source of truth for that rule; §6's reachability
-- mask and §7's argmax both filter through it.

create view schedulable_skills
with (security_invoker = true)
as select s.*, p.prompt_count
from skills s
join (
  select skill_id, count(*) as prompt_count
  from retrieval_prompts
  where archived_at is null
  group by skill_id
) p on p.skill_id = s.id
where s.archived_at is null;
