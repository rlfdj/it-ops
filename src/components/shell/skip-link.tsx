"use client";

/**
 * "Skip to content": the first tab stop in the shell (B-30, WCAG 2.4.1). Focuses the page's
 * `main#content` directly instead of relying on the browser's fragment navigation, which the
 * app router can swallow.
 */
export function SkipLink() {
  return (
    <a
      className="skip"
      href="#content"
      onClick={(event) => {
        const main = document.getElementById("content");
        if (!main) return;
        event.preventDefault();
        main.focus();
        main.scrollIntoView({ block: "start" });
      }}
    >
      Skip to content
    </a>
  );
}
