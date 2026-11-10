import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { documentDownloadName } from "@/server/documents";
import { createClient } from "@/lib/supabase/server";

/**
 * Shows a stored document in the browser under its conventional name. The URL ends in that
 * name and the response says it too, so the browser tab, the PDF viewer's own save button
 * and "Save as" on phones all offer the convention name instead of the uploaded one. (A
 * signed storage URL would show the stored path, which keeps the uploaded name.) With
 * ?download it is sent as an attachment from this origin, so it saves at once (browsers
 * ignore the download attribute on a cross-origin storage URL and often just open it).
 */
export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/documents/[id]/[name]">,
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.nextUrl.origin));

  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new NextResponse("Not found", { status: 404 });

  const [doc] = await getDb()
    .select({ storagePath: documents.storagePath, fileName: documents.fileName })
    .from(documents)
    .where(eq(documents.id, id.data));
  if (!doc) return new NextResponse("Not found", { status: 404 });

  const name = (await documentDownloadName(getDb(), id.data)) ?? doc.fileName;
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("documents").download(doc.storagePath);
  if (error || !data) return new NextResponse("Could not open the document.", { status: 502 });

  // ?download saves it straight away; otherwise the browser shows it.
  const disposition = request.nextUrl.searchParams.has("download") ? "attachment" : "inline";
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new NextResponse(data.stream(), {
    headers: {
      "Content-Type": data.type || typeFor(name),
      "Content-Length": String(data.size),
      "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};
const typeFor = (name: string) =>
  TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
