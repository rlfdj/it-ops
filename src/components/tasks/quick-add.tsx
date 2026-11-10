"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { useToast } from "@/components/shell/toast";
import { parseQuickAdd } from "@/lib/tasks";
import { formatDue } from "@/lib/tasks";
import { addQuickTask, removeTask } from "@/app/(app)/tasks/actions";

/** "Add a task and press Enter" with @due, #link and !priority shortcuts. */
export function QuickAdd({ today }: { today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ tone: "red"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = text.trim() ? parseQuickAdd(text, today) : null;

  const submit = () => {
    if (!text.trim() || pending) return;
    const value = text;
    startTransition(async () => {
      const result = await addQuickTask(value);
      if (!result.ok) {
        setMessage({ tone: "red", text: result.error });
        return;
      }
      setText("");
      setMessage(null);
      router.refresh();
      const { id, linked } = result.data;
      toast.show({
        text: linked ? `Task added · linked to ${linked}` : "Task added",
        // The inverse of adding is deleting that one task; a second call just reports "not found".
        undo: async () => {
          const removed = await removeTask(id);
          if (removed.ok) router.refresh();
          return removed;
        },
      });
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="qa">
        <PlusIcon size={14} strokeWidth={2.2} className="text-link" aria-hidden />
        <span className="sr-only">Quick add task</span>
        <input
          type="text"
          value={text}
          data-filter
          placeholder="Add a task and press Enter"
          onChange={(e) => {
            setText(e.target.value);
            setMessage(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") (e.target as HTMLInputElement).blur();
          }}
          // Not `disabled`: that would drop keyboard focus mid-loop (WCAG 2.4.3).
          readOnly={pending}
          aria-busy={pending}
        />
        <span className="kbd">⏎</span>
      </label>
      {message ? (
        <p className="alert red sm" role="alert">
          {message.text}
        </p>
      ) : (
        <p className="qa-hint cap">
          {parsed && (parsed.dueDate || parsed.ref || parsed.priority !== 2) ? (
            <>
              Will add “{parsed.title || "…"}”
              {parsed.dueDate ? ` · due ${formatDue(parsed.dueDate, today)}` : ""}
              {parsed.ref ? ` · linked to #${parsed.ref}` : ""}
              {` · P${parsed.priority}`}
            </>
          ) : (
            <>
              <span className="mono">@fri</span> or <span className="mono">@16oct</span> sets the
              due date · <span className="mono">#PO-2026-0158</span> links a PO, subscription or
              person · <span className="mono">!1</span> high, <span className="mono">!3</span> low
            </>
          )}
        </p>
      )}
    </div>
  );
}
