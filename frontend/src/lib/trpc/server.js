import "server-only";
import { createContext } from '../../server/context.js';
import { appRouter } from '../../server/routers/_app.js';

export async function serverTrpc() {
  const ctx = await createContext();
  return appRouter.createCaller(ctx);
}
