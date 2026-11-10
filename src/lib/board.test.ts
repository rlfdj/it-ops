import { describe, expect, it } from "vitest";
import {
  MAX_COORD,
  MAX_HEIGHT,
  MAX_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  NUDGE,
  NUDGE_LARGE,
  arrangeGrid,
  canvasSize,
  clampLayout,
  fileSize,
  freeSpot,
  frontZ,
  isImageName,
  listOrder,
  noteMatches,
  noteTitle,
  nudge,
  pointOnCanvas,
  screenScale,
  taskTitleFromNote,
  tiltFor,
  toLayoutDelta,
} from "./board";

describe("tiltFor", () => {
  it("is stable for an id and always within -2 to 2 degrees", () => {
    const id = "6f0c1f0e-2b7a-4f0e-9c1d-0a1b2c3d4e5f";
    expect(tiltFor(id)).toBe(tiltFor(id));
    for (let i = 0; i < 500; i++) {
      const t = tiltFor(crypto.randomUUID());
      expect(t).toBeGreaterThanOrEqual(-2);
      expect(t).toBeLessThanOrEqual(2);
    }
  });

  it("differs between notes", () => {
    const tilts = new Set(Array.from({ length: 50 }, () => tiltFor(crypto.randomUUID())));
    expect(tilts.size).toBeGreaterThan(10);
  });
});

describe("coordinate conversion at the 80% app zoom", () => {
  it("derives the scale from on-screen and layout widths", () => {
    expect(screenScale(800, 1000)).toBeCloseTo(0.8);
    expect(screenScale(390, 390)).toBe(1);
    expect(screenScale(0, 100, 0.8)).toBe(0.8);
    expect(screenScale(100, 0)).toBe(1);
  });

  it("turns screen movement into layout movement", () => {
    expect(toLayoutDelta(80, 0.8)).toBeCloseTo(100);
    expect(toLayoutDelta(-40, 0.8)).toBeCloseTo(-50);
    expect(toLayoutDelta(10, 1)).toBe(10);
    expect(toLayoutDelta(10, 0)).toBe(10);
  });

  it("places a click on the canvas in layout pixels", () => {
    // Canvas drawn at screen (200, 100); a click at (520, 260) is (400, 200) in layout px.
    const p = pointOnCanvas({ x: 520, y: 260 }, { left: 200, top: 100 }, 0.8);
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(200);
  });
});

describe("clampLayout", () => {
  it("keeps notes on the canvas and within the size limits", () => {
    expect(clampLayout({ x: -30, y: -5, width: 50, height: 50 })).toEqual({
      x: 0,
      y: 0,
      width: MIN_WIDTH,
      height: MIN_HEIGHT,
    });
    const big = clampLayout({ x: 1e9, y: 1e9, width: 1e9, height: 1e9 });
    expect(big.width).toBe(MAX_WIDTH);
    expect(big.height).toBe(MAX_HEIGHT);
    expect(big.x + big.width).toBe(MAX_COORD);
    expect(big.y + big.height).toBe(MAX_COORD);
  });

  it("rounds to whole pixels", () => {
    expect(clampLayout({ x: 10.4, y: 20.6, width: 240.2, height: 220.7 })).toEqual({
      x: 10,
      y: 21,
      width: 240,
      height: 221,
    });
  });
});

describe("nudge", () => {
  const l = { x: 100, y: 100, width: 240, height: 220 };
  it("moves by a small step, or a large one with Shift", () => {
    expect(nudge(l, "ArrowRight", {})).toMatchObject({ x: 100 + NUDGE, y: 100 });
    expect(nudge(l, "ArrowUp", { large: true })).toMatchObject({ x: 100, y: 100 - NUDGE_LARGE });
  });
  it("resizes with Alt, and never leaves the board", () => {
    expect(nudge(l, "ArrowRight", { resize: true })).toMatchObject({ width: 240 + NUDGE, x: 100 });
    expect(nudge({ ...l, x: 0 }, "ArrowLeft", {}).x).toBe(0);
    expect(nudge({ ...l, width: MIN_WIDTH }, "ArrowLeft", { resize: true }).width).toBe(MIN_WIDTH);
  });
});

describe("freeSpot and canvasSize", () => {
  const size = { width: 240, height: 220 };
  it("starts at the top left and skips occupied slots", () => {
    expect(freeSpot([], 1000)).toEqual({ x: 24, y: 24 });
    const first = { x: 24, y: 24, ...size };
    expect(freeSpot([first], 1000)).toEqual({ x: 288, y: 24 });
  });
  it("wraps to the next row when the row is full", () => {
    const row = [24, 288, 552].map((x) => ({ x, y: 24, ...size }));
    expect(freeSpot(row, 840)).toEqual({ x: 24, y: 268 });
  });
  it("grows the canvas to hold the notes plus a margin", () => {
    expect(canvasSize([], { width: 1000, height: 600 })).toEqual({ width: 1000, height: 600 });
    expect(canvasSize([{ x: 900, y: 700, ...size }], { width: 1000, height: 600 })).toEqual({
      width: 1260,
      height: 1040,
    });
  });
});

