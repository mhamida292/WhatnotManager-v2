import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: "#f0fdf4",
          borderRadius: 7,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 19,
            height: 19,
            background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            transform: "rotate(45deg)",
            borderRadius: 2,
          }}
        />
      </div>
    ),
    { ...size },
  );
}
