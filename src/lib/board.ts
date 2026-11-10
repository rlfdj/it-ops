// Pure rules for the Board (sticky notes): colours, sizes, tilt, coordinate conversion and
// layout maths. No React, no database.

export const NOTE_COLOURS = ["yellow", "pink", "blue", "green", "orange"] as const;
export type NoteColour = (typeof NOTE_COLOURS)[number];

export const COLOUR_LABEL: Record<NoteColour, string> = {
  yellow: "Yellow",
  pink: "Pink",
  blue: "Blue",
  green: "Green",
  orange: "Orange",
};

export type ChecklistLine = { id: string; text: string; done: boolean };

export type Layout = { x: number; y: number; width: number; height: number };

export const MIN_WIDTH = 160;
export const MIN_HEIGHT = 140;
export const MAX_WIDTH = 640;
export const MAX_HEIGHT = 800;
export const DEFAULT_SIZE = { width: 240, height: 220 } as const;
/** Notes stay inside this canvas; the database enforces the same limit. */
export const MAX_COORD = 20000;
export const MAX_Z = 1_000_000;
export const MAX_TEXT = 10_000;
export const MAX_CHECKLIST_LINES = 50;
export const MAX_LINE = 300;
export const MAX_ATTACHMENTS = 10;
/** Nudge step for the arrow keys, and with Shift held. */
export const NUDGE = 8;
export const NUDGE_LARGE = 32;

export const isNoteColour = (v: unknown): v is NoteColour =>
  typeof v === "string" && (NOTE_COLOURS as readonly string[]).includes(v);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Keeps a layout inside the allowed sizes and the canvas; integers only. */
export function clampLayout(l: Layout): Layout {
  const width = clamp(Math.round(l.width), MIN_WIDTH, MAX_WIDTH);
  const height = clamp(Math.round(l.height), MIN_HEIGHT, MAX_HEIGHT);
  return {
    x: clamp(Math.round(l.x), 0, MAX_COORD - width),
    y: clamp(Math.round(l.y), 0, MAX_COORD - height),
    width,
    height,
  };
}

/** A stable tilt for a note, -2° to 2° in tenths, from its id. */
export function tiltFor(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const steps = (hash >>> 0) % 41; // 0..40
  return (steps - 20) / 10;
}

/**
 * Pixels on screen per layout pixel. The app renders at 80% on wide screens (CSS zoom on
 * <html>); pointer coordinates are in screen pixels while left/top/width/height are in
 * layout pixels. Derived from an element's on-screen and layout widths, so it holds for
 * whatever zoom is in effect; falls back to `fallback` when the element has no width.
 */
export function screenScale(screenWidth: number, layoutWidth: number, fallback = 1): number {
  if (!(screenWidth > 0) || !(layoutWidth > 0)) return fallback > 0 ? fallback : 1;
  return screenWidth / layoutWidth;
}

/** A pointer movement in screen pixels as a movement in layout pixels. */
export function toLayoutDelta(delta: number, scale: number): number {
  return scale > 0 ? delta / scale : delta;
}

/** Where a pointer is on the canvas, in layout pixels. `rect` is the canvas's on-screen box. */
export function pointOnCanvas(
  client: { x: number; y: number },
  rect: { left: number; top: number },
  scale: number,
): { x: number; y: number } {
  return {
    x: toLayoutDelta(client.x - rect.left, scale),
    y: toLayoutDelta(client.y - rect.top, scale),
  };
}

export type NudgeKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/** Arrow key: move the note; with `resize` (Alt) grow or shrink it instead. */
export function nudge(
  l: Layout,
  key: NudgeKey,
  opts: { large?: boolean; resize?: boolean },
): Layout {
  const step = opts.large ? NUDGE_LARGE : NUDGE;
  const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
  const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
  return clampLayout(
    opts.resize
      ? { ...l, width: l.width + dx, height: l.height + dy }
      : { ...l, x: l.x + dx, y: l.y + dy },
  );
}

