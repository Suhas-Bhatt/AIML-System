import { z } from "zod";
import { router, protectedProcedure } from '../trpc.js';
import { supabaseAdmin } from '../../lib/supabase/admin.js';

const periodEnum = z.enum([
  "current",
  "last7",
  "last30",
  "last90",
  "thisMonth",
]);

const filterInput = z.object({
  organizationId: z.string().optional(),
  period: periodEnum.optional(),
  projectId: z.string().optional(),
  tzOffset: z.number().optional(),
});

function toLocalDate(iso, tzOffset = 0) {
  const ms = new Date(iso).getTime() - tzOffset * 60_000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function resolveOrgId(userId, orgId) {
  if (orgId) return orgId;
  const { data } = await supabaseAdmin
    .from("organization_members")
    .select("workspaceId")
    .eq("userId", userId)
    .limit(1)
    .single();
  return data?.workspaceId ?? undefined;
}

function resolveCalendarPeriod(period) {
  const now = new Date();
  switch (period) {
    case "last7": {
      const s = new Date(now);
      s.setDate(s.getDate() - 7);
      return { start: s, end: now };
    }
    case "last30": {
      const s = new Date(now);
      s.setDate(s.getDate() - 30);
      return { start: s, end: now };
    }
    case "last90": {
      const s = new Date(now);
      s.setDate(s.getDate() - 90);
      return { start: s, end: now };
    }
    case "thisMonth":
    default: {
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: now,
      };
    }
  }
}

async function getProjectIds(orgId, projectId) {
  if (projectId) return [projectId];
  const { data } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("organizationId", orgId);
  return (data ?? []).map((p) => p.id);
}

async function getInterviewIds(projectIds) {
  if (projectIds.length === 0) return [];
  const { data } = await supabaseAdmin
    .from("interviews")
    .select("id")
    .in("projectId", projectIds);
  return (data ?? []).map((i) => i.id);
}

