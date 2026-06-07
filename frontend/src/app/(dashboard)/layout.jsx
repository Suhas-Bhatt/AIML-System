// FIXED: src/app/(dashboard)/layout.jsx
// Auth redirect is now ENFORCED (was commented out)
import { DashboardShell } from '../../components/layout/sidebar.jsx';
import { createClient } from '../../lib/supabase/server.js';
import { redirect } from "next/navigation";

export default async function DashboardLayout({ children }) {
  const supabase = await createClient();
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) redirect("/login");
  } catch {
    redirect("/login");
  }
  return <DashboardShell>{children}</DashboardShell>;
}
