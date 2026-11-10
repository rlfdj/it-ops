import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The neutral "IT" mark as a PNG for iOS home screens (rendered by Next, no binary asset).
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1a53a7",
        color: "#ffffff",
        fontSize: 92,
        fontWeight: 700,
        letterSpacing: -2,
      }}
    >
      IT
    </div>,
    size,
  );
}
