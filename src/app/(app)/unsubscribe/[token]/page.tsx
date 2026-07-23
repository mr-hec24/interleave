import { createAdminClient } from "@/lib/supabase/admin";

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = createAdminClient();

  const { data: profile } = await db
    .from("profiles")
    .select("id, notifications_enabled")
    .eq("unsubscribe_token", token)
    .single();

  let status: "success" | "already" | "invalid";

  if (!profile) {
    status = "invalid";
  } else if (!profile.notifications_enabled) {
    status = "already";
  } else {
    const { error } = await db
      .from("profiles")
      .update({ notifications_enabled: false })
      .eq("id", profile.id);
    status = error ? "invalid" : "success";
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f2ed",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        padding: "24px",
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "16px",
          padding: "40px 36px",
          maxWidth: "420px",
          width: "100%",
          textAlign: "center",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        }}
      >
        {status === "success" && (
          <>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>✓</div>
            <h1
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "#1a1a1a",
                margin: "0 0 12px 0",
                fontFamily: "Georgia, serif",
              }}
            >
              You&apos;re unsubscribed
            </h1>
            <p style={{ fontSize: "15px", color: "#555", lineHeight: 1.6, margin: "0 0 24px 0" }}>
              You won&apos;t receive daily reminder emails anymore. You can turn them back on anytime
              in your account settings.
            </p>
          </>
        )}

        {status === "already" && (
          <>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>◑</div>
            <h1
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "#1a1a1a",
                margin: "0 0 12px 0",
                fontFamily: "Georgia, serif",
              }}
            >
              Already unsubscribed
            </h1>
            <p style={{ fontSize: "15px", color: "#555", lineHeight: 1.6, margin: "0 0 24px 0" }}>
              Daily reminders are already turned off for your account.
            </p>
          </>
        )}

        {status === "invalid" && (
          <>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>△</div>
            <h1
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "#1a1a1a",
                margin: "0 0 12px 0",
                fontFamily: "Georgia, serif",
              }}
            >
              Link not recognised
            </h1>
            <p style={{ fontSize: "15px", color: "#555", lineHeight: 1.6, margin: "0 0 24px 0" }}>
              This unsubscribe link may have expired or already been used. Sign in to manage your
              notification preferences from your account settings.
            </p>
          </>
        )}

        <a
          href="/"
          style={{
            display: "inline-block",
            background: "#2d6a4f",
            color: "#ffffff",
            fontSize: "14px",
            fontWeight: 600,
            textDecoration: "none",
            padding: "12px 28px",
            borderRadius: "10px",
          }}
        >
          Back to interleaf
        </a>
      </div>
    </div>
  );
}
