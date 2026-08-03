-- Interleave v1 — §10 Instrumentation: The Logging Spine
--
-- "The log is the asset." Training data, product analytics, and research corpus are
-- the same table. The schema is fixed at v1 launch because logging model state
-- alongside outcomes is what allows every future model to be evaluated by replay on
-- historical decisions before it ever touches production — and a field not captured
-- in July cannot be recovered in December.
--
-- Two columns beyond the spec's table, both from the measurement layer (§3.1 of
-- docs/research-synthesis.md): prompt_ref and attempt_index. Without prompt_ref a
-- grade is attached to a vague skill rather than a specific retrieval, which is the
-- difference between an item-response dataset and a pile of impressions. It costs
-- one column now and cannot be backfilled later.

create table events (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  ts timestamptz not null default now(),

  event_type text not null check (event_type in (
    'review',        -- one graded retrieval attempt against one cue
    'session_start',
    'session_end',
    'switch',        -- controller changed the active skill (§7)
    'import',        -- §8 LLM pass produced nodes/edges/cues
    'edge_edit',     -- user confirmed/rejected/added a prerequisite edge
    'prompt_edit'    -- user added/edited/archived a retrieval cue
  )),

  -- Null for user-level events (session boundaries carry it only when scoped).
  skill_id uuid references skills(id) on delete set null,

  -- ── Measurement layer ──────────────────────────────────────────────────────
  -- Which cue this retrieval was against. Set on every 'review'. Nullable only
  -- because non-review events have no cue.
  prompt_ref uuid references retrieval_prompts(id) on delete set null,
  -- 1-based within (session, prompt). §9.3's readiness head trains on FIRST-attempt
  -- outcomes, so first-attempt must be derivable from day one, not reconstructed.
  attempt_index int check (attempt_index is null or attempt_index >= 1),

  -- ── §10 fields ─────────────────────────────────────────────────────────────
  grade text check (grade is null or grade in ('again', 'hard', 'good', 'easy')),
  -- Days since this skill's previous review at the moment of this event.
  delta_t numeric,
  -- Model state AT EVENT TIME — this is what enables offline replay and
  -- counterfactuals. Recording the prediction next to the outcome is the whole
  -- point; recording only the outcome makes the log un-evaluable.
  r_pred numeric,
  s_before numeric,
  s_after numeric,
  difficulty numeric,
  -- Top-k utilities with their components {D, F, Ready, Intf} at each switch
  -- decision. Written on 'switch' and 'session_start'.
  u_vector jsonb,
  -- 4-channel saturation at session boundaries (§5).
  sat_state numeric[],
  -- One-tap post-session self-rating, 1–5. A §11 fit target for τ and ρ, which
  -- have no reliable values in the literature.
  fatigue_report smallint check (fatigue_report is null or fatigue_report between 1 and 5),
  session_dur numeric,
  -- Per-attempt latency series and derived drift — the other τ/ρ fit target.
  -- Only computable because attempts are discrete; a fixed block yields one number.
  latency_stats jsonb,
  error_drift numeric,
  -- Max similarity to the previous block's skill. This is how the Brunmair &
  -- Richter similarity regime is recovered after the fact: without it you cannot
  -- tell whether the interference penalty was even operating in a regime where
  -- similarity existed to be penalised.
  sim_context numeric,

  -- Provenance of the components, so a model or provider swap is visible in the
  -- data rather than silently redefining what the numbers mean mid-experiment.
  embedding_provider text,
  scheduler_version text not null default 'v1',

  -- Groups all events belonging to one continuous practice sitting.
  session_id uuid,

  -- Free-form payload for event types with irregular shape (import counts,
  -- edge_edit before/after). Deliberately NOT used for anything a query needs.
  meta jsonb
);

create index events_user_ts_idx on events(user_id, ts desc);
create index events_skill_ts_idx on events(skill_id, ts desc) where skill_id is not null;
create index events_session_idx on events(session_id) where session_id is not null;
-- Calibration (§11) scans reviews by prompt; keep that path cheap.
create index events_review_prompt_idx on events(prompt_ref, ts)
  where event_type = 'review';

