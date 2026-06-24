import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Dashboard from "@/components/Dashboard";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: skills } = await supabase
    .from("skills")
    .select("*, sr_state(*)")
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  const { data: recentSessions } = await supabase
    .from("sessions")
    .select("*, skills(name)")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <Dashboard
      user={user}
      skills={skills ?? []}
      recentSessions={recentSessions ?? []}
    />
  );
}
