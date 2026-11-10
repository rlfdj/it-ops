"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NEW_REQUEST_EVENT } from "@/components/shell/new-request";
import { HelpCircleIcon, LayoutGridIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconTip } from "@/components/icon-action";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/shell/toast";
import {
  DEFAULT_SIZE,
  COLOUR_LABEL,
  NOTE_COLOURS,
  arrangeGrid,
  canvasSize,
  clampLayout,
  freeSpot,
  frontZ,
  listOrder,
  noteMatches,
  noteTitle,
  pointOnCanvas,
  screenScale,
  type Layout,
  type NoteColour,
} from "@/lib/board";
import { checkUpload, type ActionResult } from "@/lib/uploads";
import { taskHref } from "@/lib/links";
import type { BoardNote, NoteAttachment, NoteLinkOption } from "@/lib/queries/board";
import {
  addNote,
  attachNoteFile,
  makeTask,
  purgeNote,
  removeNote,
  removeNoteFile,
  saveLayouts,
  saveLink,
  saveNote,
  undoRemoveNote,
} from "@/app/(app)/board/actions";
import { LinkDialog } from "./link-dialog";
import { Note, type NoteOps } from "./note";

const WIDE = "(min-width: 761px)";
const CONTENT_DELAY = 900;
const LAYOUT_DELAY = 400;
const PURGE_AFTER = 15_000;

/** null until the browser has told us (the server cannot know the screen size). */
function useWide(): boolean | null {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => null,
  );
}

const HELP =
  "Drag a note to move it and its corner to resize. Click the board or press N to add one. With a note focused: arrow keys move it (Shift for bigger steps, Alt to resize), Enter edits, Delete removes.";

const offline = { ok: false, error: "Couldn’t reach the server. Check the connection." } as const;

