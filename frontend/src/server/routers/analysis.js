import { supabaseAdmin } from '../../lib/supabase/admin.js';
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getOrgMembership, hasProjectAccess, protectedProcedure, router } from '../trpc.js';

async function resolveSignedUrl(bucket, path) {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 24); // 24 hours
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export const analysisRouter = router({
  getSessionSummary: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { data: session } = await ctx.supabase
        .from("sessions")
        .select(
          `*, interview:interviews!inner(userId, title, objective, projectId, project:projects!inner(organizationId)), messages(*)`,
        )
        .eq("id", input.sessionId)
        .order("timestamp", { referencedTable: "messages", ascending: true })
        .single();

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const interview = session.interview;

      const membership = await getOrgMembership(ctx.supabase, interview.project.organizationId, ctx.user.id);
      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
      }

      const projAccess = await hasProjectAccess(ctx.supabase, interview.projectId, ctx.user.id);
      if (!projAccess) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this project" });
      }

      // Generate fresh signed URLs for recordings and screenshots
      let audioRecordingUrl = null;
      if (session.audioRecordingUrl) {
        // Extract path from stored URL or use directly if it's a path
        const storedUrl = session.audioRecordingUrl;
        const pathMatch = storedUrl.match(/\/recordings\/(.+?)(?:\?|$)/);
        if (pathMatch) {
          audioRecordingUrl = await resolveSignedUrl("recordings", pathMatch[1]);
        }
        if (!audioRecordingUrl) {
          audioRecordingUrl = storedUrl;
        }
      }

      let screenshots = null;
      const rawScreenshots = session.screenshots;
      if (rawScreenshots && rawScreenshots.length > 0) {
        screenshots = await Promise.all(
          rawScreenshots.map(async (s) => {
            const signed = s.path
              ? await resolveSignedUrl("screenshots", s.path)
              : null;
            return { ...s, url: signed || s.url };
          }),
        );
      }

      return {
        interviewTitle: interview.title,
        interviewObjective: interview.objective,
        participantName: session.participantName,
        participantEmail: session.participantEmail,
        status: session.status,
        createdAt: session.createdAt,
        summary: session.summary,
        insights: session.insights,
        themes: session.themes,
        sentiment: session.sentiment,
        messages: session.messages,
        totalDurationSeconds: session.totalDurationSeconds,
        audioRecordingUrl,
        audioDuration: session.audioDuration,
        screenshots,
        antiCheatingLog: session.antiCheatingLog,
      };
    }),

  getInterviewInsights: protectedProcedure
    .input(z.object({ interviewId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { data: interview } = await ctx.supabase
        .from("interviews")
        .select("id, projectId, project:projects!inner(organizationId)")
        .eq("id", input.interviewId)
        .single();

      if (!interview) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const project = interview.project;
      const membership = await getOrgMembership(ctx.supabase, project.organizationId, ctx.user.id);
      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
      }

      const projAccess = await hasProjectAccess(ctx.supabase, interview.projectId, ctx.user.id);
      if (!projAccess) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this project" });
      }

      const { data: sessions } = await ctx.supabase
        .from("sessions")
        .select("participantEmail, totalDurationSeconds, themes, messages(id)")
        .eq("interviewId", input.interviewId)
        .eq("status", "COMPLETED");

      const completedSessions = sessions ?? [];
      const totalSessions = completedSessions.length;
      const avgDuration =
        totalSessions > 0
          ? completedSessions.reduce(
              (sum, s) => sum + (s.totalDurationSeconds ?? 0),
              0,
            ) / totalSessions
          : 0;

      const totalMessages = completedSessions.reduce(
        (sum, s) => sum + (s.messages?.length ?? 0),
        0,
      );

      const uniqueEmails = new Set(
        completedSessions
          .map((s) => s.participantEmail)
          .filter((e) => !!e),
      );

      const allThemes = completedSessions.flatMap((s) => s.themes ?? []);
      const themeCounts = {};
      for (const theme of allThemes) {
        themeCounts[theme] = (themeCounts[theme] ?? 0) + 1;
      }

      return {
        totalSessions,
        totalMessages,
        totalParticipants: uniqueEmails.size,
        avgDurationSeconds: Math.round(avgDuration),
        topThemes: Object.entries(themeCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10),
      };
    }),
});
