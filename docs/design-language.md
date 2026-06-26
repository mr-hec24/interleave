# Interleaf — Design Language

> **Status:** Living document. Captures the brand, visual metaphor, gamification
> philosophy, and accessibility commitments for Interleaf. Pairs with
> [`research-synthesis.md`](./research-synthesis.md), which covers the learning
> science. Where the two meet: every visual choice here is meant to *express*
> the learning model, not decorate it.

## 1. The name and the metaphor

The app is **Interleaf** — a play on *interleaving* (the core learning
principle) and *leaf* (the botanical identity). The entire visual language is a
**living garden**, chosen because plant growth is a genuine analog for how
memory works, not just a cute skin:

| App concept | Garden metaphor | Why it maps |
|-------------|-----------------|-------------|
| A skill | A plant / leaf | Grows with care, fades with neglect |
| A topic | A planter / pot | Groups related plants together |
| Memory strength (retrievability) | Plant health | Lush when retained, wilting when overdue |
| Interleaving | Vines intertwining | Mixing practice strengthens learning |
| A practice session | A leaf growing on a timer | Effort over time, blooming at completion |
| Long-term retention | Flowering | A milestone reached when intervals grow long |
| Archiving a skill | Compost | Nothing is destroyed; it feeds the soil (data preserved) |

A plant that is overwatered (crammed) suffers; one watered on the right schedule
(spaced) thrives. The metaphor *teaches the model* — a wilting leaf communicates
"this needs attention" more intuitively than "retrievability: 72%."

## 2. Tone and visual feel

- Calm, warm, encouraging, organic.
- Soft greens, earthy neutrals, natural textures.
- The opposite of a clinical productivity dashboard *or* a hyper-saturated
  mobile game. It should feel like tending a garden, not grinding XP.

## 3. Gamification philosophy

Gamification here must **reinforce the learning science, never fight it.** The
guiding rule: reward *durability of memory*, not *volume of activity*.

**Aligned mechanics (build these):**
- **Plant health = retrievability.** Each skill's vitality reflects its current
  memory strength, turning abstract numbers into an emotional signal.
- **The growing-leaf timer.** A leaf unfurls as a session runs and blooms
  exactly when the timer ends, so the reward completes *at the switch point* —
  continuing past the timer earns no further growth (see research-synthesis §4.2).
- **Flowering for durable memory.** A plant flowers when its review interval
  grows long (e.g. 30+ days) — rewarding retention, not frequency.
- **Intertwining vines for following the schedule.** Following the scheduler's
  recommendations grows and intertwines vines, gamifying the
  recommendation-acceptance-rate metric (research-synthesis §6) — the behavior we
  actually want to encourage.

**Anti-patterns (deliberately excluded):**
- ❌ **Points/XP per session or daily-login streaks** — rewards cramming and
  volume; someone who crams 10 sessions would "win" over someone spacing
  correctly, directly undermining the science.
- ❌ **Leaderboards / social comparison** — incentivizes adding easy skills for
  quick growth; self-directed learning is personal.
- ❌ **Loot / cosmetic unlocks unrelated to learning** — trains users to value
  the reward, not the learning.

## 4. Platforms

Interleaf ships as both a **native mobile app and a responsive web app**. The
design system must adapt across phone, tablet, and desktop:
- Mobile-first layouts that scale up gracefully.
- Touch targets that also work with mouse and keyboard.
- The garden dashboard is information-dense on desktop and focused on mobile;
  breakpoint behavior should be defined explicitly for it.

## 5. Theming: light and dark

A full **light and dark theme**, with dark mode treated as a first-class
design, not an inverted afterthought:
- Dark mode should read like a **garden at dusk/night**, not a mechanically
  inverted light theme.
- Both palettes defined explicitly.
- All states — plant health, timer, alerts, flowering — remain legible and
  on-brand in each theme.

## 6. Accessibility — non-negotiable

Interleaf is human-first; accessibility is a requirement, not a feature.

- **Never convey information by color alone.** This is the most important rule
  for this app specifically: plant health (retained / fading / overdue) is
  naturally color-coded (green / yellow / wilting), but ~1 in 12 men have color
  vision deficiency. Health MUST also be signaled non-chromatically:
  - **Posture** — upright (healthy) vs. drooping (overdue)
  - **Icon/badge** — e.g. a water-drop "needs attention" marker
  - **Text label** — explicit status text
  Redundant encoding makes the garden clearer for *everyone*, not only
  color-blind users.
- **WCAG 2.1 AA contrast** for all text and meaningful UI, in both themes.
- **Full keyboard operability** with visible focus states on every interactive
  element.
- **Screen-reader support.** The UI is heavily SVG/visual; every plant, vine,
  and timer state needs a text alternative conveying its *meaning*, so a blind
  user gets the same scheduling information a sighted user reads from the garden.
- **Respect "reduce motion."** The growing-leaf animation and vine/transition
  effects need a calm, non-animated fallback.
- **No time pressure that excludes.** The recall-rating step is never timed; the
  practice timer is a gentle nudge, never a hard wall.

## 7. Where the garden meets the math

The garden is the *friendly layer on top of* transparent, auditable scheduling
math — it never replaces or hides it. The dashboard must let users toggle
between:
- the **garden view** (emotional, at-a-glance plant health), and
- the **data view** (retrievability %, days since review, interval, priority).

This preserves the "visible reasoning" trust principle (research-synthesis §5):
a learner asked to override their own instincts deserves to see the real numbers
behind every recommendation, however pretty the garden on top.
