import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import { getChecklistTemplates } from "@/lib/queries/checklists";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireUser();
  const [settings, templates] = await Promise.all([
    getWorkspaceSettings(),
    getChecklistTemplates(),
  ]);
  return <SettingsView settings={settings} templates={templates} />;
}
