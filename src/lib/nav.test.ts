import { describe, expect, it } from "vitest";
import { findModuleForPath, moduleForPath, NAV, newHrefFor } from "./nav";

describe("moduleForPath", () => {
  it("maps paths, including detail pages, to their module", () => {
    expect(moduleForPath("/").key).toBe("dashboard");
    expect(moduleForPath("/stock").key).toBe("stock");
    expect(moduleForPath("/procurement/anything").key).toBe("procurement");
    expect(moduleForPath("/activity").key).toBe("activity");
  });

  it("does not match on a shared prefix", () => {
    expect(moduleForPath("/stockx").key).toBe("dashboard");
  });
});

describe("findModuleForPath", () => {
  it("finds modules, and nothing for pages that are not one", () => {
    expect(findModuleForPath("/")?.key).toBe("dashboard");
    expect(findModuleForPath("/tasks/abc")?.key).toBe("tasks");
    expect(findModuleForPath("/settings")).toBeUndefined();
    expect(findModuleForPath("/settings/anything")).toBeUndefined();
    expect(findModuleForPath("/stockx")).toBeUndefined();
  });
});

describe("navigation", () => {
  it("follows the required order", () => {
    expect(NAV.map((n) => n.label)).toEqual([
      "Dashboard",
      "Activity log",
      "Procurement",
      "Stock",
      "Tasks",
      "Subscriptions",
      "On / Offboarding",
      "Board",
    ]);
  });

  it("has unique G-shortcut keys", () => {
    const keys = NAV.map((n) => n.goKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("opens the module create flow for New", () => {
    expect(newHrefFor(moduleForPath("/procurement"))).toBe("/procurement?new=1");
    expect(newHrefFor(moduleForPath("/"))).toBeNull();
    expect(newHrefFor(moduleForPath("/board"))).toBe("/board?new=1");
    expect(moduleForPath("/board").newLabel).toBe("New note");
  });
});
