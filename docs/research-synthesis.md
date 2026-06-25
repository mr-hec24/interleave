# Interleaving for the Polymath Learner: A Design Rationale

> **Status:** Living design document. This is not a research paper and makes no
> causal claims about Interleave's effectiveness. It explains *why* each design
> choice is grounded in the learning-science literature. Empirical validation is
> future work (see §6).

## 1. Problem

Adult self-directed learners juggling several unrelated domains — say, guitar,
Spanish, and machine learning — have no principled way to decide **what to
practice next, and for how long**. The decision is usually made by mood,
guilt, or recency.

This matters because the learning-science literature is unambiguous on one
point: **learners are bad at regulating their own practice schedules.** When
people choose how to study, they overwhelmingly prefer to *block* (study one
topic to satisfaction, then move on) even when interleaving would serve them
better (Tauber et al., 2020). They also misread fluency during easy, massed
practice as durable learning — the "illusion of competence" (Bjork, Dunlosky &
Kornell, 2013). The result is a predictable failure mode: switch too early and
attention fragments; switch too late and you over-learn one skill while others
decay.

Interleave's premise is that the *switching decision itself* should be made by
a transparent algorithm grounded in memory science, not by the learner's
in-the-moment intuition — while keeping the learner in full control and able to
see the reasoning.

## 2. Learning-Science Foundations

Interleave rests on four well-replicated effects.

**Spacing effect.** Distributing practice across time produces better long-term
retention than massing it, across a large meta-analytic literature (Cepeda et
al., 2006). Spacing is the backbone of the scheduler: review is recommended
only after memory has had time to decay.

**Testing effect.** Retrieving information strengthens memory more than
re-studying it (Roediger & Karpicke, 2006). Every Interleave session is framed
as a *retrieval event* — the learner attempts recall and then self-rates it,
rather than passively reviewing.

**Desirable difficulties.** Learning is most durable when retrieval is
effortful but still successful (Bjork & Bjork, 2011). Practice that feels too
easy builds little; practice that fails builds frustration. The scheduler
targets the band in between.

**Interleaving.** Mixing different topics or problem types within a practice
period improves retention and transfer relative to blocking, an effect
replicated across mathematics, science, motor skills, and perceptual category
learning (Taylor & Rohrer, 2010; Sana & Yan, 2022; Samani & Pan, 2021). The
meta-analytic average benefit is moderate (Hedges' g ≈ 0.42; Brunmair &
Richter, 2019).

### 2.1 The honest caveat: similarity, and why cross-domain is different

