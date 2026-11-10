import Link from "@/components/link";

export default function NotFound() {
  return (
    <main id="content" tabIndex={-1} className="page">
      <div className="empty">
        <b>Not found</b>
        <span>That record or page doesn’t exist. It may have been removed.</span>
        <Link className="btn pri mt-3" href="/">
          Go to Dashboard
        </Link>
      </div>
    </main>
  );
}
