# interleave

A self-directed learning optimizer that uses spaced repetition and interleaving principles to help adult learners decide **what to practice next, and for how long**, across unrelated domains (music, language, AI, etc.).

## The problem

Adult learners juggling multiple skills have no principled way to decide when to switch topics. Switching too early fragments attention. Switching too late produces over-learning with poor retention. Interleave makes switching **earned and trustworthy**, not arbitrary.

## How it works

- **SM-2 spaced repetition** tracks mastery per skill using self-assessed recall ratings (0–5 scale)
- **Retrievability-based scheduler** estimates memory strength per skill and recommends practice when recall has decayed to the desirable difficulty zone (~85% retrievability) — effortful but still achievable
- **Visible reasoning** — the dashboard shows the actual numbers (retrievability, days since review, interval, priority score) alongside every recommendation. No black box.
- **Claude AI** explains recommendations in plain language — it interprets the computed decision, it does not make it

## Design principles

Every feature is justified by learning science, not product intuition:

- **Spacing effect** → interval-based scheduling (Cepeda et al., 2006)
- **Testing effect** → each session is a retrieval event with self-assessed recall (Roediger & Karpicke, 2006)
- **Desirable difficulties** → review when retrieval is effortful but possible (Bjork & Bjork, 2011)
- **Interleaving** → cross-domain scheduling, extending within-subject evidence (Taylor & Rohrer, 2010)

See [`/docs/research-synthesis.md`](./docs/research-synthesis.md) for the full learning-science rationale.

## Architecture

**Stack:** Next.js (App Router) · TypeScript · Supabase (Postgres + Auth + RLS) · Vercel · Claude API

**Data model:** Sessions are an append-only event log (source of truth). SM-2 state is a derived projection that can be recomputed by replaying the log — this preserves the raw observation sequence needed for future individualized BKT.

**Where Claude is used (and where it isn't):**
- ✅ Explaining scheduler recommendations in plain language (trust layer)
- ✅ Generating tailored recall prompts at session start (testing effect)
- ❌ Making scheduling decisions (those are deterministic, auditable math)

## Roadmap

| Phase | Mastery signal | Status |
|-------|---------------|--------|
| **1 — SR-based interleaving** | SM-2 (cold-start solution) | In progress |
| 2 — Individualized BKT | BKT fitted on user's own session history | Planned |
| 3 — Population BKT | Cross-user parameter estimation | Future |

The phased approach is intentional: BKT requires population-level training data that doesn't exist at launch. SM-2 is an honest cold-start solution, not a compromise — and the append-only data model ensures Phase 2 migration is possible without re-collecting data.

## Local development

```bash
# Install dependencies
npm install

# Copy env template and fill in your Supabase + Anthropic keys
cp .env.local.example .env.local

# Run the Supabase migration (via Supabase dashboard or CLI)
# SQL is in supabase/migrations/001_initial_schema.sql

# Start dev server
npm run dev

# Run tests
npm test
```

## References

- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks. *Psychological Bulletin*.
- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning. *Psychological Science*.
- Bjork, E. L., & Bjork, R. A. (2011). Making things hard on yourself, but in a good way.
- Taylor, K., & Rohrer, D. (2010). The effects of interleaved practice. *Applied Cognitive Psychology*.
- Kapur, M. (2008). Productive failure. *Cognition and Instruction*.
- Woźniak, P. A., & Gorzelańczyk, E. J. (1994). Optimization of repetition spacing. *Acta Neurobiologiae Experimentalis*.
- Corbett, A. T., & Anderson, J. R. (1995). Knowledge tracing. *UMUAI*.
