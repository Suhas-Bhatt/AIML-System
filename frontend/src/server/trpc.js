// ✅ PRODUCTION FIX: src/server/trpc.js
// CRITICAL BUG FIXED: Authentication enforcement restored (was disabled for "local testing")
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";

const FRIENDLY_MESSAGES = {
  FORBIDDEN: "You don't have permission to perform this action. Please contact your admin for access.",
  UNAUTHORIZED: "You need to sign in to continue.",
  NOT_FOUND: "The requested resource was not found.",
};

const t = initTRPC.context().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const hasCustomMessage = error.message !== error.code;
    return {
      ...shape,
      message: hasCustomMessage
        ? error.message
        : FRIENDLY_MESSAGES[error.code] ?? shape.message,
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

// ✅ FIXED: Auth check is now ENFORCED (was commented out with "local UI testing" note)
const enforceUserIsAuthed = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { user: ctx.user },
  });
});

export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);

/* ------------------------------------------------------------------ */
/*  RBAC helpers                                                       */
/* ------------------------------------------------------------------ */

const ROLE_HIERARCHY = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function hasMinRole(actual, required) {
  return ROLE_HIERARCHY[actual] >= ROLE_HIERARCHY[required];
}

export function assertMinRole(actual, required) {
  if (!hasMinRole(actual, required)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You need at least ${required} permission to perform this action. Your current role is ${actual}.`,
    });
  }
}

export async function getOrgMembership(supabase, organizationId, userId) {
  const { data } = await supabase
    .from("organization_members")
    .select("role")
    .eq("workspaceId", organizationId)
    .eq("userId", userId)
    .single();
  return data;
}

export async function hasProjectAccess(supabase, projectId, userId) {
  const { data } = await supabase
    .from("project_members")
    .select("id")
    .eq("projectId", projectId)
    .eq("userId", userId)
    .maybeSingle();
  if (data) return true;
  // Also allow org-level admin/owner access
  const { data: proj } = await supabase
    .from("projects")
    .select("organizationId")
    .eq("id", projectId)
    .single();
  if (!proj) return false;
  const membership = await getOrgMembership(supabase, proj.organizationId, userId);
  return membership && hasMinRole(membership.role, "ADMIN");
}

export async function getEffectiveProjectRole(supabase, projectId, userId, orgRole) {
  const { data: pm } = await supabase
    .from("project_members")
    .select("role")
    .eq("projectId", projectId)
    .eq("userId", userId)
    .maybeSingle();
  if (pm?.role) return pm.role;
  return orgRole;
}

export async function filterAccessibleProjectIds(supabase, projectIds, userId) {
  if (!projectIds || projectIds.length === 0) return [];

  // 1. Get all orgs where user is ADMIN or OWNER
  const { data: adminOrgs } = await supabase
    .from("organization_members")
    .select("workspaceId")
    .eq("userId", userId)
    .in("role", ["ADMIN", "OWNER"]);

  const adminOrgIds = (adminOrgs ?? []).map(m => m.workspaceId);

  let adminProjectIds = [];
  if (adminOrgIds.length > 0) {
    const { data: adminProjs } = await supabase
      .from("projects")
      .select("id")
      .in("organizationId", adminOrgIds)
      .in("id", projectIds);
    adminProjectIds = (adminProjs ?? []).map(p => p.id);
  }

  // 2. Get projects where user is explicitly a member
  const { data: memberProjs } = await supabase
    .from("project_members")
    .select("projectId")
    .eq("userId", userId)
    .in("projectId", projectIds);

  const explicitProjectIds = (memberProjs ?? []).map(p => p.projectId);

  // 3. Combine and deduplicate
  return [...new Set([...adminProjectIds, ...explicitProjectIds])];
}
