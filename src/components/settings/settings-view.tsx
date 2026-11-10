import { ShortcutsList } from "@/components/shell/shortcuts-list";
import type { WorkspaceSettings } from "@/lib/queries/settings";
import type { ChecklistKind } from "@/lib/checklists";
import type { TemplateStep } from "@/lib/checklist-templates";
import { SettingsForm } from "./settings-form";
import { TemplateEditor } from "./template-editor";

export function SettingsView({
  settings,
  templates,
}: {
  settings: WorkspaceSettings;
  templates: Record<ChecklistKind, TemplateStep[]>;
}) {
  return (
    <main id="content" tabIndex={-1} className="page">
      <div className="page-head">
        <div className="title">
          <span className="eyebrow">Workspace</span>
          <h1 className="h1">Settings</h1>
        </div>
      </div>

      <section aria-label="Workspace" className="flex max-w-[560px] flex-col">
        <div className="sec-head">
          <div className="lead">
            <h2 className="h2">Workspace</h2>
            <span className="cap">Name, logo, currency and time zone</span>
          </div>
        </div>
        <div className="mt-3">
          <SettingsForm settings={settings} />
        </div>
        <p className="cap mt-4">
          Changing the exchange rate only affects USD amounts you enter from now on; totals already
          saved are never recalculated.
        </p>
      </section>

      <section aria-label="Checklist templates" className="flex max-w-[560px] flex-col">
        <div className="sec-head">
          <div className="lead">
            <h2 className="h2">Checklist templates</h2>
            <span className="cap">
              The steps every new checklist starts with. Existing checklists are not changed.
            </span>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-6">
          <TemplateEditor kind="onboarding" initial={templates.onboarding} />
          <TemplateEditor kind="offboarding" initial={templates.offboarding} />
        </div>
      </section>

      <section aria-label="Keyboard shortcuts" id="shortcuts" className="flex flex-col">
        <div className="sec-head">
          <div className="lead">
            <h2 className="h2">Keyboard shortcuts</h2>
            <span className="cap">Press ? anywhere to see this list</span>
          </div>
        </div>
        <div className="mt-3">
          <ShortcutsList />
        </div>
      </section>
    </main>
  );
}
