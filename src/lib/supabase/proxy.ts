import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAllowedEmail } from "@/lib/allowed-email";
import { SESSION_HEADER } from "@/lib/session-header";

const PUBLIC_PATHS = ["/login", "/auth/callback"];

/**
 * Refreshes the Supabase session cookie and protects every route except /login.
 * Passes the verified identity to pages and server actions in SESSION_HEADER, so
 * requireUser() does not verify the same token again.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase environment variables are not set.");

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email as string | undefined;
  const signedIn = isAllowedEmail(email);

  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const redirectTo = (path: string, params?: Record<string, string>) => {
    const target = request.nextUrl.clone();
    target.pathname = path;
    target.search = "";
    for (const [k, v] of Object.entries(params ?? {})) target.searchParams.set(k, v);
    const redirect = NextResponse.redirect(target);
    // Keep any refreshed session cookies.
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!signedIn && !isPublic) {
    return redirectTo("/login", pathname === "/" ? {} : { next: `${pathname}${search}` });
  }
  if (signedIn && pathname === "/login") {
    return redirectTo("/");
  }

  // Forward the verified identity; never trust a copy sent by the client.
  const headers = new Headers(request.headers);
  headers.set(
    SESSION_HEADER,
    signedIn ? JSON.stringify({ email: email!.toLowerCase(), id: String(data!.claims.sub) }) : "-",
  );
  const forwarded = NextResponse.next({ request: { headers } });
  response.cookies.getAll().forEach((c) => forwarded.cookies.set(c));
  return forwarded;
}