The interleaving literature carries a critical moderator that Interleave must
confront directly. Brunmair & Richter's (2019) meta-analysis (59 studies, 238
effect sizes) found that the interleaving benefit is **strongest when the
interleaved categories are highly similar and hard to discriminate, and weakest
or absent when they are dissimilar.** The dominant mechanistic account is
**discriminative contrast**: interleaving helps because juxtaposing confusable
items (two painters' styles, two similar math problem types) teaches the
learner to tell them apart (Kornell & Bjork, 2008).

Interleave operates at the *cross-domain* level — guitar vs. Spanish vs. ML —
which is about as dissimilar as categories get. By the discrimination account,
this is precisely the regime where the *classic* interleaving benefit should be
small or absent: there is nothing to discriminate between a barre chord and a
verb conjugation.

This is not a fatal flaw; it is a scoping decision. Interleave does **not** bet
on discriminative contrast. It bets on the *other* mechanisms that survive at
the cross-domain level:

- **Spacing.** Switching away from a skill is what creates the spacing interval
  that drives long-term retention. Cross-domain switching is a *vehicle for
  spacing*, independent of discrimination.
- **Contextual interference / retrieval effort.** Returning to a skill after
  working on something unrelated forces a more effortful "reload" from memory
  than continuing in the same context — a desirable difficulty.
- **Attention management.** For self-directed adults, the binding constraint is
  often *sustaining a multi-skill practice habit at all*, not fine-grained
  category discrimination.

So Interleave's design claim is narrow and honest: **at the cross-domain level,
the benefit (if any) flows through spacing and contextual interference, not
through discrimination.** Whether that benefit materializes is an empirical
question this product does not yet answer (§6).

## 3. From Theory to Mechanism

**Why SM-2 as the mastery signal.** The ideal mastery model would be
individualized — fit to each learner's own forgetting curve. The standard tool
for this, Bayesian Knowledge Tracing (BKT; Corbett & Anderson, 1995), requires
population-level training data to estimate its parameters. That data does not
exist at launch. This is a genuine cold-start problem, not a shortcut.

SM-2 (Woźniak & Gorzelańczyk, 1994) is the honest cold-start answer: a
well-understood, parameter-light spaced-repetition algorithm that produces
reasonable intervals from the very first session, with no training data. It is
explicitly framed as Phase 1 (see Roadmap in README), not as the final model.

**Why self-reported 0–5 recall.** Interleave spans arbitrary domains, so it
cannot auto-grade a guitar exercise the way a flashcard app grades a fact. The
self-assessed 0–5 recall rating is the lowest-friction signal that still
functions as a retrieval event (testing effect) and feeds SM-2. Its
subjectivity is a known limitation, mitigated by the append-only log (§5) which
preserves the raw ratings for later recalibration.

**Why skills must be narrowly scoped.** A single 0–5 recall rating is only a
coherent signal if it describes one well-defined thing. "Guitar" cannot be rated
as a single number; "blues scale in A" can. The skill- and session-entry forms
therefore include explicit scoping guidance (✗ Guitar → ✓ Blues scale in A;
✗ French → ✓ Passé composé conjugation) steering learners away from broad goals
toward atomic skills. This is not a UX nicety — it is a measurement requirement.
The scheduler needs *one forgetting curve per skill*; a broad "skill" would
blend several curves into one meaningless number. Broad goals are instead
represented as **Topics** (§4.1), which group many atomic skills.

## 4. The Interleaving Scheduler

The scheduler estimates, per skill, the **retrievability** — the probability of
successful recall right now — as a function of elapsed time since the last
review and the current SM-2 interval. Memory strength decays between sessions;
retrievability falls with it.

Practice is recommended when a skill's retrievability has decayed into the
**desirable-difficulty zone (~85%)** — low enough that retrieval is effortful
and the spacing benefit is captured, high enough that retrieval is likely to
*succeed*. Reviewing earlier wastes the spacing opportunity; reviewing later
risks a lapse.

The ~85% target is a deliberate, tunable design parameter, consistent with
spaced-repetition optimization work showing that review near (but not at) the
edge of forgetting maximizes long-term retention efficiency (Tabibian et al.,
2019). It is a starting heuristic, not a tuned optimum, and is exactly the kind
of parameter future data would calibrate.

Across multiple skills, retrievability scores produce a priority ordering: the
skill that has decayed furthest into the zone is surfaced first. This is how
cross-domain interleaving emerges — not as an arbitrary rotation, but as a
spacing-driven consequence of each skill's individual decay. Switching becomes
**earned and trustworthy** rather than arbitrary.

### 4.1 Topics: an organizational layer (and a research lever)

Atomic skills (§3) keep the measurement honest but proliferate quickly — a
language learner may have a dozen narrow skills. **Topics** group related skills
(e.g. a "French" topic holding passé composé, numbers, and pronunciation
skills) purely for organization. A topic carries a name, description, and a
free-text **notes/syllabus** field.

Crucially, topics are **organizational only** in Phase 1: they do not affect
SM-2 or the scheduler. Each skill is still scheduled independently by its own
retrievability. This keeps the decision layer clean while taming UI clutter.

But the topic structure is also a deliberate **research lever**. Because every
skill now carries a topic membership, the scheduler can later offer two modes
that map directly onto the competing mechanisms in §2.1:

- **Within-topic interleaving** — prefer the next skill from the *same* topic as
  the last (e.g. passé composé → numbers → subjunctive). High inter-item
  similarity; the **discriminative-contrast** mechanism (Brunmair & Richter,
  2019; Kornell & Bjork, 2008) should be active.
- **Across-topic interleaving** — prefer the next skill from a *different* topic
  (e.g. passé composé → blues scale → backprop). Low similarity; discrimination
  drops out, leaving **spacing and contextual interference** as the only
  plausible benefit.

This turns a routine product setting into a within-subjects manipulation of the
exact theoretical question the project is built around — without requiring a
separate study apparatus. The `topic_id` on each skill is already the data this
would need; only the scheduler's selection rule would change (see §6).

## 5. Design for Trust

**Visible reasoning.** The dashboard shows the actual numbers behind every
recommendation — retrievability, days since last review, current interval,
priority score. No black box. A learner asked to override their own (often
miscalibrated) instincts deserves to see *why* the algorithm disagrees.

**Where AI is, and isn't, used.** Claude explains recommendations in plain
language and generates tailored recall prompts at session start (a testing-
effect aid). Claude does **not** make scheduling decisions — those are
deterministic, auditable arithmetic. This boundary is deliberate: the trust
layer (explanation) is separated from the decision layer (math), so the system
remains fully reproducible and the AI cannot silently change what gets
recommended.

**Append-only data model.** Sessions are an append-only event log that is the
source of truth; SM-2 state is a derived projection that can be recomputed by
replaying the log. This preserves the raw observation sequence — exactly what a
future individualized BKT model (Phase 2) would need — without re-collecting
data, and lets any scheduling parameter be re-evaluated retrospectively.

**Edit and removal preserve history.** Skills and topics can be edited freely.
Removal is a *soft archive* (`archived_at`), never a hard delete: archived
skills and topics drop out of the dashboard, recommendations, and the recent-
sessions view, but their rows — and every session logged against them — remain
in the database. Removing a topic leaves its skills intact but ungrouped. This
is the same principle as the append-only log applied to the entity layer: the
research record is never destroyed by routine product actions, so a learner
tidying their dashboard cannot silently corrupt the dataset.

## 6. Open Questions & Future Work

This product makes **design** claims grounded in literature, not **efficacy**
claims grounded in its own data. The honest open questions:

- **Does cross-domain interleaving actually improve retention?** The central
  empirical question. Within-domain evidence is strong; the cross-domain
  spacing/contextual-interference account (§2.1) is plausible but untested here.
  A future within-subjects study (some of a learner's skills scheduled by the
  app, others self-scheduled, comparing recall at matched delays) could test it
  — contingent on appropriate ethics review.
- **Within-topic vs. across-topic interleaving (the mechanism test).** The
  topic structure (§4.1) enables a scheduler mode toggle that pits
  discriminative contrast (within-topic, high similarity) against spacing /
  contextual interference (across-topic, low similarity) — a within-subjects
  manipulation of the central theoretical question from §2.1. Implementation is
  small: the scheduler's selection rule gains a mode that biases toward or away
  from the last-practiced skill's topic; the `topic_id` data already exists.
  This is the most direct empirical pipeline the product opens up.
- **Is self-reported 0–5 recall well-calibrated?** The append-only log enables
  retrospective calibration against later performance.
- **Phase 2 — individualized BKT.** Once enough per-user session history
  accumulates, fit a personal forgetting model rather than relying on SM-2's
  fixed assumptions.
- **Phase 2 — Claude-suggested skills from a topic syllabus.** Topics carry an
  optional notes/syllabus field. A future feature would let Claude read that
  syllabus and *suggest* well-scoped skills to add (e.g. read a French syllabus,
  propose "passé composé conjugation," "numbers 1–100"). This stays inside the
  trust boundary (§5): Claude *advises* on curriculum, the learner explicitly
  adds each skill, and the scheduler still decides *when* to practice via
  deterministic math. The known limitation — flagged for honesty — is that the
  suggestions are only as good as the syllabus/notes fed in; garbage in,
  garbage out. Surfacing *that* uncertainty to the user (rather than presenting
  suggestions as authoritative) is part of the design problem to solve.
- **The trust metric.** Recommendation *acceptance rate* (how often learners
  follow the suggested switch) is a usable proxy for whether the visible-
  reasoning design earns trust in practice.
- **The ML bridge.** Cross-domain human interleaving has a structural analog in
  multi-task machine learning, where interleaved training offsets catastrophic
  forgetting (Kirkpatrick et al., 2017) and curriculum effects can be framed via
  contextual inference (Dekker et al., 2025). This is currently an inspiration
  and a framing, not a second validated mechanism.

## References

- Bjork, E. L., & Bjork, R. A. (2011). Making things hard on yourself, but in a
  good way: Creating desirable difficulties to enhance learning. *Psychology and
  the Real World.*
- Bjork, R. A., Dunlosky, J., & Kornell, N. (2013). Self-regulated learning:
  Beliefs, techniques, and illusions. *Annual Review of Psychology, 64,*
  417–444.
- Brunmair, M., & Richter, T. (2019). Similarity matters: A meta-analysis of
  interleaved learning and its moderators. *Psychological Bulletin, 145*(11),
  1029–1052.
- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006).
  Distributed practice in verbal recall tasks: A review and quantitative
  synthesis. *Psychological Bulletin, 132*(3), 354–380.
