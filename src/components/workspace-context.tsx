"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  DEFAULT_CURRENCY,
  DEFAULT_TIME_ZONE,
  DEFAULT_USD_RATE,
  DEFAULT_WORKSPACE_NAME,
} from "@/lib/workspace";
import { todayIn } from "@/lib/dates";

type Workspace = {
  usdAedRate: number;
  baseCurrency: string;
  timeZone: string;
  workspaceName: string;
  /** URL of the custom logo, or null for the default mark. */
  logoSrc: string | null;
};

const WorkspaceContext = createContext<Workspace>({
  usdAedRate: DEFAULT_USD_RATE,
  baseCurrency: DEFAULT_CURRENCY,
  timeZone: DEFAULT_TIME_ZONE,
  workspaceName: DEFAULT_WORKSPACE_NAME,
  logoSrc: null,
});

/** Workspace settings that client components need: base currency, USD rate, time zone. */
export function WorkspaceProvider({
  usdAedRate,
  baseCurrency,
  timeZone,
  workspaceName,
  logoSrc,
  children,
}: Workspace & { children: ReactNode }) {
  return (
    <WorkspaceContext.Provider
      value={{ usdAedRate, baseCurrency, timeZone, workspaceName, logoSrc }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export const useWorkspace = () => useContext(WorkspaceContext);

/** Today's `YYYY-MM-DD` in the workspace time zone. */
export const useToday = () => todayIn(useWorkspace().timeZone);