export function BoardView({
  initialNotes,
  focusId,
}: {
  initialNotes: BoardNote[];
  focusId: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const wide = useWide();
  const [notes, setNotes] = useState(initialNotes);
  const [live, setLive] = useState<{ id: string; layout: Layout } | null>(null);
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(0);
  const [dirty, setDirty] = useState(0);
  const [newId, setNewId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [removingFile, setRemovingFile] = useState<{ noteId: string; file: NoteAttachment } | null>(
    null,
  );
  const [linking, setLinking] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [colours, setColours] = useState<ReadonlySet<NoteColour>>(new Set());

  const canvasRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef(notes);
  useLayoutEffect(() => {
    notesRef.current = notes;
  });

  // ---- saving: one chain per note, so a save never overtakes the note's creation ----
  const chains = useRef(new Map<string, Promise<unknown>>());
  const run = useCallback(
    <T,>(keys: string[], fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> => {
      setBusy((b) => b + 1);
      const before = Promise.all(keys.map((k) => chains.current.get(k) ?? Promise.resolve()));
      const next = before
        .then(() => fn())
        .catch((): ActionResult<T> => offline)
        .finally(() => setBusy((b) => b - 1));
      for (const k of keys) chains.current.set(k, next);
      return next;
    },
    [],
  );
  const fail = useCallback(
    (result: { ok: boolean; error?: string }, what: string) => {
      if (!result.ok)
        toast.show({ tone: "red", text: `${what} ${result.error ?? "Something went wrong."}` });
    },
    [toast],
  );

  const contentTimers = useRef(new Map<string, number>());
  const dirtyContent = useRef(new Set<string>());
  const layoutTimer = useRef<number | null>(null);
  const dirtyLayout = useRef(new Set<string>());
  const syncDirty = () => setDirty(dirtyContent.current.size + dirtyLayout.current.size);

  const flushContent = useCallback(
    (id: string) => {
      const t = contentTimers.current.get(id);
      if (t) window.clearTimeout(t);
      contentTimers.current.delete(id);
      if (!dirtyContent.current.delete(id)) return;
      syncDirty();
      const n = notesRef.current.find((x) => x.id === id);
      if (!n) return;
      void run([id], () =>
        saveNote({ id, text: n.text, checklist: n.checklist, colour: n.colour }),
      ).then((r) => fail(r, "Couldn’t save the note."));
    },
    [run, fail],
  );

  const flushLayout = useCallback(() => {
    if (layoutTimer.current) window.clearTimeout(layoutTimer.current);
    layoutTimer.current = null;
    const ids = [...dirtyLayout.current];
    dirtyLayout.current.clear();
    syncDirty();
    const items = ids.flatMap((id) => {
      const n = notesRef.current.find((x) => x.id === id);
      return n ? [{ id, x: n.x, y: n.y, width: n.width, height: n.height, zIndex: n.zIndex }] : [];
    });
    if (!items.length) return;
    void run(
      items.map((i) => i.id),
      () => saveLayouts(items),
    ).then((r) => fail(r, "Couldn’t save the layout."));
  }, [run, fail]);

  const markLayout = useCallback(
    (id: string) => {
      dirtyLayout.current.add(id);
      syncDirty();
      if (layoutTimer.current) window.clearTimeout(layoutTimer.current);
      layoutTimer.current = window.setTimeout(flushLayout, LAYOUT_DELAY);
    },
    [flushLayout],
  );

  const flushAll = useCallback(() => {
    for (const id of [...dirtyContent.current]) flushContent(id);
    flushLayout();
  }, [flushContent, flushLayout]);

  useEffect(() => {
    const onHide = () => flushAll();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      flushAll();
    };
  }, [flushAll]);

  // ---- creating ----
  const createdCount = useRef(initialNotes.length);
  const add = useCallback(
    (at: { x: number; y: number }) => {
      const id = crypto.randomUUID();
      const colour = NOTE_COLOURS[createdCount.current++ % NOTE_COLOURS.length]!;
      const layout = clampLayout({ ...at, ...DEFAULT_SIZE });
      const zIndex = frontZ(notesRef.current.map((n) => n.zIndex));
      const note: BoardNote = {
        id,
        text: "",
        colour,
        ...layout,
        zIndex,
        checklist: [],
        link: null,
        madeTaskId: null,
        attachments: [],
      };
      setNotes((all) => [...all, note]);
      setNewId(id);
      void run([id], () => addNote({ id, ...layout, colour })).then((r) => {
        if (r.ok) return;
        setNotes((all) => all.filter((n) => n.id !== id));
        fail(r, "Couldn’t add the note.");
      });
      return id;
    },
    [run, fail],
  );

  const addInFreeSpot = useCallback(() => {
    const width = canvasRef.current?.offsetWidth ?? 1000;
    add(freeSpot(notesRef.current, width));
  }, [add]);

  // New note from the top-bar button / N key (?new=1), once per request. Read from the client
  // URL and cleared with history.replaceState, so pressing New again on this page is a fresh
  // ?new=1 that fires this again (the server prop alone could stay "1" across both requests).
  const searchParams = useSearchParams();
  const requested = searchParams.get("new") === "1";
  const handled = useRef(false);
  useEffect(() => {
    if (!requested) {
      handled.current = false;
      return;
    }
    if (handled.current) return;
    handled.current = true;
    window.history.replaceState(null, "", "/board");
    addInFreeSpot();
  }, [requested, addInFreeSpot]);
  // Already on the board: New adds a note in place instead of navigating.
  useEffect(() => {
    const onNew = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== "/board?new=1") return;
      e.preventDefault();
      addInFreeSpot();
    };
    window.addEventListener(NEW_REQUEST_EVENT, onNew);
    return () => window.removeEventListener(NEW_REQUEST_EVENT, onNew);
  }, [addInFreeSpot]);

  // Opening from search (?note=id): bring that note into view and focus it.
  useEffect(() => {
    if (!focusId || wide === null) return;
    const el = document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(focusId)}"]`);
    el?.scrollIntoView({ block: "center", inline: "center" });
    el?.focus({ preventScroll: true });
    router.replace("/board", { scroll: false });
  }, [focusId, wide, router]);

  // ---- deleting, with Undo ----
  const purgeTimers = useRef(new Map<string, number>());
  const confirmDelete = async (id: string): Promise<string | void> => {
    const note = notesRef.current.find((n) => n.id === id);
    if (!note) return;
    flushContent(id);
    const r = await run([id], () => removeNote(id));
    if (!r.ok) return r.error;
    setNotes((all) => all.filter((n) => n.id !== id));
    purgeTimers.current.set(
      id,
      window.setTimeout(() => {
        purgeTimers.current.delete(id);
        void purgeNote(id);
      }, PURGE_AFTER),
    );
    toast.show({
      text: `Deleted “${noteTitle(note.text, note.checklist)}”`,
      duration: 10_000,
      undo: async () => {
        const back = await undoRemoveNote(id);
        if (back.ok) {
          window.clearTimeout(purgeTimers.current.get(id));
          purgeTimers.current.delete(id);
          setNotes((all) => (all.some((n) => n.id === id) ? all : [...all, note]));
        }
        return back;
      },
    });
  };

  // ---- the operations a note can ask for (stable, so notes re-render only when changed) ----
  const handlers = useRef<Pick<NoteOps, "makeTask" | "attach">>({
    makeTask: () => {},
    attach: () => {},
  });
  useLayoutEffect(() => {
    handlers.current = {
      makeTask: (id) => {
        flushContent(id);
        void run([id], () => makeTask(id)).then((r) => {
          if (!r.ok) return fail(r, "Couldn’t make the task.");
          setNotes((all) =>
            all.map((n) => (n.id === id ? { ...n, madeTaskId: r.data.taskId } : n)),
          );
          toast.show({
            text: `Task created: “${r.data.title}”`,
            link: { label: "Open task", href: taskHref(r.data.taskId) },
            duration: 8000,
          });
        });
      },
      attach: (id, files) => {
        for (const file of files) {
          const problem = checkUpload(file);
          if (problem) {
            toast.show({ tone: "red", text: `${file.name}: ${problem}` });
            continue;
          }
          setUploading((u) => ({ ...u, [id]: (u[id] ?? 0) + 1 }));
          const form = new FormData();
          form.set("noteId", id);
          form.set("file", file);
          void run([id], () => attachNoteFile(form)).then((r) => {
            setUploading((u) => ({ ...u, [id]: Math.max(0, (u[id] ?? 1) - 1) }));
            if (!r.ok) return fail(r, `Couldn’t attach ${file.name}.`);
            setNotes((all) =>
              all.map((n) =>
                n.id === id ? { ...n, attachments: [...n.attachments, r.data.attachment] } : n,
              ),
            );
          });
        }
      },
    };
  });

  const ops: NoteOps = useMemo(
    () => ({
      edit: (id, patch, immediate) => {
        setNotes((all) => all.map((n) => (n.id === id ? { ...n, ...patch } : n)));
        dirtyContent.current.add(id);
        syncDirty();
        const t = contentTimers.current.get(id);
        if (t) window.clearTimeout(t);
        // Flush after React has applied the change, so the save sees the new content.
        contentTimers.current.set(
          id,
          window.setTimeout(() => flushContent(id), immediate ? 0 : CONTENT_DELAY),
        );
      },
      flush: flushContent,
      live: (id, layout) => setLive(layout ? { id, layout } : null),
      commit: (id, layout) => {
        setLive(null);
        setNotes((all) => all.map((n) => (n.id === id ? { ...n, ...layout } : n)));
        markLayout(id);
      },
      front: (id) => {
        const all = notesRef.current;
        const me = all.find((n) => n.id === id);
        if (!me || all.every((n) => n.id === id || n.zIndex < me.zIndex)) return;
        const z = frontZ(all.map((n) => n.zIndex));
        setNotes((list) => list.map((n) => (n.id === id ? { ...n, zIndex: z } : n)));
        markLayout(id);
      },
      askDelete: setDeleting,
      makeTask: (id) => handlers.current.makeTask(id),
      attach: (id, files) => handlers.current.attach(id, files),
      askRemoveFile: (noteId, file) => setRemovingFile({ noteId, file }),
      openLink: setLinking,
    }),
    [flushContent, markLayout],
  );

  // ---- find a note / colour filter ----
  const filtering = query.trim() !== "" || colours.size > 0;
  const matching = (n: BoardNote) => noteMatches(n, query, colours);
  const toggleColour = (c: NoteColour) =>
    setColours((prev) => {
      const next = new Set(prev);
      if (!next.delete(c)) next.add(c);
      return next;
    });

  // The first match comes into view as you type.
  useEffect(() => {
    if (!wide || !query.trim()) return;
    const first = listOrder(notesRef.current).find((n) =>
      noteMatches(n, query, new Set<NoteColour>()),
    );
    if (!first) return;
    document
      .querySelector<HTMLElement>(`[data-note-id="${CSS.escape(first.id)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [query, wide]);

  // ---- Arrange: a tidy grid in the visible width, saved in one write, with Undo ----
  type Spot = { id: string; x: number; y: number };
  const arrange = () => {
    flushAll();
    const current = notesRef.current;
    if (!current.length) return;
    const width = canvasRef.current?.offsetWidth ?? 1000;
    const after: Spot[] = arrangeGrid(current, width);
    const before: Spot[] = current.map((n) => ({ id: n.id, x: n.x, y: n.y }));
    const apply = (pos: Spot[]) => {
      const byId = new Map(pos.map((p) => [p.id, p]));
      setNotes((all) =>
        all.map((n) => {
          const p = byId.get(n.id);
          return p ? { ...n, x: p.x, y: p.y } : n;
        }),
      );
    };
    const save = (pos: Spot[]) => {
      const items = pos.flatMap((p) => {
        const n = notesRef.current.find((x) => x.id === p.id);
        return n
          ? [{ id: p.id, x: p.x, y: p.y, width: n.width, height: n.height, zIndex: n.zIndex }]
          : [];
      });
      return run(
        items.map((i) => i.id),
        () => saveLayouts(items),
      );
    };
    apply(after);
    document.querySelector<HTMLElement>("[data-board]")?.scrollTo({ left: 0, top: 0 });
    void save(after).then((r) => {
      if (!r.ok) {
        apply(before);
        fail(r, "Couldn’t arrange the notes.");
        return;
      }
      toast.show({
        text: "Notes arranged",
        duration: 10_000,
        undo: async () => {
          apply(before);
          const back = await save(before);
          if (!back.ok) apply(after);
          return back;
        },
      });
    });
  };

  const layoutOf = (n: BoardNote): Layout =>
    live?.id === n.id ? live.layout : { x: n.x, y: n.y, width: n.width, height: n.height };

  const size = useMemo(
    () =>
      canvasSize(
        notes.map((n) => (live?.id === n.id ? live.layout : n)),
        { width: 0, height: 0 },
      ),
    [notes, live],
  );

  const saving = busy > 0 || dirty > 0;
  const linkingNote = linking ? notes.find((n) => n.id === linking) : undefined;

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    e.currentTarget.dataset.hadFocus = document.activeElement?.closest(".note") ? "1" : "";
  };
  const onCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    // A click that only leaves a note being edited does not add another.
    if (e.currentTarget.dataset.hadFocus) {
      e.currentTarget.dataset.hadFocus = "";
      return;
    }
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const scale = screenScale(rect.width, canvas.offsetWidth, zoom);
    const p = pointOnCanvas({ x: e.clientX, y: e.clientY }, rect, scale);
    // The pin (top centre of the note) goes where the click was.
    add({ x: p.x - DEFAULT_SIZE.width / 2, y: p.y - 12 });
  };

  return (
    <main id="content" tabIndex={-1} className="page board-page">
      <div className="page-head">
        <div className="title">
          <span className="eyebrow">
            {notes.length} {notes.length === 1 ? "note" : "notes"}
            <span className="sr-only" role="status" aria-live="polite">
              {saving ? " · Saving" : " · All changes saved"}
            </span>
            <span aria-hidden> · {saving ? "Saving…" : "Saved"}</span>
          </span>
          <h1 className="h1">Board</h1>
        </div>
        <div className="right board-tools">
          <label className="field-wrap board-find">
            <SearchIcon size={13} strokeWidth={2} aria-hidden />
            <span className="sr-only">Find a note</span>
            <input
              type="text"
              data-filter
              placeholder="Find a note"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                if (query) {
                  e.stopPropagation();
                  setQuery("");
                } else (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="kbd">/</span>
          </label>
          <div className="board-colours" role="group" aria-label="Show only these colours">
            {NOTE_COLOURS.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                data-swatch={c}
                aria-pressed={colours.has(c)}
                aria-label={`${COLOUR_LABEL[c]} notes`}
                onClick={() => toggleColour(c)}
              />
            ))}
          </div>
          {wide ? (
            <Button size="sm" onClick={arrange} disabled={notes.length === 0}>
              <LayoutGridIcon size={13} aria-hidden /> Arrange
            </Button>
          ) : null}
          <IconTip label={<span className="tip-help">{HELP}</span>}>
            <Button size="icon-sm" variant="ghost" aria-label="How the board works">
              <HelpCircleIcon size={14} aria-hidden />
            </Button>
          </IconTip>
        </div>
      </div>
      <p className="sr-only" id="board-keys">
        {HELP}
      </p>

      {wide === null ? (
        <div className="board-skeleton skel" aria-hidden />
      ) : wide ? (
        <>
          <div className="board" data-board>
            <div
              ref={canvasRef}
              className="board-canvas"
              style={{
                minWidth: size.width,
                minHeight: `max(calc(var(--vh100) - 250px), ${size.height}px)`,
              }}
              onPointerDown={onCanvasPointerDown}
              onClick={onCanvasClick}
            >
              {notes.map((n) => (
                <Note
                  key={n.id}
                  note={n}
                  mode="board"
                  layout={layoutOf(n)}
                  dragging={live?.id === n.id}
                  dimmed={filtering && !matching(n)}
                  uploading={uploading[n.id] ?? 0}
                  autoFocus={newId === n.id}
                  canvasRef={canvasRef}
                  ops={ops}
                />
              ))}
              {notes.length === 0 ? (
                <p className="board-empty">
                  Click anywhere on the board, or press N, to pin a note.
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="board-stack">
          {notes.length === 0 ? (
            <p className="board-empty static">No notes yet. Tap New note to add one.</p>
          ) : null}
          {notes.length > 0 && !notes.some(matching) ? (
            <p className="board-empty static">No notes match.</p>
          ) : null}
          {listOrder(notes)
            .filter(matching)
            .map((n) => (
              <Note
                key={n.id}
                note={n}
                mode="list"
                layout={{ x: n.x, y: n.y, width: n.width, height: n.height }}
                dragging={false}
                uploading={uploading[n.id] ?? 0}
                autoFocus={newId === n.id}
                canvasRef={canvasRef}
                ops={ops}
              />
            ))}
        </div>
      )}

      {deleting ? (
        <ConfirmDialog
          title="Delete this note?"
          description={`“${noteTitle(
            notes.find((n) => n.id === deleting)?.text ?? "",
            notes.find((n) => n.id === deleting)?.checklist ?? [],
          )}” and its attached files. You can undo for a few seconds.`}
          confirmLabel="Delete note"
          pendingLabel="Deleting…"
          onConfirm={() => confirmDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      {removingFile ? (
        <ConfirmDialog
          title="Remove this file?"
          description={`“${removingFile.file.fileName}” is removed from the note and deleted.`}
          confirmLabel="Remove file"
          pendingLabel="Removing…"
          onConfirm={async () => {
            const { noteId, file } = removingFile;
            const r = await run([noteId], () => removeNoteFile(file.id));
            if (!r.ok) return r.error;
            setNotes((all) =>
              all.map((n) =>
                n.id === noteId
                  ? { ...n, attachments: n.attachments.filter((a) => a.id !== file.id) }
                  : n,
              ),
            );
          }}
          onClose={() => setRemovingFile(null)}
        />
      ) : null}

      {linkingNote ? (
        <LinkDialog
          current={linkingNote.link}
          onClose={() => setLinking(null)}
          onSave={async (option: NoteLinkOption | null) => {
            const id = linkingNote.id;
            const r = await run([id], () =>
              saveLink({ id, related: option ? { kind: option.kind, id: option.id } : null }),
            );
            if (!r.ok) return r.error;
            setNotes((all) => all.map((n) => (n.id === id ? { ...n, link: r.data.link } : n)));
          }}
        />
      ) : null}
    </main>
  );
}
