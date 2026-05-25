import React from "react";
import { COLORS, FONTS, GLOW } from "../theme";

export const Brandmark: React.FC<{ size?: number }> = ({ size = 40 }) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: size * 0.3,
        fontFamily: FONTS.sans,
        fontWeight: 800,
        fontSize: size,
        color: COLORS.text,
        letterSpacing: -1,
        lineHeight: 1,
      }}
    >
      <span>S3</span>
      <span
        style={{
          width: size * 0.28,
          height: size * 0.28,
          borderRadius: "50%",
          background: COLORS.accent,
          boxShadow: GLOW,
        }}
      />
    </div>
  );
};
