"use client";

/** Last-resort fallback when the root layout itself fails. */
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en-GB">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#F7F6F3",
          color: "#17181B",
        }}
      >
        <div role="alert" style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 18 }}>IT Ops didn’t load</h1>
          <p style={{ color: "#4A4D55" }}>Something went wrong. Nothing was changed.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: 6,
              border: 0,
              background: "#1A53A7",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
