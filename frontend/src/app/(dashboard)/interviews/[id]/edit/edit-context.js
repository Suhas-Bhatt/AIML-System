"use client";

import { createContext, useContext } from "react";

const EditInterviewContext = createContext(null);

export const EditInterviewProvider = EditInterviewContext.Provider;

export function useEditInterview() {
  const ctx = useContext(EditInterviewContext);
  if (!ctx) throw new Error("useEditInterview must be used within EditInterviewProvider");
  return ctx;
}
