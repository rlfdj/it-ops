import { expect, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";

/**
 * The Board workflow, shared by the focused spec (e2e/focus/board.spec.ts) and the full
 * suite (e2e/workflows.spec.ts). Creates one note (and a task from it), exercises it, and
 * removes everything it made. Set BOARD_SHOTS to a folder to also save screenshots.
 */
const ex = expect.configure({ timeout: 15_000 });

// A small gradient PNG (160x100), built here so no asset file is needed.
function makePng(w = 160, h = 100): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = 40 + Math.round((x / w) * 180);
      raw[i + 1] = 90 + Math.round((y / h) * 120);
      raw[i + 2] = 200 - Math.round((x / w) * 90);
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const PNG = makePng();

const px = (v: string) => Number.parseFloat(v);

async function layoutOf(note: ReturnType<Page["locator"]>) {
  return note.evaluate((el) => {
    const s = (el as HTMLElement).style;
    return {
      left: parseFloat(s.left),
      top: parseFloat(s.top),
      width: parseFloat(s.width),
      height: parseFloat(s.height),
    };
  });
}

export async function boardSteps(
  page: Page,
  step: (title: string, body: () => Promise<void>) => Promise<void>,
  stamp: string,
) {
  const TEXT = `E2E board note ${stamp}`;
  const FILE = `shot-${stamp}.png`;
  const shots = process.env.BOARD_SHOTS;
  const shot = async (name: string, full = false) => {
    if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: full });
  };
  // The test's own note, by id once it exists: the board also holds the owner's real notes,
  // and their order can change after a reload.
  let noteId: string | null = null;
  const note = () =>
    noteId
      ? page.locator(`.note.on-board[data-note-id="${noteId}"]`)
      : page.locator(".note.on-board", { has: page.locator("textarea:focus") });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await step("Board: click the board to add a note and type in it", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/board");
    await ex(page.getByRole("heading", { level: 1, name: "Board" })).toBeVisible();
    const canvas = page.locator(".board-canvas");
    const box = (await canvas.boundingBox())!;
    const before = await page.locator(".note.on-board").count();
    // A spot on the bare cork (other notes may already be on the board).
    const clickAt = await page.evaluate(
      ({ bx, by }) => {
        for (let y = by + 60; y < by + 600; y += 40)
          for (let x = bx + 400; x < bx + 700; x += 40)
            if (
              (document.elementFromPoint(x, y) as HTMLElement | null)?.classList.contains(
                "board-canvas",
              )
            )
              return { x, y };
        return { x: bx + 400, y: by + 60 };
      },
      { bx: box.x, by: box.y },
    );
    await page.mouse.click(clickAt.x, clickAt.y);
    await ex(page.locator(".note.on-board")).toHaveCount(before + 1);
    const n = note(); // the new note is the one with focus
    await ex(n.getByRole("textbox", { name: "Note text" })).toBeFocused();
    noteId = await n.getAttribute("data-note-id");
    expect(noteId).toBeTruthy();
    // The pin lands where the click was (80% zoom: screen px / 0.8 = layout px).
    const l = await layoutOf(n);
    const zoom = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).zoom),
    );
    expect(zoom).toBeCloseTo(0.8, 2);
    expect(Math.abs(l.left + l.width / 2 - (clickAt.x - box.x) / zoom)).toBeLessThan(2);
    expect(Math.abs(l.top + 12 - (clickAt.y - box.y) / zoom)).toBeLessThan(2);
    await page.keyboard.type(TEXT);
    await n.getByRole("textbox", { name: "Note text" }).blur();
  });

  await step("Board: add a checklist line and tick it", async () => {
    const n = note();
    await n.getByRole("button", { name: "Add checklist line" }).click();
    await page.keyboard.type("Buy cables");
    await n.getByRole("checkbox", { name: "Done: Buy cables" }).check();
    await ex(n.getByRole("checkbox", { name: "Done: Buy cables" })).toBeChecked();
  });

  await step("Board: dragging lands under the pointer at 1440px, and saves", async () => {
    const n = note();
    const before = await layoutOf(n);
    const head = (await n.locator(".note-head").boundingBox())!;
    const start = { x: head.x + head.width - 70, y: head.y + 20 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 100, start.y + 50, { steps: 5 });
    await page.mouse.move(start.x + 200, start.y + 100, { steps: 5 });
    // While dragging the note is straight, so its box moves exactly with the pointer.
    const mid = (await n.boundingBox())!;
    const dragStart = { x: head.x, y: head.y };
    await ex(n).toHaveClass(/dragging/);
    // (scale(1.02) grows the box about its centre, hence the small tolerance)
    expect(Math.abs(mid.x - dragStart.x - 200)).toBeLessThan(12);
    expect(Math.abs(mid.y - dragStart.y - 100)).toBeLessThan(12);
    await page.mouse.up();
    const after = await layoutOf(n);
    // 200 / 0.8 = 250 layout px.
    expect(after.left - before.left).toBeCloseTo(250, 0);
    expect(after.top - before.top).toBeCloseTo(125, 0);
    // The saved position follows: reload and compare.
    await ex(page.locator(".eyebrow")).toContainText("Saved");
    await page.reload();
    const reloaded = await layoutOf(note());
    expect(reloaded.left).toBeCloseTo(after.left, 0);
    expect(reloaded.top).toBeCloseTo(after.top, 0);
  });

  await step("Board: resize with the corner handle, change colour", async () => {
    const n = note();
    const before = await layoutOf(n);
    const handle = (await n.locator(".note-resize").boundingBox())!;
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y + 20, { steps: 4 });
    await page.mouse.move(start.x + 80, start.y + 40, { steps: 4 });
    await page.mouse.up();
    const after = await layoutOf(n);
    expect(after.width - before.width).toBeCloseTo(100, 0);
    expect(after.height - before.height).toBeCloseTo(50, 0);

    await n.getByRole("radio", { name: "Pink" }).click();
    await ex(n).toHaveAttribute("data-colour", "pink");
    await ex(n.getByRole("radio", { name: "Pink" })).toHaveAttribute("aria-checked", "true");
  });

  await step("Board: attach a PNG and see its thumbnail", async () => {
    const n = note();
    await n
      .getByLabel("Choose files to attach to this note")
      .setInputFiles({ name: FILE, mimeType: "image/png", buffer: PNG });
    const img = n.getByRole("img", { name: FILE });
    await ex(img).toBeVisible();
    await ex
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await shot("note-with-image-and-checklist");
  });

  await step("Board: link a record, then make a task and find it on Tasks", async () => {
    const n = note();
    await n.getByRole("button", { name: "Link a record" }).click();
    const dialog = page.getByRole("dialog", { name: "Link a record" });
    const options = dialog.locator("datalist option");
    await ex(options.first()).toBeAttached();
    const label = (await options.first().getAttribute("value"))!;
    await dialog.getByLabel("Record").fill(label);
    await dialog.getByRole("button", { name: "Save link" }).click();
    await ex(dialog).toBeHidden();
    await ex(n.locator(".note-chip")).toBeVisible();

    await n.getByRole("button", { name: "Make task" }).click();
    const toast = page.locator(".toasts .toast", { hasText: "Task created" });
    await ex(toast).toBeVisible();
    await ex(toast.getByRole("link", { name: "Open task" })).toBeVisible();
    await ex(n.getByRole("link", { name: "Open the task made from this note" })).toBeVisible();

    await page.goto(`/tasks?q=${encodeURIComponent(TEXT)}`);
    const row = page.getByRole("row").filter({ hasText: TEXT });
    await ex(row).toHaveCount(1);
    // Remove the task this made.
    await row.getByRole("button", { name: /^Edit “/ }).click();
    await page
      .getByRole("dialog", { name: "Edit task" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: /^Delete “/ })
      .getByRole("button", { name: "Delete task" })
      .click();
    await ex(row).toHaveCount(0);
  });

  await step("Board: activity log has the note, without move/resize noise", async () => {
    await page.goto(`/activity?range=all&q=${encodeURIComponent(TEXT)}`);
    await ex(page.getByText("Edited note").first()).toBeVisible();
    await ex(page.getByText("Made a task from note").first()).toBeVisible();
    await page.goto(`/activity?range=all&q=${encodeURIComponent(FILE)}`);
    await ex(page.getByText(`Attached file ${FILE} to`).first()).toBeVisible();
  });

  await step("Board: keyboard nudge, then delete with Undo, then for real", async () => {
    await page.goto("/board");
    const n = note();
    await n.focus();
    const before = await layoutOf(n);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    const moved = await layoutOf(n);
    expect(moved.left - before.left).toBe(8);
    expect(moved.top - before.top).toBe(32);

    await n.getByRole("button", { name: "Delete note" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this note?" });
    await ex(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirm.getByRole("button", { name: "Delete note" }).click();
    await ex(page.getByRole("group", { name: `Note: ${TEXT}` })).toHaveCount(0);
    const toast = page.locator(".toasts .toast", { hasText: "Deleted" });
    await toast.getByRole("button", { name: "Undo" }).click();
    await ex(page.getByRole("group", { name: `Note: ${TEXT}` })).toHaveCount(1);
    await ex(page.getByRole("img", { name: FILE })).toBeVisible();

    // Phones: the same note in a stacked list, with the same actions.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const stacked = page
      .locator(".note.stacked", {
        has: page.getByRole("textbox", { name: "Note text" }),
      })
      .and(page.getByRole("group", { name: `Note: ${TEXT}` }));
    await ex(page.locator(".board-stack")).toBeVisible();
    await ex(page.locator(".board")).toHaveCount(0);
    await ex(stacked.getByRole("textbox", { name: "Note text" })).toHaveValue(TEXT);
    await ex(stacked).toHaveAttribute("data-colour", "pink");
    await shot("phone-list", true);

    // Delete for real (on the phone list), and give the clean-up time to run.
    await stacked.getByRole("button", { name: "Delete note" }).click();
    await page
      .getByRole("dialog", { name: "Delete this note?" })
      .getByRole("button", { name: "Delete note" })
      .click();
    await ex(
      page.getByRole("textbox", { name: "Note text" }).filter({ hasText: TEXT }),
    ).toHaveCount(0);
    await page.waitForTimeout(16_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await ex(page.getByRole("group", { name: `Note: ${TEXT}` })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

export { px };
