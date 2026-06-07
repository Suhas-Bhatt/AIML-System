"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from '../lib/trpc/client.js';
import { AuthProvider } from '../components/auth-provider.jsx';
import { AppLocaleProvider } from '../components/app-locale-provider.jsx';
import { OrgProvider } from '../components/org-provider.jsx';
import { ProjectProvider } from '../components/project-provider.jsx';
import { ThemeProvider } from "next-themes";
import superjson from "superjson";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function Providers({ children }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,          // 1 minute
        cacheTime: 5 * 60 * 1000,      // 5 minutes
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }));
  const [trpcClient] = useState(() =>
    trpc.createClient({
      transformer: superjson,
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          // Batch window: collect requests for 50ms then fire as one HTTP call
          maxURLLength: 2083,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppLocaleProvider>
            <OrgProvider>
              <ProjectProvider>
                <ThemeProvider
                  attribute="class"
                  defaultTheme="system"
                  enableSystem
                >
                  {children}
                </ThemeProvider>
              </ProjectProvider>
            </OrgProvider>
          </AppLocaleProvider>
        </AuthProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
