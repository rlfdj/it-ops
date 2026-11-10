"use client";

import { useEffect } from "react";
import Link from "@/components/link";

/** A screen failed to load (usually the database): keep the shell, offer a retry. */
export default function ScreenError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="content" tabIndex={-1} className="page">
      <div className="empty" role="alert">
        <b>This screen didn’t load</b>
        <span>
          Something went wrong talking to the database. Nothing was changed.
          {error.digest ? (
            <>
              {" "}
              Reference <span className="id">{error.digest}</span>.
            </>
          ) : null}
        </span>
        <span className="actions">
          <button type="button" className="btn pri" onClick={() => retry()}>
            Try again
          </button>
          <Link className="btn" href="/">
            Go to Dashboard
          </Link>
        </span>
      </div>
    </main>
  );
}
