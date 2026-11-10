"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { sendMagicLink, type LoginState } from "./actions";

const COOLDOWN_SECONDS = 60;

/** Seconds left before another link may be requested, counting down once a second. */
function useCooldown(sentAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sentAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sentAt]);
  if (sentAt === null) return 0;
  const elapsed = Math.max(0, Math.floor((now - sentAt) / 1000));
  return Math.min(COOLDOWN_SECONDS, Math.max(0, COOLDOWN_SECONDS - elapsed));
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {
    status: "idle",
  });
  // "Use a different address" hides the sent state until the next result arrives.
  const [changedFor, setChangedFor] = useState<LoginState | null>(null);
  const cooldown = useCooldown(state.status === "sent" ? state.sentAt : null);

  if (state.status === "sent" && changedFor !== state) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2" role="status">
          <p className="m-0 font-semibold">Check your inbox</p>
          <p className="m-0 text-ink2">
            A sign-in link is on its way to{" "}
            <span className="font-medium text-ink">{state.email}</span>. Open it on this device to
            continue.
          </p>
        </div>
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="email" value={state.email} />
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <Button
            type="submit"
            variant="primary"
            disabled={pending || cooldown > 0}
            className="justify-center"
          >
            {pending ? "Sending…" : cooldown > 0 ? `Resend link (${cooldown}s)` : "Resend link"}
          </Button>
          <Button type="button" className="justify-center" onClick={() => setChangedFor(state)}>
            Use a different address
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <label htmlFor="email" className="lbl">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        autoFocus
        defaultValue={state.status === "error" ? state.email : undefined}
        key={state.status === "error" ? state.message : "idle"}
        className="field"
        aria-invalid={state.status === "error"}
        aria-describedby={state.status === "error" ? "login-error" : undefined}
      />
      {state.status === "error" ? (
        <p id="login-error" className="alert red sm" role="alert">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={pending} className="justify-center">
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