const overlaps = (a: Layout, b: Layout) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** The first free slot on a grid for a new note, scanning left to right, top to bottom. */
export function freeSpot(
  existing: Layout[],
  boardWidth: number,
  size: { width: number; height: number } = DEFAULT_SIZE,
): { x: number; y: number } {
  const gap = 24;
  const cols = Math.max(1, Math.floor((boardWidth - gap) / (size.width + gap)));
  for (let row = 0; row < 200; row++) {
    for (let col = 0; col < cols; col++) {
      const slot = {
        x: gap + col * (size.width + gap),
        y: gap + row * (size.height + gap),
        ...size,
      };
      if (!existing.some((n) => overlaps(slot, n))) return { x: slot.x, y: slot.y };
    }
  }
  return { x: gap, y: gap };
}

/** The canvas grows to hold every note, plus room to drop more beyond the last one. */
export function canvasSize(
  layouts: Layout[],
  min: { width: number; height: number },
  margin = 120,
): { width: number; height: number } {
  let right = 0;
  let bottom = 0;
  for (const n of layouts) {
    right = Math.max(right, n.x + n.width);
    bottom = Math.max(bottom, n.y + n.height);
  }
  return {
    width: Math.max(min.width, right + margin),
    height: Math.max(min.height, bottom + margin),
  };
}

/** The first line of a note, for its accessible name and search results. */
export function noteTitle(text: string, checklist: ChecklistLine[] = []): string {
  const first =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ??
    checklist.find((l) => l.text.trim())?.text.trim() ??
    "";
  if (!first) return "Empty note";
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}

/**
 * The title of the task made from a note: its text on one line (line breaks become " · "),
 * or its checklist lines when it has no text. Null when the note is empty.
 */
export function taskTitleFromNote(text: string, checklist: ChecklistLine[] = []): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const source = lines.length ? lines : checklist.map((l) => l.text.trim()).filter(Boolean);
  if (!source.length) return null;
  const joined = source.join(" · ");
  return joined.length > 300 ? `${joined.slice(0, 299)}…` : joined;
}

/** Phone list order: top to bottom, then left to right, as the notes sit on the board. */
export function listOrder<T extends Layout>(notes: T[]): T[] {
  return [...notes].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The z-index that puts a note in front of the others. */
export function frontZ(zs: number[]): number {
  return Math.min(MAX_Z, (zs.length ? Math.max(...zs) : 0) + 1);
}

/** Caps the number and length of checklist lines; keeps ids and ticks. */
export function cleanChecklist(lines: ChecklistLine[]): ChecklistLine[] {
  return lines.slice(0, MAX_CHECKLIST_LINES).map((l) => ({
    id: l.id,
    text: l.text.slice(0, MAX_LINE),
    done: l.done,
  }));
}

/** Attachments shown as a thumbnail (browsers can't draw HEIC, so it stays a file chip). */
export const isImageName = (name: string) => /\.(png|jpe?g|webp|gif)$/i.test(name);

/** "2.4 MB", "310 KB". */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export const ARRANGE_GAP = 24;

/**
 * Tidy grid for "Arrange": notes keep their size and their order (top to bottom, then left
 * to right, as listOrder reads them) and are packed into rows that fit `boardWidth`; a row
 * is as tall as its tallest note. No two notes overlap. A note wider than the board gets a
 * row of its own.
 */
export function arrangeGrid<T extends Layout & { id: string }>(
  notes: T[],
  boardWidth: number,
  gap = ARRANGE_GAP,
): { id: string; x: number; y: number }[] {
  const out: { id: string; x: number; y: number }[] = [];
  let x = gap;
  let y = gap;
  let rowHeight = 0;
  for (const n of listOrder(notes)) {
    if (x > gap && x + n.width + gap > boardWidth) {
      x = gap;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    out.push({ id: n.id, x, y });
    x += n.width + gap;
    rowHeight = Math.max(rowHeight, n.height);
  }
  return out;
}

/** True when a note passes the board's text search and colour filter (both optional). */
export function noteMatches(
  note: { text: string; checklist: ChecklistLine[]; colour: NoteColour },
  query: string,
  colours: ReadonlySet<NoteColour>,
): boolean {
  if (colours.size > 0 && !colours.has(note.colour)) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [note.text, ...note.checklist.map((l) => l.text)].some((t) => t.toLowerCase().includes(q));
}
