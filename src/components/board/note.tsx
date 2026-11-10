"use client";

import { memo, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  FileTextIcon,
  LinkIcon,
  ListPlusIcon,
  ListTodoIcon,
  PaperclipIcon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import Link from "@/components/link";
import { DocLink, IconTip } from "@/components/icon-action";
import { DocumentPreviewSheet } from "@/components/documents/document-preview";
import {
  COLOUR_LABEL,
  NOTE_COLOURS,
  fileSize,
  nudge,
  noteTitle,
  clampLayout,
  screenScale,
  tiltFor,
  toLayoutDelta,
  type ChecklistLine,
  type Layout,
  type NoteColour,
  type NudgeKey,
} from "@/lib/board";
import { taskHref } from "@/lib/links";
import { UPLOAD_ACCEPT } from "@/lib/uploads";
import type { BoardNote, NoteAttachment } from "@/lib/queries/board";

export type NoteOps = {
  edit: (
    id: string,
    patch: Partial<{ text: string; checklist: ChecklistLine[]; colour: NoteColour }>,
    immediate?: boolean,
  ) => void;
  flush: (id: string) => void;
  /** A move or resize in progress (null when it ends). */
  live: (id: string, layout: Layout | null) => void;
  commit: (id: string, layout: Layout) => void;
  front: (id: string) => void;
  askDelete: (id: string) => void;
  makeTask: (id: string) => void;
  attach: (id: string, files: File[]) => void;
  askRemoveFile: (noteId: string, file: NoteAttachment) => void;
  openLink: (id: string) => void;
};

/** Screen pixels per layout pixel from the page zoom (the app renders at 80% on wide screens). */
function readZoom(): number {
  const z = parseFloat(getComputedStyle(document.documentElement).zoom);
  return z > 0 ? z : 1;
}

const ICON = { size: 15, strokeWidth: 2, "aria-hidden": true } as const;
const thumbSrc = (a: NoteAttachment) => `/documents/${a.id}/${encodeURIComponent(a.fileName)}`;

type Gesture = {
  kind: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  start: Layout;
  scale: number;
  moved: boolean;
  latest: Layout;
};

function NoteView({
  note,
  mode,
  layout,
  dragging,
  dimmed = false,
  uploading,
  autoFocus,
  canvasRef,
  ops,
}: {
  note: BoardNote;
  mode: "board" | "list";
  layout: Layout;
  dragging: boolean;
  /** Not matching the search or colour filter: shown faded. */
  dimmed?: boolean;
  uploading: number;
  autoFocus: boolean;
  canvasRef: RefObject<HTMLDivElement | null>;
  ops: NoteOps;
}) {
  const board = mode === "board";
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pendingLine = useRef<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<NoteAttachment | null>(null);

  useLayoutEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus]);

  // The text area grows with its content; the note body scrolls when it outgrows the note.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [note.text, layout.width]);

  const title = noteTitle(note.text, note.checklist);

  const begin = (e: React.PointerEvent<HTMLElement>, kind: "move" | "resize") => {
    if (!board || !e.currentTarget.contains(e.target as Node)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (kind === "move" && (e.target as Element).closest("textarea,input,button,a,select,label")) {
      ops.front(note.id);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (kind === "resize") e.stopPropagation();
    const scale = screenScale(canvas.getBoundingClientRect().width, canvas.offsetWidth, readZoom());
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      kind,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      start: layout,
      scale,
      moved: false,
      latest: layout,
    };
    ops.front(note.id);
  };

  const track = (e: React.PointerEvent<HTMLElement>, kind: "move" | "resize") => {
    const g = gesture.current;
    if (!g || g.kind !== kind || g.pointerId !== e.pointerId) return;
    if (kind === "resize") e.stopPropagation();
    const sx = e.clientX - g.startX;
    const sy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(sx, sy) < 3) return;
    g.moved = true;
    const dx = toLayoutDelta(sx, g.scale);
    const dy = toLayoutDelta(sy, g.scale);
    g.latest = clampLayout(
      kind === "move"
        ? { ...g.start, x: g.start.x + dx, y: g.start.y + dy }
        : { ...g.start, width: g.start.width + dx, height: g.start.height + dy },
    );
    ops.live(note.id, g.latest);
  };

  const finish = (e: React.PointerEvent<HTMLElement>, kind: "move" | "resize", cancel = false) => {
    const g = gesture.current;
    if (!g || g.kind !== kind || g.pointerId !== e.pointerId) return;
    if (kind === "resize") e.stopPropagation();
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (g.moved && !cancel) ops.commit(note.id, g.latest);
    else ops.live(note.id, null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (board && e.key.startsWith("Arrow")) {
      e.preventDefault();
      ops.commit(
        note.id,
        nudge(layout, e.key as NudgeKey, { large: e.shiftKey, resize: e.altKey }),
      );
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      ops.askDelete(note.id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      textRef.current?.focus();
    }
  };

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  const setLine = (lineId: string, patch: Partial<ChecklistLine>) =>
    ops.edit(
      note.id,
      { checklist: note.checklist.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) },
      "done" in patch,
    );
  const addLine = (afterId?: string) => {
    const line: ChecklistLine = { id: crypto.randomUUID().slice(0, 8), text: "", done: false };
    const at = afterId
      ? note.checklist.findIndex((l) => l.id === afterId) + 1
      : note.checklist.length;
    pendingLine.current = line.id;
    ops.edit(note.id, {
      checklist: [...note.checklist.slice(0, at), line, ...note.checklist.slice(at)],
    });
  };
  const removeLine = (lineId: string) =>
    ops.edit(note.id, { checklist: note.checklist.filter((l) => l.id !== lineId) }, true);

  const style: React.CSSProperties = board
    ? {
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
        zIndex: note.zIndex,
        ["--tilt" as string]: `${tiltFor(note.id)}deg`,
      }
    : { ["--tilt" as string]: "0deg" };

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={`Note: ${title}`}
      aria-describedby={board ? "board-keys" : undefined}
      tabIndex={0}
      data-note-id={note.id}
      data-colour={note.colour}
      className={`note ${board ? "on-board" : "stacked"}${dragging ? " dragging" : ""}${dimmed ? " dimmed" : ""}${dropping ? " dropping" : ""}`}
      style={style}
      onPointerDown={(e) => begin(e, "move")}
      onPointerMove={(e) => track(e, "move")}
      onPointerUp={(e) => finish(e, "move")}
      onPointerCancel={(e) => finish(e, "move", true)}
      onKeyDown={onKeyDown}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        ops.attach(note.id, Array.from(e.dataTransfer.files));
      }}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files);
        if (!files.length) return;
        e.preventDefault();
        ops.attach(
          note.id,
          files.map((f) =>
            /^image\.\w+$/i.test(f.name)
              ? new File(
                  [f],
                  `Pasted-image-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.${f.type.split("/")[1] ?? "png"}`,
                  { type: f.type },
                )
              : f,
          ),
        );
      }}
    >
      <div className="note-head">
        <span className="pin" aria-hidden />
        <div className="note-swatches" role="radiogroup" aria-label="Note colour">
          {NOTE_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={note.colour === c}
              aria-label={COLOUR_LABEL[c]}
              data-swatch={c}
              className="swatch"
              onClick={() => ops.edit(note.id, { colour: c }, true)}
            />
          ))}
        </div>
        <IconTip label="Delete note">
          <button
            type="button"
            className="note-btn"
            aria-label="Delete note"
            onClick={() => ops.askDelete(note.id)}
          >
            <Trash2Icon {...ICON} />
          </button>
        </IconTip>
      </div>

      <div className="note-body">
        <textarea
          ref={textRef}
          className="note-text"
          aria-label="Note text"
          placeholder="Write a note…"
          rows={2}
          value={note.text}
          onChange={(e) => ops.edit(note.id, { text: e.target.value })}
          onBlur={() => ops.flush(note.id)}
          onKeyDown={(e) => {
            if (e.key === "Escape") rootRef.current?.focus();
          }}
        />

        {note.checklist.length ? (
          <ul className="note-checks">
            {note.checklist.map((line) => (
              <li key={line.id} className={line.done ? "done" : undefined}>
                <input
                  type="checkbox"
                  checked={line.done}
                  aria-label={`Done: ${line.text || "list item"}`}
                  onChange={(e) => setLine(line.id, { done: e.target.checked })}
                />
                <input
                  className="note-line"
                  aria-label="Checklist item"
                  placeholder="List item"
                  value={line.text}
                  ref={(el) => {
                    if (el && pendingLine.current === line.id) {
                      pendingLine.current = null;
                      el.focus();
                    }
                  }}
                  onChange={(e) => setLine(line.id, { text: e.target.value })}
                  onBlur={() => ops.flush(note.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLine(line.id);
                    } else if (e.key === "Backspace" && !line.text) {
                      e.preventDefault();
                      removeLine(line.id);
                    } else if (e.key === "Escape") rootRef.current?.focus();
                  }}
                />
                <button
                  type="button"
                  className="note-btn small"
                  aria-label={`Remove list item ${line.text}`.trim()}
                  onClick={() => removeLine(line.id)}
                >
                  <XIcon size={13} strokeWidth={2} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {note.attachments.length || uploading ? (
          <ul className="note-files" aria-label="Attached files">
            {note.attachments.map((a) =>
              a.image && !broken.has(a.id) ? (
                <li key={a.id} className="note-thumb">
                  <button
                    type="button"
                    className="thumb-open"
                    aria-label={`Preview ${a.fileName}`}
                    onClick={() => setPreview(a)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbSrc(a)}
                      alt={a.fileName}
                      loading="lazy"
                      draggable={false}
                      onError={() => setBroken((s) => new Set(s).add(a.id))}
                    />
                  </button>
                  <button
                    type="button"
                    className="note-btn small thumb-x"
                    aria-label={`Remove ${a.fileName}`}
                    onClick={() => ops.askRemoveFile(note.id, a)}
                  >
                    <XIcon size={13} strokeWidth={2} aria-hidden />
                  </button>
                </li>
              ) : (
                <li key={a.id} className="note-file">
                  <FileTextIcon size={15} strokeWidth={2} aria-hidden className="shrink-0" />
                  <span className="fname" title={a.fileName}>
                    {a.fileName}
                  </span>
                  <span className="fsize">{fileSize(a.sizeBytes)}</span>
                  <DocLink
                    documentId={a.id}
                    action="view"
                    what={a.fileName}
                    fileName={a.fileName}
                  />
                  <DocLink
                    documentId={a.id}
                    action="download"
                    what={a.fileName}
                    fileName={a.fileName}
                  />
                  <button
                    type="button"
                    className="note-btn small"
                    aria-label={`Remove ${a.fileName}`}
                    onClick={() => ops.askRemoveFile(note.id, a)}
                  >
                    <XIcon size={13} strokeWidth={2} aria-hidden />
                  </button>
                </li>
              ),
            )}
            {uploading ? (
              <li className="note-uploading" role="status">
                Uploading…
              </li>
            ) : null}
          </ul>
        ) : null}

        {note.link ? (
          <Link className="note-chip" href={note.link.href} title={`Open ${note.link.label}`}>
            <SquareArrowOutUpRightIcon size={13} strokeWidth={2} aria-hidden />
            <span>{note.link.label}</span>
          </Link>
        ) : null}
      </div>

      <div className="note-foot">
        <IconTip label="Add checklist line">
          <button
            type="button"
            className="note-btn"
            aria-label="Add checklist line"
            onClick={() => addLine()}
          >
            <ListPlusIcon {...ICON} />
          </button>
        </IconTip>
        <IconTip label="Attach file">
          <button
            type="button"
            className="note-btn"
            aria-label="Attach file"
            onClick={() => fileRef.current?.click()}
          >
            <PaperclipIcon {...ICON} />
          </button>
        </IconTip>
        <IconTip label={note.link ? "Change linked record" : "Link a record"}>
          <button
            type="button"
            className="note-btn"
            aria-label={note.link ? "Change linked record" : "Link a record"}
            onClick={() => ops.openLink(note.id)}
          >
            <LinkIcon {...ICON} />
          </button>
        </IconTip>
        {note.madeTaskId ? (
          <IconTip label="Open the task made from this note">
            <Link
              className="note-btn"
              href={taskHref(note.madeTaskId)}
              aria-label="Open the task made from this note"
            >
              <ListTodoIcon {...ICON} />
            </Link>
          </IconTip>
        ) : (
          <IconTip label="Make task">
            <button
              type="button"
              className="note-btn"
              aria-label="Make task"
              onClick={() => ops.makeTask(note.id)}
            >
              <ListTodoIcon {...ICON} />
            </button>
          </IconTip>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files to attach to this note"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) ops.attach(note.id, files);
          }}
        />
      </div>

      {board ? (
        <span
          className="note-resize"
          aria-hidden
          onPointerDown={(e) => begin(e, "resize")}
          onPointerMove={(e) => track(e, "resize")}
          onPointerUp={(e) => finish(e, "resize")}
          onPointerCancel={(e) => finish(e, "resize", true)}
        />
      ) : null}

      {preview ? (
        <DocumentPreviewSheet
          documentId={preview.id}
          fileName={preview.fileName}
          open
          onOpenChange={(o) => (o ? null : setPreview(null))}
        />
      ) : null}
    </div>
  );
}

export const Note = memo(NoteView);