export const usageRouter = router({
  summary: protectedProcedure
    .input(filterInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const orgId = await resolveOrgId(userId, input.organizationId);

      const range = resolveCalendarPeriod(input.period);

      // --- Templates ---
      let templatesUsed = 0;
      if (orgId) {
        const pIds = await getProjectIds(orgId, input.projectId);
        if (pIds.length > 0) {
          const { count } = await supabaseAdmin
            .from("interviews")
            .select("id", { count: "exact", head: true })
            .in("projectId", pIds)
            .gte("createdAt", range.start.toISOString())
            .lte("createdAt", range.end.toISOString());
          templatesUsed = count ?? 0;
        }
      }

      // --- Session Time ---
      let sessionSecondsUsed = 0;
      if (orgId) {
        const pIds = await getProjectIds(orgId, input.projectId);
        const iIds = await getInterviewIds(pIds);
        if (iIds.length > 0) {
          const { data: sessions } = await supabaseAdmin
            .from("sessions")
            .select("totalDurationSeconds")
            .in("interviewId", iIds)
            .gte("createdAt", range.start.toISOString())
            .lte("createdAt", range.end.toISOString());
          sessionSecondsUsed = (sessions ?? []).reduce(
            (sum, s) => sum + (s.totalDurationSeconds ?? 0),
            0,
          );
        }
      }

      // --- Seats ---
      let seatsUsed = 1;
      if (orgId) {
        const { count } = await supabaseAdmin
          .from("organization_members")
          .select("id", { count: "exact", head: true })
          .eq("workspaceId", orgId);
        seatsUsed = count ?? 1;
      }

      // --- Daily breakdowns ---
      const days = [];
      const d = new Date(range.start);
      while (d <= range.end) {
        days.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }

      const tz = input.tzOffset ?? 0;

      // Sessions per day (duration)
      const sessionsByDay = {};
      if (orgId) {
        const pIds = await getProjectIds(orgId, input.projectId);
        const iIds = await getInterviewIds(pIds);
        if (iIds.length > 0) {
          const { data: allSessions } = await supabaseAdmin
            .from("sessions")
            .select("totalDurationSeconds, createdAt")
            .in("interviewId", iIds)
            .gte("createdAt", range.start.toISOString())
            .lte("createdAt", range.end.toISOString());
          for (const s of allSessions ?? []) {
            const day = toLocalDate(s.createdAt, tz);
            sessionsByDay[day] = (sessionsByDay[day] ?? 0) + (s.totalDurationSeconds ?? 0);
          }
        }
      }

      // Templates created per day
      const templatesByDay = {};
      if (orgId) {
        const pIds = await getProjectIds(orgId, input.projectId);
        if (pIds.length > 0) {
          const { data: allInterviews } = await supabaseAdmin
            .from("interviews")
            .select("createdAt")
            .in("projectId", pIds)
            .gte("createdAt", range.start.toISOString())
            .lte("createdAt", range.end.toISOString());
          for (const iv of allInterviews ?? []) {
            const day = toLocalDate(iv.createdAt, tz);
            templatesByDay[day] = (templatesByDay[day] ?? 0) + 1;
          }
        }
      }

      const daily = days.map((day) => ({
        date: day,
        aiTokens: 0,
        sessionMinutes: Math.round((sessionsByDay[day] ?? 0) / 60),
        templates: templatesByDay[day] ?? 0,
      }));

      return {
        periodStart: range.start.toISOString(),
        periodEnd: range.end.toISOString(),
        templates: {
          used: templatesUsed,
        },
        sessionTime: {
          usedSeconds: sessionSecondsUsed,
        },
        seats: {
          used: seatsUsed,
        },
        daily,
      };
    }),

  tokenTransactions: protectedProcedure
    .input(filterInput)
    .query(async () => {
      return [];
    }),

  sessionTransactions: protectedProcedure
    .input(filterInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const orgId = await resolveOrgId(userId, input.organizationId);
      if (!orgId) return [];

      const range = resolveCalendarPeriod(input.period);

      const pIds = await getProjectIds(orgId, input.projectId);
      const iIds = await getInterviewIds(pIds);
      if (iIds.length === 0) return [];

      const { data: sessions } = await supabaseAdmin
        .from("sessions")
        .select("id, interviewId, participantName, participantEmail, totalDurationSeconds, status, createdAt")
        .in("interviewId", iIds)
        .gte("createdAt", range.start.toISOString())
        .lte("createdAt", range.end.toISOString())
        .order("createdAt", { ascending: false })
        .limit(200);

      const uniqueIvIds = Array.from(new Set((sessions ?? []).map((s) => s.interviewId)));
      const ivTitleMap = {};
      if (uniqueIvIds.length > 0) {
        const { data: ivs } = await supabaseAdmin
          .from("interviews")
          .select("id, title")
          .in("id", uniqueIvIds);
        for (const iv of ivs ?? []) {
          ivTitleMap[iv.id] = iv.title;
        }
      }

      return (sessions ?? []).map((s) => ({
        id: s.id,
        interviewTitle: ivTitleMap[s.interviewId] ?? "Unknown",
        participant: s.participantName || s.participantEmail || "Anonymous",
        durationSeconds: s.totalDurationSeconds ?? 0,
        status: s.status,
        createdAt: s.createdAt,
      }));
    }),

  templateTransactions: protectedProcedure
    .input(filterInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const orgId = await resolveOrgId(userId, input.organizationId);
      if (!orgId) return [];

      const range = resolveCalendarPeriod(input.period);

      const pIds = await getProjectIds(orgId, input.projectId);
      if (pIds.length === 0) return [];

      const { data: projects } = await supabaseAdmin
        .from("projects")
        .select("id, name")
        .in("id", pIds);
      const projNameMap = {};
      for (const p of projects ?? []) {
        projNameMap[p.id] = p.name;
      }

      const { data: interviews } = await supabaseAdmin
        .from("interviews")
        .select("id, title, projectId, chatEnabled, voiceEnabled, videoEnabled, createdAt")
        .in("projectId", pIds)
        .gte("createdAt", range.start.toISOString())
        .lte("createdAt", range.end.toISOString())
        .order("createdAt", { ascending: false })
        .limit(200);

      const ivIds = (interviews ?? []).map((i) => i.id);
      const sessionCounts = {};
      if (ivIds.length > 0) {
        const { data: sessions } = await supabaseAdmin
          .from("sessions")
          .select("interviewId")
          .in("interviewId", ivIds);
        for (const s of sessions ?? []) {
          const key = s.interviewId;
          sessionCounts[key] = (sessionCounts[key] ?? 0) + 1;
        }
      }

      return (interviews ?? []).map((iv) => {
        const channels = [];
        if (iv.chatEnabled) channels.push("Chat");
        if (iv.voiceEnabled) channels.push("Voice");
        if (iv.videoEnabled) channels.push("Video");
        return {
          id: iv.id,
          title: iv.title,
          projectName: projNameMap[iv.projectId] ?? "Unknown",
          channels: channels.length > 0 ? channels : ["Chat"],
          sessionCount: sessionCounts[iv.id] ?? 0,
          createdAt: iv.createdAt,
        };
      });
    }),
});
