/** Every keyboard binding, for the "?" sheet and the Settings page. */
export const SHORTCUT_GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: "Anywhere",
    items: [
      { keys: ["Ctrl", "K"], label: "Search records and actions" },
      { keys: ["N"], label: "New record in this module" },
      { keys: ["["], label: "Hide or show the sidebar" },
      { keys: ["?"], label: "Show this list" },
    ],
  },
  {
    title: "Go to (press G, then)",
    items: [
      { keys: ["G", "D"], label: "Dashboard" },
      { keys: ["G", "P"], label: "Procurement" },
      { keys: ["G", "A"], label: "Stock" },
      { keys: ["G", "T"], label: "Tasks" },
      { keys: ["G", "S"], label: "Subscriptions" },
      { keys: ["G", "O"], label: "On / Offboarding" },
      { keys: ["G", "B"], label: "Board" },
      { keys: ["G", "L"], label: "Activity log" },
    ],
  },
  {
    title: "In lists",
    items: [
      { keys: ["/"], label: "Focus the filter" },
      { keys: ["K"], label: "Next row" },
      { keys: ["J"], label: "Previous row" },
      { keys: ["Enter"], label: "Open the selected row" },
      { keys: ["E"], label: "Edit" },
      { keys: ["Esc"], label: "Close the panel" },
    ],
  },
];