describe("text helpers", () => {
  it("titles a note by its first line, or its first checklist line", () => {
    expect(noteTitle("\n  Call Dell\nabout the invoice")).toBe("Call Dell");
    expect(noteTitle("", [{ id: "a", text: "Buy cables", done: false }])).toBe("Buy cables");
    expect(noteTitle("  ")).toBe("Empty note");
    expect(noteTitle("x".repeat(100))).toHaveLength(60);
  });

  it("builds the task title from the text on one line", () => {
    expect(taskTitleFromNote("Call Dell\n\nabout the invoice")).toBe(
      "Call Dell · about the invoice",
    );
    expect(taskTitleFromNote("", [{ id: "a", text: "Buy cables", done: false }])).toBe(
      "Buy cables",
    );
    expect(taskTitleFromNote("   ")).toBeNull();
    expect(taskTitleFromNote("y".repeat(400))).toHaveLength(300);
  });

  it("recognises images that browsers can draw", () => {
    expect(isImageName("Screenshot.PNG")).toBe(true);
    expect(isImageName("photo.jpeg")).toBe(true);
    expect(isImageName("scan.pdf")).toBe(false);
    expect(isImageName("photo.heic")).toBe(false);
  });

  it("formats file sizes", () => {
    expect(fileSize(512)).toBe("512 B");
    expect(fileSize(2048)).toBe("2 KB");
    expect(fileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("ordering", () => {
  it("lists notes top to bottom, then left to right", () => {
    const n = (id: string, x: number, y: number) => ({ id, x, y, width: 1, height: 1 });
    expect(listOrder([n("c", 0, 300), n("b", 300, 0), n("a", 0, 0)]).map((v) => v.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  it("puts a touched note in front", () => {
    expect(frontZ([1, 5, 3])).toBe(6);
    expect(frontZ([])).toBe(1);
  });
});

describe("arrangeGrid", () => {
  const mk = (id: string, x: number, y: number, width = 240, height = 220) => ({
    id,
    x,
    y,
    width,
    height,
  });
  const overlap = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

  it("keeps the reading order and starts at the top left", () => {
    const notes = [mk("c", 500, 400), mk("a", 10, 10), mk("b", 300, 12)];
    const out = arrangeGrid(notes, 1000);
    expect(out.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(out[0]).toMatchObject({ x: 24, y: 24 });
    expect(out[1]).toMatchObject({ x: 288, y: 24 });
  });

  it("wraps within the width and never overlaps, with mixed sizes", () => {
    const notes = Array.from({ length: 11 }, (_, i) =>
      mk(`n${i}`, (i * 97) % 700, (i * 53) % 500, 160 + ((i * 41) % 200), 140 + ((i * 67) % 300)),
    );
    const width = 900;
    const out = arrangeGrid(notes, width);
    expect(out).toHaveLength(11);
    const placed = out.map((o) => ({ ...notes.find((n) => n.id === o.id)!, ...o }));
    for (const p of placed) expect(p.x + p.width).toBeLessThanOrEqual(width - 24);
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++)
        expect(overlap(placed[i]!, placed[j]!)).toBe(false);
  });

  it("gives a note wider than the board its own row", () => {
    const out = arrangeGrid([mk("a", 0, 0, 640, 200), mk("b", 0, 300)], 400);
    expect(out[0]).toMatchObject({ x: 24, y: 24 });
    expect(out[1]).toMatchObject({ x: 24, y: 24 + 200 + 24 });
  });

  it("handles no notes", () => {
    expect(arrangeGrid([], 800)).toEqual([]);
  });
});

describe("noteMatches", () => {
  const note = {
    text: "Priya UAE Pass",
    checklist: [{ id: "1", text: "Buy cables", done: false }],
    colour: "pink" as const,
  };
  it("searches text and checklist lines, ignoring case", () => {
    expect(noteMatches(note, "uae", new Set())).toBe(true);
    expect(noteMatches(note, " CABLES ", new Set())).toBe(true);
    expect(noteMatches(note, "otp", new Set())).toBe(false);
    expect(noteMatches(note, "", new Set())).toBe(true);
  });
  it("filters by colour together with the text", () => {
    expect(noteMatches(note, "", new Set(["pink"]))).toBe(true);
    expect(noteMatches(note, "", new Set(["blue", "green"]))).toBe(false);
    expect(noteMatches(note, "uae", new Set(["blue"]))).toBe(false);
  });
});
