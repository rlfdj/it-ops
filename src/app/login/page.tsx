import type { Metadata } from "next";
import { AppMark } from "@/components/shell/logo";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import { DEFAULT_SETTINGS, logoUrl } from "@/lib/workspace";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Request a new one.",
  "not-allowed": "That account can’t sign in here.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const settings = await getWorkspaceSettings().catch(() => DEFAULT_SETTINGS);
  const params = await searchParams;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const next =
    typeof params.next === "string" && params.next.startsWith("/") ? params.next : undefined;

  return (
    <main className="login-wrap">
      <div className="login-card">
        <span className={`wordmark ${settings.logoPath ? "on-bar" : "h-auto! p-0!"}`}>
          <AppMark height={26} name={settings.workspaceName} logoSrc={logoUrl(settings.logoPath)} />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="h1">Sign in</h1>
          <p className="m-0 text-ink2">We’ll email you a one-time sign-in link.</p>
        </div>
        {error ? (
          <p className="alert red sm" role="alert">
            {error}
          </p>
        ) : null}
        <LoginForm next={next} />
      </div>
      <footer className="login-foot">
        <span>{settings.workspaceName}</span>
      </footer>
    </main>
  );
}
