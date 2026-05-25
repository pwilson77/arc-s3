import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONTS } from "../theme";
import { StatusBar, StatusBarFooter } from "../components/StatusBar";

const lines = [
  {
    at: 0.4,
    text: "Agents trade, lend, and bet faster than humans can review.",
  },
  { at: 3.0, text: "One bad intent drains a treasury." },
  { at: 5.4, text: "One missed deadline locks funds." },
  { at: 7.6, text: "Reputation lives in screenshots, not on-chain." },
  {
    at: 9.6,
    text: "Policy lives in prompts, not in contracts.",
    emphasize: true,
  },
];

export const ProblemStatement: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        padding: "180px 140px 120px",
        justifyContent: "center",
      }}
    >
      <GridBackdrop />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        <div
          style={{
            fontFamily: FONTS.mono,
            color: COLORS.accent,
            fontSize: 20,
            letterSpacing: 3,
            textTransform: "uppercase",
            marginBottom: 12,
            opacity: interpolate(frame, [0, 20], [0, 1], {
              extrapolateRight: "clamp",
            }),
          }}
        >
          The problem
        </div>
        {lines.map((l, i) => {
          const startFrame = l.at * fps;
          const t = interpolate(frame - startFrame, [0, 18], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const opacity = t;
          const y = interpolate(t, [0, 1], [12, 0]);
          return (
            <div
              key={i}
              style={{
                opacity,
                transform: `translateY(${y}px)`,
                color: l.emphasize ? COLORS.text : COLORS.text,
                fontFamily: FONTS.sans,
                fontWeight: l.emphasize ? 700 : 500,
                fontSize: l.emphasize ? 72 : 56,
                lineHeight: 1.2,
                letterSpacing: -0.5,
              }}
            >
              {l.text}
            </div>
          );
        })}
      </div>
      <StatusBar />
      <StatusBarFooter />
    </AbsoluteFill>
  );
};

const GridBackdrop: React.FC = () => {
  return (
    <svg
      width="100%"
      height="100%"
      style={{ position: "absolute", inset: 0, opacity: 0.4 }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
          <path
            d="M 80 0 L 0 0 0 80"
            fill="none"
            stroke={COLORS.grid}
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
    </svg>
  );
};
