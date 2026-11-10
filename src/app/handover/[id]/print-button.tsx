"use client";

export function PrintButton() {
  return (
    <button type="button" className="btn pri no-print" onClick={() => window.print()}>
      Print
    </button>
  );
}
