import { ImageResponse } from "next/og";

import { MARK_PATHS } from "@/components/ui";

/**
 * Home-screen icon. iOS fills transparency with black, so this one sits on
 * paper; the corners are rounded by the device.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffe4d2",
          border: "12px solid #172033",
        }}
      >
        <svg width={124} height={124} viewBox="0 0 32 32">
          <path d={MARK_PATHS.record} fill="#3659cf" />
          <path d={MARK_PATHS.world} fill="#258663" />
        </svg>
      </div>
    ),
    size,
  );
}
