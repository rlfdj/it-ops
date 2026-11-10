import Link from "@/components/link";
import { AppMark } from "@/components/shell/logo";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import { DEFAULT_SETTINGS, logoUrl } from "@/lib/workspace";

export default async function NotFound() {
  const settings = await getWorkspaceSettings().catch(() => DEFAULT_SETTINGS);
  return (
    <main className="login-wrap">
      <div className="empty self-center">
        <span className={`wordmark mb-2 ${settings.logoPath ? "on-bar" : "h-auto! p-0!"}`}>
          <AppMark height={26} name={settings.workspaceName} logoSrc={logoUrl(settings.logoPath)} />
        </span>
        <b>Page not found</b>
        <span>That page doesn’t exist.</span>
        <Link className="btn pri mt-3" href="/">
          Go to Dashboard
        </Link>
      </div>
      <footer className="login-foot">
        <span>{settings.workspaceName}</span>
      </footer>
    </main>
  );
}
