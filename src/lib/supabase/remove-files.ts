import "server-only";
import { createClient } from "./server";

const BUCKET = "documents";

/**
 * Removes stored files from the documents bucket. Call it after the transaction that deleted
 * their rows has committed; a failure only leaves an unreferenced file behind, so it is ignored.
 */
export async function removeStoredFiles(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const supabase = await createClient();
  await supabase.storage
    .from(BUCKET)
    .remove(paths)
    .catch(() => {});
}
