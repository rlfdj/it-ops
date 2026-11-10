/**
 * Request header the proxy sets after verifying the session, so pages and actions don't
 * verify the same JWT a second time (each verification costs server CPU). The proxy always deletes any incoming copy first, so a client cannot forge it.
 * Value: JSON `{ email, id }` when signed in, "-" when not.
 */
export const SESSION_HEADER = "x-itops-session";
