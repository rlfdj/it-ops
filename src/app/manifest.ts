import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/config";

// Makes the app installable (Chrome/Edge "Install app", Safari "Add to Dock").
// Static on purpose: no service worker and no offline mode, so live data is never stale.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: "IT Ops",
    description: "IT procurement, stock, license and on/offboarding operations.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F7F6F3",
    theme_color: "#3b3a39",
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
