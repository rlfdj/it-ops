import { requireUser } from "@/lib/auth";
import { getSidebarHidden } from "@/lib/preferences";
import { getNavCounts } from "@/lib/queries/nav-counts";
import { AppFrame } from "@/components/shell/app-frame";
import { ShellProvider } from "@/components/shell/shell-context";
import { SkipLink } from "@/components/shell/skip-link";
import { ToastProvider } from "@/components/shell/toast";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { CommandBar } from "@/components/shell/command-bar";
import { KeyboardShortcuts } from "@/components/shell/shortcuts";
import { ShortcutsSheet } from "@/components/shell/shortcuts-sheet";
import { WorkspaceProvider } from "@/components/workspace-context";
import { logoUrl } from "@/lib/workspace";
import { getWorkspaceSettings } from "@/lib/queries/settings";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  const [counts, sidebarHidden, settings] = await Promise.all([
    getNavCounts(),
    getSidebarHidden(),
    getWorkspaceSettings(),
  ]);

  return (
    <ShellProvider initialSidebarHidden={sidebarHidden}>
      <WorkspaceProvider
        usdAedRate={settings.usdAedRate}
        baseCurrency={settings.baseCurrency}
        timeZone={settings.timeZone}
        workspaceName={settings.workspaceName}
        logoSrc={logoUrl(settings.logoPath)}
      >
        <ToastProvider>
          <SkipLink />
          <Topbar counts={counts} />
          <AppFrame>
            <Sidebar counts={counts} />
            <div className="main">{children}</div>
          </AppFrame>
          <CommandBar />
          <KeyboardShortcuts />
          <ShortcutsSheet />
        </ToastProvider>
      </WorkspaceProvider>
    </ShellProvider>
  );
}
