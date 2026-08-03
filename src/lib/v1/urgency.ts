/**
 * §4 — Urgency: saturating desirable-difficulty targeting.
 *
 * Prioritise skills whose retrievability sits in the desirable-difficulty band:
 * effortful but still likely-successful retrieval, targeted at θ ≈ 0.35.
 *
 * ## Why the shape is asymmetric, and why that is the whole point
 *
 * The obvious choice — a symmetric Gaussian centred on θ — is rejected by the spec,
 * and the reason is a failure mode rather than an aesthetic preference. Under
 * exp(−(R−θ)²/2σ²), urgency *decays as R falls below θ*. A skill that has been
 * neglected until R = 0.05 would be scored as barely worth reviewing, so it would
 * keep losing the argmax to healthier skills, so it would decay further, so it would
 * score even lower. The items most in need of rescue would be the ones the scheduler
 * permanently deprioritises — a death spiral, and one that gets worse the longer it
 * runs.
 *
 * It also contradicts the optimal-review-intensity result the design leans on
 * elsewhere: MEMORIZE (Tabibian et al., 2019) finds review intensity monotone in
 * (1 − R). Nothing about being *more* forgotten should make review less urgent.
 *
 * So the left half is clamped to 1: at or below target, a skill is maximally urgent
 * and stays maximally urgent. Only the right half — reviewing too *early*, where the
 * spacing opportunity is genuinely being wasted — is penalised.
 *
 *     D_i = 1                              if R ≤ θ
 *     D_i = exp(−(R − θ)² / 2σ²)           if R > θ
 *
 * Both θ and σ are hyperparameters, and §11 lists saturating-vs-asymmetric-Gaussian
 * as an early A/B on overdue-item recovery rate.
 */

/**
 * D_i(t) — urgency on (0, 1].
 *
 * @param r      retrievability, [0,1]
 * @param theta  target retrievability (v1 default 0.35)
 * @param sigma  tolerance of the band (v1 default 0.15)
 */
export function urgency(r: number, theta: number, sigma: number): number {
  if (sigma <= 0) {
    throw new Error(`urgency: sigma must be positive, got ${sigma}`);
  }
  // Saturating branch. An overdue skill does not become less urgent by being
  // more overdue — see the death-spiral note above.
  if (r <= theta) return 1;
  const z = (r - theta) / sigma;
  return Math.exp(-(z * z) / 2);
}

/**
 * How far past the desirable-difficulty band a skill is, in units of σ.
 *
 * Purely for explanation surfaces — the dashboard needs to say *why* something is
 * or is not urgent, and "0.4σ above target" is auditable in a way that a bare
 * utility number is not. Negative means at or below target (maximally urgent).
 */
export function bandOffset(r: number, theta: number, sigma: number): number {
  if (sigma <= 0) return 0;
  return (r - theta) / sigma;
}
