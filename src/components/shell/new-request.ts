export const NEW_REQUEST_EVENT = "itops:new";

/**
 * Start a module's New flow. The open page may handle it in place (it cancels the event, e.g. the
 * board adds a note); otherwise we navigate to `href` (`/module?new=1`). Navigating to the same
 * `?new=1` twice on one page isn't seen as a new request, hence the event.
 */
export function requestNew(href: string, push: (href: string) => void) {
  const event = new CustomEvent<string>(NEW_REQUEST_EVENT, { cancelable: true, detail: href });
  if (window.dispatchEvent(event)) push(href);
}
