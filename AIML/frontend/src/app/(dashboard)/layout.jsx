import { DashboardShell } from '../../components/layout/sidebar.jsx';
import { createClient } from '../../lib/supabase/server.js';
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <DashboardShell>{children}</DashboardShell>;
}
