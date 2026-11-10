"use client";

import NextLink from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * The app's link. Prefetches on intent only: when the pointer enters it, it gets keyboard
 * focus or a finger touches it, not when it scrolls into view. Every page here is dynamic
 * and many show dozens of record links (renewals, tasks, activity, view tabs), so viewport
 * prefetch rendered a page on the server for each one on every load or filter change.
 * Hover usually comes 100 ms+ before the click, so navigation still feels instant.
 * An explicit `prefetch={false}` still disables it entirely.
 */
export default function Link({
  prefetch,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: ComponentProps<typeof NextLink>) {
  const [intent, setIntent] = useState(false);
  const wanted = prefetch === false ? false : intent ? (prefetch ?? null) : false;
  return (
    <NextLink
      {...props}
      prefetch={wanted}
      onMouseEnter={(e) => {
        setIntent(true);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
    />
  );
}
