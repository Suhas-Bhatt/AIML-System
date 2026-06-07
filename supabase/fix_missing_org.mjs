import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://qikmqjxmclriyuwwayup.supabase.co",
  // Service role key bypasses RLS
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpa21xanhtY2xyaXl1d3dheXVwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzgwNTk2MywiZXhwIjoyMDkzMzgxOTYzfQ._8GlMZ2O3-MTwDco7i4E5bcl2VjqYQI0Whjelyr-P40",
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// 1. Get all users from auth
const { data: authData, error: authErr } =
  await supabase.auth.admin.listUsers();
if (authErr) {
  console.error("Failed to list users:", authErr.message);
  process.exit(1);
}
const users = authData.users;
console.log(`Found ${users.length} user(s) in auth.users`);

// 2. Get existing memberships
const { data: existingMembers } = await supabase
  .from("organization_members")
  .select("userId");
const memberUserIds = new Set(
  (existingMembers ?? []).map((m) => m.userId)
);

// 3. Find orphan users
const orphans = users.filter((u) => !memberUserIds.has(u.id));
console.log(`${orphans.length} user(s) missing an organization`);

for (const user of orphans) {
  const orgId = crypto.randomUUID();
  const projId = crypto.randomUUID();
  const slug = `personal-${user.id}`;

  // Ensure profile
  await supabase
    .from("profiles")
    .upsert(
      { id: user.id, email: user.email, name: user.user_metadata?.full_name },
      { onConflict: "id" }
    );

  // Create org
  const { error: orgErr } = await supabase
    .from("organizations")
    .insert({ id: orgId, name: "Personal", slug, ownerId: user.id });

  if (orgErr) {
    console.log(`⚠️  Org already exists for ${user.email}: ${orgErr.message}`);
    continue;
  }

  // Add membership
  await supabase
    .from("organization_members")
    .insert({ workspaceId: orgId, userId: user.id, role: "OWNER" });

  // Create default project
  await supabase
    .from("projects")
    .insert({
      id: projId,
      organizationId: orgId,
      name: "Default",
      createdBy: user.id,
    });

  console.log(`✅ Bootstrapped org + project for ${user.email}`);
}

console.log("Done!");
