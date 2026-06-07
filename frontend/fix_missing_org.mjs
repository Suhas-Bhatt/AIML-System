import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://qikmqjxmclriyuwwayup.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpa21xanhtY2xyaXl1d3dheXVwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzgwNTk2MywiZXhwIjoyMDkzMzgxOTYzfQ._8GlMZ2O3-MTwDco7i4E5bcl2VjqYQI0Whjelyr-P40",
  { auth: { autoRefreshToken: false, persistSession: false } }
);

console.log("Analyzing database IDs mapping...");

const { data: authData } = await supabase.auth.admin.listUsers();
const users = authData.users;
console.log("Auth users ID and email:");
for (const u of users) {
  console.log(`- User ID: ${u.id}, Email: ${u.email}`);
}

const { data: orgs } = await supabase.from("organizations").select("*");
console.log("\nOrganizations:");
for (const o of orgs) {
  console.log(`- Org ID: ${o.id}, ownerId: ${o.ownerId}`);
}

const { data: members } = await supabase.from("organization_members").select("*");
console.log("\nOrganization Members:");
for (const m of members) {
  console.log(`- Member ID: ${m.id}, workspaceId: ${m.workspaceId}, userId: ${m.userId}`);
}

const { data: projects } = await supabase.from("projects").select("*");
console.log("\nProjects:");
for (const p of projects) {
  console.log(`- Project ID: ${p.id}, organizationId: ${p.organizationId}, createdBy: ${p.createdBy}`);
}

const { data: interviews } = await supabase.from("interviews").select("*");
console.log("\nInterviews:");
for (const i of interviews) {
  console.log(`- Interview ID: ${i.id}, projectId: ${i.projectId}, userId: ${i.userId}`);
}