- Corbett, A. T., & Anderson, J. R. (1995). Knowledge tracing: Modeling the
  acquisition of procedural knowledge. *User Modeling and User-Adapted
  Interaction, 4,* 253–278.
- Dekker, R. B., et al. (2025). Curriculum effects in multitask learning through
  the lens of contextual inference. *Current Opinion in Behavioral Sciences.*
- Kirkpatrick, J., et al. (2017). Overcoming catastrophic forgetting in neural
  networks. *PNAS, 114*(13), 3521–3526.
- Kornell, N., & Bjork, R. A. (2008). Learning concepts and categories: Is
  spacing the "enemy of induction"? *Psychological Science, 19*(6), 585–592.
- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking
  memory tests improves long-term retention. *Psychological Science, 17*(3),
  249–255.
- Samani, J., & Pan, S. C. (2021). Interleaved practice enhances memory and
  problem-solving ability in undergraduate physics. *npj Science of Learning,
  6,* 32.
- Sana, F., & Yan, V. X. (2022). Interleaving retrieval practice promotes
  science learning. *Journal of Applied Research in Memory and Cognition.*
- Tabibian, B., Upadhyay, U., De, A., Zarezade, A., Schölkopf, B., &
  Gomez-Rodriguez, M. (2019). Enhancing human learning via spaced repetition
  optimization. *PNAS, 116*(10), 3988–3993.
- Tauber, S. K., et al. (2020). Category similarity affects study choices in
  self-regulated learning. *Memory & Cognition.*
- Taylor, K., & Rohrer, D. (2010). The effects of interleaved practice.
  *Applied Cognitive Psychology, 24*(6), 837–848.
- Woźniak, P. A., & Gorzelańczyk, E. J. (1994). Optimization of repetition
  spacing in the practice of learning. *Acta Neurobiologiae Experimentalis,
  54,* 59–62.
