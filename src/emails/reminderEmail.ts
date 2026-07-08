export type PlantHealth = "flowering" | "strong" | "fading" | "overdue";

export interface DueSkill {
  name: string;
  health: PlantHealth;
  retrievabilityPct: number | null;
  isNew: boolean;
}

const HEALTH_GLYPH: Record<PlantHealth, string> = {
  flowering: "✿",
  strong: "●",
  fading: "◑",
  overdue: "△",
};

const HEALTH_LABEL: Record<PlantHealth, string> = {
  flowering: "flowering",
  strong: "strong",
  fading: "fading",
  overdue: "overdue",
};

const HEALTH_COLOR: Record<PlantHealth, string> = {
  flowering: "#2d6a4f",
  strong: "#40916c",
  fading: "#b5821a",
  overdue: "#c44b2a",
};

function skillRow(skill: DueSkill): string {
  const glyph = HEALTH_GLYPH[skill.health];
  const label = skill.isNew ? "new" : HEALTH_LABEL[skill.health];
  const pct = skill.isNew || skill.retrievabilityPct === null ? "" : ` · ${skill.retrievabilityPct}% recall`;
  const color = HEALTH_COLOR[skill.health];
  return `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #e8e4de;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="28" style="font-size: 16px; color: ${color}; vertical-align: middle;">${glyph}</td>
            <td style="font-family: Georgia, serif; font-size: 15px; color: #1a1a1a; font-weight: 600; vertical-align: middle;">${escapeHtml(skill.name)}</td>
            <td style="text-align: right; font-family: monospace; font-size: 12px; color: #666; white-space: nowrap; vertical-align: middle;">${label}${pct}</td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSubject(dueSkills: DueSkill[]): string {
  if (dueSkills.length === 1) {
    return `${dueSkills[0].name} needs practice today`;
  }
  const overdue = dueSkills.filter((s) => s.health === "overdue" || s.isNew);
  if (overdue.length === 1) {
    return `${overdue[0].name} is overdue — and ${dueSkills.length - 1} more`;
  }
  return `${dueSkills.length} skills are waiting for you today`;
}

export function buildReminderEmail({
  displayName,
  dueSkills,
  appUrl,
  unsubscribeToken,
}: {
  displayName: string | null;
  dueSkills: DueSkill[];
  appUrl: string;
  unsubscribeToken: string;
}): string {
  const greeting = displayName ? `Good morning, ${escapeHtml(displayName)}` : "Good morning";
  const unsubscribeUrl = `${appUrl}/unsubscribe/${unsubscribeToken}`;
  const preferencesUrl = `${appUrl}/?settings=notifications`;

  const skillCount = dueSkills.length;
  const intro =
    skillCount === 1
      ? `One skill in your garden needs attention today.`
      : `${skillCount} skills in your garden need attention today.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Your garden needs tending</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f2ed; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f2ed; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 520px;">

          <!-- Header -->
          <tr>
            <td style="padding-bottom: 24px; text-align: center;">
              <span style="font-size: 22px; font-weight: 700; color: #2d6a4f; letter-spacing: -0.5px;">interleaf</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color: #ffffff; border-radius: 16px; padding: 32px; box-shadow: 0 1px 4px rgba(0,0,0,0.06);">

              <!-- Greeting -->
              <p style="margin: 0 0 4px 0; font-size: 20px; font-weight: 700; color: #1a1a1a; font-family: Georgia, serif;">
                ${greeting}
              </p>
              <p style="margin: 0 0 24px 0; font-size: 15px; color: #555; line-height: 1.5;">
                ${intro}
              </p>

              <!-- Skills table -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 28px;">
                ${dueSkills.map(skillRow).join("")}
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <a href="${appUrl}"
                       style="display: inline-block; background-color: #2d6a4f; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 36px; border-radius: 10px;">
                      Open your garden →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Science note -->
              <p style="margin: 28px 0 0 0; font-size: 12px; color: #888; line-height: 1.6; border-top: 1px solid #e8e4de; padding-top: 20px;">
                The Ebbinghaus forgetting curve shows that memories fade predictably without review.
                Interleaf surfaces your skills at the moment of maximum learning benefit —
                challenging enough to strengthen, not so late that you've forgotten.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top: 20px; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #999; line-height: 1.8;">
                You're receiving this because you enabled daily reminders in Interleaf.<br />
                <a href="${unsubscribeUrl}" style="color: #999; text-decoration: underline;">Unsubscribe</a>
                &nbsp;·&nbsp;
                <a href="${preferencesUrl}" style="color: #999; text-decoration: underline;">Change preferences</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
