import { describe, it, expect } from "vitest";
import { applySm2, SM2_DEFAULTS } from "../sm2";

describe("applySm2", () => {
  it("first successful review → interval 1 day", () => {
    const result = applySm2(SM2_DEFAULTS, 4);
    expect(result.intervalDays).toBe(1);
    expect(result.repetitions).toBe(1);
  });

  it("second successful review → interval 6 days", () => {
    const after1 = applySm2(SM2_DEFAULTS, 4);
    const after2 = applySm2(after1, 4);
    expect(after2.intervalDays).toBe(6);
    expect(after2.repetitions).toBe(2);
  });

  it("third successful review multiplies interval by EF", () => {
    const after1 = applySm2(SM2_DEFAULTS, 5);
    const after2 = applySm2(after1, 5);
    const after3 = applySm2(after2, 5);
    expect(after3.intervalDays).toBe(Math.round(6 * after2.easeFactor));
    expect(after3.repetitions).toBe(3);
  });

  it("perfect scores (q=5) increase ease factor", () => {
    const result = applySm2(SM2_DEFAULTS, 5);
    expect(result.easeFactor).toBeGreaterThan(2.5);
  });

  it("q=3 decreases ease factor", () => {
    const result = applySm2(SM2_DEFAULTS, 3);
    expect(result.easeFactor).toBeLessThan(2.5);
  });

  it("ease factor never drops below 1.3", () => {
    let state = SM2_DEFAULTS;
    for (let i = 0; i < 20; i++) {
      state = applySm2(state, 3);
    }
    expect(state.easeFactor).toBe(1.3);
  });

  it("q < 3 resets repetitions and interval", () => {
    const after1 = applySm2(SM2_DEFAULTS, 5);
    const after2 = applySm2(after1, 5);
    const failed = applySm2(after2, 2);
    expect(failed.repetitions).toBe(0);
    expect(failed.intervalDays).toBe(1);
  });

  it("q=0 is the harshest failure — EF drops but floors at 1.3", () => {
    const result = applySm2(SM2_DEFAULTS, 0);
    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(1);
    expect(result.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it("repeated q=5 produces canonical interval sequence 1, 6, 16, …", () => {
    let state = SM2_DEFAULTS;
    const intervals: number[] = [];
    for (let i = 0; i < 5; i++) {
      state = applySm2(state, 5);
      intervals.push(state.intervalDays);
    }
    expect(intervals[0]).toBe(1);
    expect(intervals[1]).toBe(6);
    expect(intervals[2]).toBeGreaterThanOrEqual(15);
    expect(intervals[3]).toBeGreaterThan(intervals[2]);
  });

  it("throws on invalid quality", () => {
    expect(() => applySm2(SM2_DEFAULTS, -1)).toThrow();
    expect(() => applySm2(SM2_DEFAULTS, 6)).toThrow();
    expect(() => applySm2(SM2_DEFAULTS, 3.5)).toThrow();
  });
});
