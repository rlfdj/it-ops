// One place for record URLs, so every PO number, stock tag, subscription and person
// links to the same view.

export const poHref = (poNumber: string) => `/procurement?po=${encodeURIComponent(poNumber)}`;
/** The stock list filtered to one tag. */
export const stockHref = (tag: string, status?: string) =>
  `/stock?q=${encodeURIComponent(tag)}${status && status !== "in_stock" ? "&view=all" : ""}`;
export const subscriptionHref = (id: string) => `/subscriptions?sub=${encodeURIComponent(id)}`;
export const personHref = (id: string) => `/onboarding?person=${encodeURIComponent(id)}`;
export const taskHref = (id: string) => `/tasks?task=${encodeURIComponent(id)}`;
export const documentHref = (id: string) => `/documents/${encodeURIComponent(id)}`;

/** `/procurement?…&po=PO-…`, keeping the current tab and filter (`query` excludes `po`). */
export function procurementHref(query: string, poNumber?: string) {
  const params = new URLSearchParams(query);
  if (poNumber) params.set("po", poNumber);
  else params.delete("po");
  const s = params.toString();
  return s ? `/procurement?${s}` : "/procurement";
}