-- ─────────────────────────────────────────────────────────────────────────────
-- Append-only, enforced
-- ─────────────────────────────────────────────────────────────────────────────
--
-- "Append-only" is a property of the table, not a convention the application is
-- trusted to observe. Grant insert and select; grant nothing else. A log that can
-- be rewritten is not a research record, and the replay guarantee above depends on
-- rows being immutable.

alter table events enable row level security;

create policy "Users insert own events" on events
  for insert with check (auth.uid() = user_id);
create policy "Users read own events" on events
  for select using (auth.uid() = user_id);
-- No update policy and no delete policy: with RLS enabled, their absence denies
-- both outright, including to the table owner's normal API role.

revoke update, delete on events from authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fold the pre-v1 session history into the spine
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `sessions` was the SM-2-shaped predecessor. Its rows are real retrievals and are
-- worth keeping, but they were graded 0–5 against no recorded cue, so they migrate
-- pointed at the skill's 'migrated' placeholder and carry scheduler_version 'sm2'.
-- Anything training or calibrating on this table can then exclude the
-- pre-measurement era with a single predicate, which is the entire reason for
-- tagging rather than silently blending it in.
--
-- Grade mapping from SM-2 quality: 0–2 are failures (again), 3 is a hard success,
-- 4 good, 5 easy. This matches SM-2's own q<3 lapse boundary.

insert into events (
  user_id, ts, event_type, skill_id, prompt_ref, attempt_index,
  grade, session_dur, scheduler_version, meta
)
select
  se.user_id,
  se.started_at,
  'review',
  se.skill_id,
  (select rp.id from retrieval_prompts rp
     where rp.skill_id = se.skill_id and rp.source = 'migrated' limit 1),
  1,
  case
    when se.quality <= 2 then 'again'
    when se.quality = 3 then 'hard'
    when se.quality = 4 then 'good'
    else 'easy'
  end,
  se.duration_minutes,
  'sm2',
  jsonb_build_object(
    'legacy_quality', se.quality,
    'legacy_note', se.note,
    'sm2_interval_after', se.sm2_interval_after,
    'sm2_ease_after', se.sm2_ease_after
  )
from sessions se;

drop table sessions;

-- Compatibility shim, same rationale as sr_state in 004: the session-logging path
-- and the "recent sessions" panel are ported to the v1 event API in a later branch,
-- and until then they should keep working rather than sit broken mid-chain. Reads
-- project review events back into the old shape; writes are routed into the spine
-- by the trigger below so no retrieval goes unlogged in the interim.
-- Dropped in 007_notifications_v1.sql once the last caller is migrated.
create view sessions
with (security_invoker = true)
as select
  e.id::text                                   as id,
  e.user_id,
  e.skill_id,
  e.ts                                         as started_at,
  e.ts                                         as created_at,
  e.session_dur::int                           as duration_minutes,
  case e.grade
    when 'again' then 1 when 'hard' then 3
    when 'good' then 4 else 5
  end                                          as quality,
  e.meta ->> 'legacy_note'                     as note
from events e
where e.event_type = 'review';

create or replace function sessions_compat_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into events (
    user_id, ts, event_type, skill_id, prompt_ref, attempt_index,
    grade, session_dur, scheduler_version, meta
  ) values (
    new.user_id,
    coalesce(new.started_at, now()),
    'review',
    new.skill_id,
    -- Legacy writers name no cue, so the skill's placeholder stands in and the
    -- row is tagged accordingly. Better a correctly-labelled approximation than
    -- an unlabelled one that later looks like a real measurement.
    (select rp.id from retrieval_prompts rp
       where rp.skill_id = new.skill_id and rp.archived_at is null
       order by (rp.source = 'migrated') desc limit 1),
    1,
    case
      when new.quality <= 2 then 'again'
      when new.quality = 3 then 'hard'
      when new.quality = 4 then 'good'
      else 'easy'
    end,
    new.duration_minutes,
    'sm2-compat',
    jsonb_build_object('legacy_quality', new.quality, 'legacy_note', new.note)
  );
  return new;
end;
$$;

create trigger sessions_compat_insert
  instead of insert on sessions
  for each row execute function sessions_compat_write();

-- Superseded by events.u_vector, which §10 specifies and which actually gets
-- written. This table had RLS, a schema, and zero writers in its entire lifetime.
drop table recommendations;
