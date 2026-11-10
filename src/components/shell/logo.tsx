"use client";

import { useWorkspace } from "@/components/workspace-context";
import { DEFAULT_WORKSPACE_NAME } from "@/lib/workspace";

// The default mark (public/brand/mark.svg): a rounded square with "IT", drawn square.
const LOGO_SRC = "/brand/mark.svg";

export function ItOpsLogo({ height = 20 }: { height?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static brand asset
    <img
      src={LOGO_SRC}
      alt=""
      width={height}
      height={height}
      style={{ height, width: height }}
      draggable={false}
    />
  );
}

/**
 * The brand: the default mark, or the workspace's own logo when one is uploaded (shown as
 * uploaded, height-only, never recoloured), followed by the workspace name.
 */
export function AppMark({
  height = 20,
  name = DEFAULT_WORKSPACE_NAME,
  logoSrc = null,
}: {
  height?: number;
  name?: string;
  logoSrc?: string | null;
}) {
  return (
    <>
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- the uploaded logo, served by /brand/logo
        <img
          src={logoSrc}
          alt=""
          className="custom-logo"
          style={{ height, width: "auto" }}
          draggable={false}
        />
      ) : (
        <ItOpsLogo height={height} />
      )}
      <span className="cap">{name}</span>
    </>
  );
}

/** AppMark from the workspace settings (client components inside the app shell). */
export function WorkspaceMark({ height = 20 }: { height?: number }) {
  const { workspaceName, logoSrc } = useWorkspace();
  return <AppMark height={height} name={workspaceName} logoSrc={logoSrc} />;
}
