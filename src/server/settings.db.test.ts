import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { alertStates } from "@/db/schema";
import { client, inRollback } from "@/test/db";
import { markAlertsRead, setAlertState } from "./alerts";
import {
  getBilling,
  getSettingsTx,
  getTimeZoneTx,
  getUsdRate,
  saveSettings,
  setLogoPath,
} from "./settings";

afterAll(() => client.end());

describe("workspace settings", () => {
  it("saves the name and rate, and rejects a bad rate", async () => {
    await inRollback(async (tx) => {
      expect(await getUsdRate(tx, 3.6725)).toBeGreaterThan(0);
      await saveSettings(tx, { workspaceName: " Test Desk ", usdAedRate: "3.70" });
      expect(await getUsdRate(tx, 3.6725)).toBe(3.7);
      await saveSettings(tx, { workspaceName: "Test Desk 2", usdAedRate: "3.7123456" });
      expect(await getUsdRate(tx, 3.6725)).toBe(3.7123);
      await expect(saveSettings(tx, { workspaceName: "x", usdAedRate: "0" })).rejects.toThrow();
      await expect(saveSettings(tx, { workspaceName: " ", usdAedRate: "3.6" })).rejects.toThrow();
    });
  });
});

describe("workspace branding settings", () => {
  it("saves the base currency and time zone, and keeps them when only the name changes", async () => {
    await inRollback(async (tx) => {
      await saveSettings(tx, {
        workspaceName: "Acme",
        usdAedRate: "0.92",
        baseCurrency: "eur",
        timeZone: "Europe/Berlin",
      });
      expect(await getSettingsTx(tx)).toMatchObject({
        workspaceName: "Acme",
        usdAedRate: 0.92,
        baseCurrency: "EUR",
        timeZone: "Europe/Berlin",
      });
      expect(await getBilling(tx)).toEqual({ usdRate: 0.92, baseCurrency: "EUR" });
      expect(await getTimeZoneTx(tx)).toBe("Europe/Berlin");
      await saveSettings(tx, { workspaceName: "Acme 2", usdAedRate: "0.9" });
      expect(await getSettingsTx(tx)).toMatchObject({
        workspaceName: "Acme 2",
        baseCurrency: "EUR",
        timeZone: "Europe/Berlin",
      });
    });
  });

  it("rejects an unknown currency or time zone", async () => {
    await inRollback(async (tx) => {
      await expect(
        saveSettings(tx, { workspaceName: "x", usdAedRate: "1", baseCurrency: "XYZ" }),
      ).rejects.toThrow();
      await expect(
        saveSettings(tx, { workspaceName: "x", usdAedRate: "1", timeZone: "Mars/Olympus" }),
      ).rejects.toThrow();
    });
  });

  it("sets and clears the logo, returning the file it replaced", async () => {
    await inRollback(async (tx) => {
      await setLogoPath(tx, null);
      expect(await setLogoPath(tx, "branding/logo-aaaa1111.png")).toBeNull();
      expect((await getSettingsTx(tx)).logoPath).toBe("branding/logo-aaaa1111.png");
      expect(await setLogoPath(tx, "branding/logo-bbbb2222.svg")).toBe(
        "branding/logo-aaaa1111.png",
      );
      expect(await setLogoPath(tx, null)).toBe("branding/logo-bbbb2222.svg");
      expect((await getSettingsTx(tx)).logoPath).toBeNull();
    });
  });

  it("defaults to AED and Asia/Dubai", async () => {
    await inRollback(async (tx) => {
      const s = await getSettingsTx(tx);
      expect(typeof s.baseCurrency).toBe("string");
      expect(typeof s.timeZone).toBe("string");
    });
  });
});

describe("alert state", () => {
  it("remembers read and dismissed, and read-all never undoes a dismissal", async () => {
    await inRollback(async (tx) => {
      await setAlertState(tx, "po:test-1", "read");
      await setAlertState(tx, "po:test-1", "dismissed");
      await markAlertsRead(tx, ["po:test-1", "po:test-2"]);
      const rows = await tx.select().from(alertStates).where(eq(alertStates.alertKey, "po:test-1"));
      expect(rows[0]!.state).toBe("dismissed");
      const second = await tx
        .select()
        .from(alertStates)
        .where(eq(alertStates.alertKey, "po:test-2"));
      expect(second[0]!.state).toBe("read");
    });
  });
});
