import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import { createClient } from "@/lib/supabase/server";

const TYPES: Record<string, string> = {
  png: "image/png",
  svg: "image/svg+xml",
  jpg: "image/jpeg",
};

const fallback = (request: Request) =>
  new Response(null, {
    status: 302,
    headers: {
      location: new URL("/brand/mark.svg", request.url).toString(),
      "cache-control": "no-store",
    },
  });

/**
 * The workspace's custom logo, served by the app because the documents bucket is private
 * and the login page has no session. Falls back to the default mark when there is no
 * custom logo or it cannot be read. `/brand/*` bypasses the sign-in proxy on purpose.
 */
export async function GET(request: Request) {
  try {
    const { logoPath } = await getWorkspaceSettings();
    if (!logoPath) return fallback(request);

    let file: Blob | null = null;
    // The signed-in user's session first; the server key covers the login page.
    const session = await createClient();
    ({ data: file } = await session.storage.from("documents").download(logoPath));
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!file && secret) {
      const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      ({ data: file } = await admin.storage.from("documents").download(logoPath));
    }
    if (!file) return fallback(request);

    return new Response(await file.arrayBuffer(), {
      headers: {
        "content-type": TYPES[logoPath.split(".").pop() ?? ""] ?? "application/octet-stream",
        "cache-control": "public, max-age=3600",
        "x-content-type-options": "nosniff",
        // An SVG opened on its own cannot run script; as an <img> it never could.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch {
    return fallback(request);
  }
}
