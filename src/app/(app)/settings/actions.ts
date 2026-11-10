"use server";

import { revalidatePath } from "next/cache";
import { withActor } from "@/db";
import { requireUser } from "@/lib/auth";
import { actionFail as fail } from "@/lib/action-fail";
import { DomainError } from "@/lib/domain-error";
import { createClient } from "@/lib/supabase/server";
import { checkUpload, type ActionResult } from "@/lib/uploads";
import { LOGO_RULES } from "@/lib/workspace";
import { invalidateSettingsCache } from "@/lib/queries/settings";
import { saveSettings, setLogoPath } from "@/server/settings";
import { saveChecklistTemplate } from "@/server/checklist-templates";
import type { ChecklistKind } from "@/lib/checklists";
import type { TemplateStep } from "@/lib/checklist-templates";

const BUCKET = "documents";
const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/jpeg": "jpg",
};

function refresh() {
  invalidateSettingsCache();
  revalidatePath("/", "layout");
}

export async function saveWorkspaceSettings(input: {
  workspaceName: string;
  usdAedRate: string;
  baseCurrency: string;
  timeZone: string;
}): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => saveSettings(tx, input));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Saves the starting steps of new onboarding or offboarding checklists. */
export async function saveTemplate(
  kind: ChecklistKind,
  steps: TemplateStep[],
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => saveChecklistTemplate(tx, { kind, steps }));
    revalidatePath("/settings");
    revalidatePath("/onboarding");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Replaces the workspace logo (PNG, SVG or JPG, up to 1 MB). */
export async function uploadLogo(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  let uploadedPath: string | null = null;
  try {
    const user = await requireUser();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new DomainError("Choose a logo to upload.");
    const problem = checkUpload(file, LOGO_RULES);
    if (problem) throw new DomainError(problem);

    uploadedPath = `branding/logo-${crypto.randomUUID().slice(0, 8)}.${EXTENSION[file.type]}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(uploadedPath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw new DomainError(`Upload failed: ${uploadError.message}`);

    const path = uploadedPath;
    const previous = await withActor(user.email, (tx) => setLogoPath(tx, path));
    uploadedPath = null;
    if (previous) await supabase.storage.from(BUCKET).remove([previous]);
    refresh();
    return { ok: true };
  } catch (error) {
    if (uploadedPath)
      await supabase.storage
        .from(BUCKET)
        .remove([uploadedPath])
        .catch(() => {});
    return fail(error);
  }
}

/** Goes back to the default mark and deletes the uploaded file. */
export async function removeLogo(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const previous = await withActor(user.email, (tx) => setLogoPath(tx, null));
    if (previous) {
      const supabase = await createClient();
      await supabase.storage.from(BUCKET).remove([previous]);
    }
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
