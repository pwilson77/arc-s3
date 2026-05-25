import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONTS, GLOW } from "../theme";
import { StatusBar, StatusBarFooter } from "../components/StatusBar";
import { Brandmark } from "../components/Brandmark";

const CARDS = [
  {
    name: "S3IntentFirewall",
    role: "permits & filters",
    detail: "executeIntent · permit",
  },
  {
    name: "S3EscrowCourthouse",
    role: "bonds & settles",
    detail: "createTask · settle",
  },
  {
    name: "S3ReputationRegistry",
    role: "scores agents",
    detail: "EWMA · USYC stake",
  },
];

export const SolutionReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{ backgroundColor: COLORS.bg, padding: "180px 140px 120px" }}
    >
      <GridBackdrop />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 48,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Brandmark size={64} />
          <div
            style={{
              fontFamily: FONTS.sans,
              color: COLORS.textDim,
              fontSize: 28,
              fontWeight: 500,
              opacity: interpolate(frame, [0, 20], [0, 1], {
                extrapolateRight: "clamp",
              }),
            }}
          >
            three contracts on arc testnet
          </div>
        </div>
        <div
          style={{
            fontFamily: FONTS.sans,
            color: COLORS.text,
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: -1,
            maxWidth: 1400,
            opacity: interpolate(frame, [10, 40], [0, 1], {
              extrapolateRight: "clamp",
            }),
          }}
        >
          A courthouse for agents.
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 24 }}>
          {CARDS.map((c, i) => {
            const startFrame = (1.2 + i * 0.8) * fps;
            const t = interpolate(frame - startFrame, [0, 20], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <div
                key={c.name}
                style={{
                  flex: 1,
                  background: COLORS.panel,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 16,
                  padding: 32,
                  opacity: t,
                  transform: `translateY(${interpolate(t, [0, 1], [16, 0])}px)`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: COLORS.accent,
                    boxShadow: GLOW,
                  }}
                />
                <div
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 26,
                    color: COLORS.text,
                    fontWeight: 600,
                  }}
                >
                  {c.name}
                </div>
                <div
                  style={{
                    fontFamily: FONTS.sans,
                    fontSize: 22,
                    color: COLORS.accent,
                  }}
                >
                  {c.role}
                </div>
                <div
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 18,
                    color: COLORS.textDim,
                  }}
                >
                  {c.detail}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <StatusBar />
      <StatusBarFooter />
    </AbsoluteFill>
  );
};

const GridBackdrop: React.FC = () => (
  <svg
    width="100%"
    height="100%"
    style={{ position: "absolute", inset: 0, opacity: 0.4 }}
  >
    <defs>
      <pattern id="grid2" width="80" height="80" patternUnits="userSpaceOnUse">
        <path
          d="M 80 0 L 0 0 0 80"
          fill="none"
          stroke={COLORS.grid}
          strokeWidth="1"
        />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid2)" />
  </svg>
);
