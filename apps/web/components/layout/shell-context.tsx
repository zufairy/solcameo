"use client";

import { createContext, useContext } from "react";

const ShellContext = createContext(false);

/** Provided as `true` by <SolstarShell>. Legacy chrome (AppShell, TopNav, ...) defers when set. */
export const ShellProvider = ShellContext.Provider;

export function useInSolstarShell(): boolean {
  return useContext(ShellContext);
}
