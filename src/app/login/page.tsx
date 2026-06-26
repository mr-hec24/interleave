"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Plant from "@/components/Plant";

// Bright leaf palette so decorative plants pop on the deep-green panel in
// both themes (mirrors the design's dark-theme plant colors).
const PANEL_VARS = {
  "--green": "oklch(0.72 0.14 152)",
  "--green-deep": "oklch(0.60 0.13 152)",
  "--amber": "oklch(0.79 0.12 106)",
  "--sage": "oklch(0.66 0.04 150)",
  "--bloom": "oklch(0.80 0.10 350)",
  "--clay": "oklch(0.55 0.09 50)",
} as React.CSSProperties;

function Wordmark() {
  return (
    <div className="flex items-center gap-3">
      <svg width="34" height="34" viewBox="0 0 120 120" aria-hidden="true">
        <path
          d="M47.58,13.64 C 89.97,25.06 102.39,71.42 72.42,106.36 C 28.99,91.08 16.57,44.72 47.58,13.64 Z"
          fill="oklch(0.96 0.04 150)"
        />
        <path
          d="M71.39,102.50 C 51.66,82.94 71.45,48.65 49.13,19.43"
          fill="none"
          stroke="oklch(0.40 0.07 152)"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-round font-semibold text-[26px] text-[oklch(0.97_0.02_150)]">
        interleaf
      </span>
    </div>
  );
}

function Panel({ mode }: { mode: "login" | "signup" }) {
  return (
    <div
      className="hidden md:flex flex-col justify-between p-10 bg-[oklch(0.40_0.07_152)]"
      style={PANEL_VARS}
    >
      <Wordmark />

      {mode === "login" ? (
        <div>
          <div className="font-display font-semibold text-[34px] leading-tight text-[oklch(0.97_0.02_150)]">
            Welcome back to
            <br />
            your garden.
          </div>
          <p className="text-[15px] leading-relaxed text-[oklch(0.88_0.04_150)] mt-3.5 max-w-[300px]">
            Your plants kept their own schedule while you were away. Let&apos;s
            see what&apos;s ready for water.
          </p>
        </div>
      ) : (
        <div>
          <div className="font-display font-semibold text-[30px] leading-tight text-[oklch(0.97_0.02_150)]">
            Learning, the way memory actually works.
          </div>
          <div className="flex flex-col gap-3 mt-5">
            {[
              "The schedule decides — you just tend.",
              "Rewards durable memory, never streaks.",
              "The real numbers, always visible.",
            ].map((t) => (
              <div
                key={t}
                className="flex items-center gap-2.5 text-sm font-medium text-[oklch(0.90_0.04_150)]"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.80_0.12_150)]" />
                {t}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-end justify-center gap-0.5">
        <Plant health="strong" label="" decorative size={64} showText={false} />
        <Plant health="flowering" label="" decorative size={72} showText={false} />
        <Plant health="fading" label="" decorative size={58} showText={false} />
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: name.trim() || null } },
      });
      if (error) {
        setError(error.message || `Signup failed (${error.status})`);
      } else {
        setMessage("Check your email to confirm your account.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(error.message || `Sign-in failed (${error.status})`);
      } else {
        router.push("/");
        router.refresh();
      }
    }
    setLoading(false);
  }

  const labelCls = "block text-xs font-semibold text-ink mb-1.5";
  const inputCls =
    "w-full box-border text-[15px] font-medium text-ink bg-surface border border-edge rounded-xl px-3.5 py-3 placeholder-ink-mute focus:outline-none focus:border-green focus:ring-2 focus:ring-green/40";

  const Form = (
    <div className="flex flex-col justify-center p-10 sm:p-14">
      <div className="w-full max-w-[380px] mx-auto">
        <div className="font-display font-semibold text-[28px] text-ink">
          {isSignUp ? "Plant your first garden" : "Log in"}
        </div>
        <p className="text-sm text-ink-soft mt-1.5 mb-7">
          {isSignUp ? "Free to start. No credit card." : "Enter your details to continue."}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div>
              <label className={labelCls} htmlFor="su-name">
                Your name
              </label>
              <input
                id="su-name"
                type="text"
                placeholder="Maya Okonkwo"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
              />
            </div>
          )}

          <div>
            <label className={labelCls} htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls} htmlFor="auth-pw">
              Password
            </label>
            <div className="relative">
              <input
                id="auth-pw"
                type={showPw ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className={`${inputCls} pr-16`}
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-medium text-ink-soft hover:text-ink"
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-green-deep">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full font-semibold text-on-green bg-green-btn rounded-xl py-3.5 disabled:opacity-50"
          >
            {loading
              ? "Please wait…"
              : isSignUp
                ? "Create account"
                : "Log in"}
          </button>
        </form>

        {isSignUp && (
          <p className="text-[11px] leading-relaxed text-ink-mute text-center mt-3.5">
            By continuing you agree to our Terms &amp; Privacy Policy.
          </p>
        )}

        <p className="text-sm text-ink-soft text-center mt-6">
          {isSignUp ? "Already have an account? " : "New to Interleaf? "}
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError(null);
              setMessage(null);
            }}
            className="text-green-deep font-semibold hover:underline"
          >
            {isSignUp ? "Log in" : "Create an account"}
          </button>
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper p-4">
      <div className="w-full max-w-4xl bg-surface border border-edge rounded-2xl shadow-[var(--shadow)] overflow-hidden grid md:grid-cols-2 min-h-[580px]">
        {isSignUp ? (
          <>
            {Form}
            <Panel mode="signup" />
          </>
        ) : (
          <>
            <Panel mode="login" />
            {Form}
          </>
        )}
      </div>
    </div>
  );
}
