"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { trpc } from '../lib/trpc/client.js';
import { useAuth } from '../components/auth-provider.jsx';

const STORAGE_KEY = "aural:currentOrgId";

const OrgContext = createContext({
  orgs: [],
  currentOrg: null,
  setCurrentOrg: () => {},
  isLoading: true,
});

export function OrgProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const { data: orgs = [], isLoading } = trpc.organization.list.useQuery(
    undefined,
    { staleTime: 30_000, enabled: !!user && !authLoading },
  );

  const [selectedOrgId, setSelectedOrgId] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY);
    }
    return null;
  });

  const currentOrg = useMemo(() => {
    if (orgs.length === 0) return null;
    const found = orgs.find((o) => o.id === selectedOrgId);
    return found ?? orgs[0];
  }, [orgs, selectedOrgId]);

  useEffect(() => {
    if (currentOrg && typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, currentOrg.id);
    }
  }, [currentOrg]);

  const setCurrentOrg = useCallback((orgId) => {
    setSelectedOrgId(orgId);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, orgId);
    }
  }, []);

  const value = useMemo(
    () => ({
      orgs,
      currentOrg,
      setCurrentOrg,
      isLoading,
    }),
    [orgs, currentOrg, setCurrentOrg, isLoading],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  return useContext(OrgContext);
}
