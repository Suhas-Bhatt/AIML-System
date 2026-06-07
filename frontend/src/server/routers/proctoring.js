import { aiClient } from '../../lib/ai-client.js';
import { z } from "zod";
import { publicProcedure, router } from '../trpc.js';
import { TRPCError } from "@trpc/server";

export const proctoringRouter = router({
  /**
   * Start a proctoring session in the AI service
   */
  start: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        referenceFrame: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await aiClient.startSession(input.sessionId, input.referenceFrame);
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to communicate with AI Proctoring Service",
          cause: error,
        });
      }
    }),

  /**
   * Stop a proctoring session in the AI service
   */
  stop: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const result = await aiClient.stopSession(input.sessionId);
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to communicate with AI Proctoring Service",
          cause: error,
        });
      }
    }),

  /**
   * Check if the AI service is online
   */
  health: publicProcedure.query(async () => {
    return await aiClient.getHealth();
  }),
});
