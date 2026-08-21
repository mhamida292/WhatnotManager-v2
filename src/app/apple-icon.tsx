import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          background: "#f0fdf4",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Outer diamond */}
        <div
          style={{
            width: 128,
            height: 128,
            background: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
            transform: "rotate(45deg)",
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Inner diamond — at 0deg inside 45deg parent = appears as diamond */}
          <div
            style={{
              width: 64,
              height: 64,
              background: "rgba(255,255,255,0.18)",
              borderRadius: 4,
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
