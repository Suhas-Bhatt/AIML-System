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
import { useOrg } from '../components/org-provider.jsx';

const STORAGE_KEY = "aural:currentProjectId";

const ProjectContext = createContext({
  projects: [],
  currentProject: null,
  setCurrentProject: () => {},
  isLoading: true,
});

export function ProjectProvider({ children }) {
  const { currentOrg } = useOrg();

  const { data: projects = [], isLoading } = trpc.project.list.useQuery(
    { organizationId: currentOrg?.id ?? "" },
    { enabled: !!currentOrg, staleTime: 30_000 },
  );

  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY);
    }
    return null;
  });

  // Reset project selection when org changes
  useEffect(() => {
    setSelectedProjectId(null);
  }, [currentOrg?.id]);

  const currentProject = useMemo(() => {
    if (projects.length === 0) return null;
    const found = projects.find((p) => p.id === selectedProjectId);
    return found ?? projects[0];
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (currentProject && typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, currentProject.id);
    }
  }, [currentProject]);

  const setCurrentProject = useCallback((projectId) => {
    setSelectedProjectId(projectId);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, projectId);
    }
  }, []);

  const value = useMemo(
    () => ({
      projects,
      currentProject,
      setCurrentProject,
      isLoading,
    }),
    [projects, currentProject, setCurrentProject, isLoading],
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}
