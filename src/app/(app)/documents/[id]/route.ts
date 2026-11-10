import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { documentDownloadName } from "@/server/documents";

/** Opens a stored document under its conventional name; ?download saves it instead. */
export async function GET(request: NextRequest, { params }: RouteContext<"/documents/[id]">) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.nextUrl.origin));

  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new NextResponse("Not found", { status: 404 });

  const [doc] = await getDb()
    .select({ fileName: documents.fileName })
    .from(documents)
    .where(eq(documents.id, id.data));
  if (!doc) return new NextResponse("Not found", { status: 404 });

  // The name follows the naming convention, computed from current data.
  const name = (await documentDownloadName(getDb(), id.data)) ?? doc.fileName;
  // Both go to a URL on this site that ends in that name: viewing shows it, ?download
  // saves it straight away (see ./[name]/route.ts).
  const download = request.nextUrl.searchParams.has("download") ? "?download" : "";
  return NextResponse.redirect(
    new URL(`/documents/${id.data}/${encodeURIComponent(name)}${download}`, request.nextUrl.origin),
  );
}
