import { deleteDescription, deleteTitle, type DeleteImpact } from "./delete-text";

/** What the delete confirmation shows: its title and the sentence naming what goes. */
export type DeleteConfirm = { name: string; title: string; description: string };

export function deleteConfirm(impact: DeleteImpact & { name: string }): DeleteConfirm {
  return {
    name: impact.name,
    title: deleteTitle(impact.name),
    description: deleteDescription(impact),
  };
}
