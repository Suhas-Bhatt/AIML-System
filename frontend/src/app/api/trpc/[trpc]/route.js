import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from '../../../../server/routers/_app.js';
import { createContext } from '../../../../server/context.js';

const handler = (req) => {
  console.log("--> TRPC route hit! URL:", req.url);
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
  });
};

export { handler as GET, handler as POST };
