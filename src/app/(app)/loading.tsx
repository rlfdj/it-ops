/** Shown inside the app shell while a screen's data loads. */
export default function Loading() {
  return (
    <main className="page" aria-busy="true">
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div className="flex flex-col gap-2.5" aria-hidden>
        <span className="skel h-3 w-36" />
        <span className="skel h-8 w-64" />
      </div>
      <div className="flex flex-col border-t border-line" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-6 border-b border-line py-3.5">
            <span className="skel h-3.5 w-28" />
            <span className="skel h-3.5 flex-1" style={{ maxWidth: `${70 - (i % 3) * 15}%` }} />
            <span className="skel ml-auto h-3.5 w-20" />
          </div>
        ))}
      </div>
    </main>
  );
}
