"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { actionFail as fail } from "@/lib/action-fail";
import { DomainError } from "@/lib/domain-error";
import { documentDownloadName } from "@/server/documents";
import type { ActionResult } from "@/lib/uploads";

/**
 * Where the in-app preview loads the document from: the app's own /documents/{id}/{name}
 * URL, so it shows (and saves from the viewer) under the conventional name.
 */
export async function getDocumentPreview(
  id: string,
): Promise<ActionResult<{ url: string; fileName: string }>> {
  try {
    await requireUser();
    const docId = z.uuid().parse(id);
    const [doc] = await getDb()
      .select({ fileName: documents.fileName })
      .from(documents)
      .where(eq(documents.id, docId));
    if (!doc) throw new DomainError("Document not found.");
    const fileName = (await documentDownloadName(getDb(), docId)) ?? doc.fileName;
    return {
      ok: true,
      data: { url: `/documents/${docId}/${encodeURIComponent(fileName)}`, fileName },
    };
  } catch (error) {
    return fail(error);
  }
}
