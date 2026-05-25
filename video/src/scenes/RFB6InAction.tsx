import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONTS, GLOW } from "../theme";
import { StatusBar, StatusBarFooter } from "../components/StatusBar";

type Worker = {
  rank: number;
  name: string;
  score: number;
  allocation: number;
  state: "settled" | "slashed" | "fresh";
};

const WORKERS: Worker[] = [
  {
    rank: 1,
    name: "rfb5-sports-arb",
    score: 0.94,
    allocation: 42,
    state: "settled",
  },
  { rank: 2, name: "alpha-mm", score: 0.81, allocation: 28, state: "settled" },
  {
    rank: 3,
    name: "beta-yield",
    score: 0.72,
    allocation: 18,
    state: "settled",
  },
  {
    rank: 4,
    name: "delta-funding",
    score: 0.61,
    allocation: 12,
    state: "fresh",
  },
  {
    rank: 5,
    name: "gamma-prediction",
    score: 0.04,
    allocation: 0,
    state: "slashed",
  },
];

export const RFB6InAction: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{ backgroundColor: COLORS.bg, padding: "120px 100px 100px" }}
    >
      <GridBackdrop />
      <div style={{ position: "relative" }}>
        <div
          style={{
            fontFamily: FONTS.mono,
            color: COLORS.accent,
            fontSize: 16,
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
        >
          agent: rfb6
        </div>
        <div
          style={{
            fontFamily: FONTS.sans,
            color: COLORS.text,
            fontSize: 42,
            fontWeight: 700,
            marginTop: 6,
            marginBottom: 28,
          }}
        >
          copytrade allocator · routes capital to the best
        </div>

        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "80px 1fr 200px 200px 220px",
              padding: "20px 32px",
              borderBottom: `1px solid ${COLORS.border}`,
              fontFamily: FONTS.mono,
              fontSize: 16,
              color: COLORS.textDim,
              textTransform: "uppercase",
              letterSpacing: 2,
            }}
          >
            <div>#</div>
            <div>worker</div>
            <div>rep score</div>
            <div>state</div>
            <div>allocation</div>
          </div>
          {WORKERS.map((w, i) => {
            const startFrame = (0.5 + i * 0.6) * fps;
            const t = interpolate(frame - startFrame, [0, 20], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const opacity = t;
            const dy = interpolate(t, [0, 1], [8, 0]);
            const pct = interpolate(
              frame - startFrame - 10,
              [0, 25],
              [0, w.allocation],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              },
            );
            const stateColor =
              w.state === "settled"
                ? COLORS.good
                : w.state === "slashed"
                  ? COLORS.bad
                  : COLORS.textDim;
            return (
              <div
                key={w.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "80px 1fr 200px 200px 220px",
                  alignItems: "center",
                  padding: "22px 32px",
                  borderBottom:
                    i < WORKERS.length - 1
                      ? `1px solid ${COLORS.border}`
                      : "none",
                  opacity,
                  transform: `translateY(${dy}px)`,
                  fontFamily: FONTS.mono,
                  fontSize: 22,
                  color: COLORS.text,
                  background:
                    w.state === "slashed"
                      ? "rgba(252,165,165,0.04)"
                      : "transparent",
                }}
              >
                <div style={{ color: COLORS.textDim }}>{w.rank}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background:
                        w.state === "slashed" ? COLORS.bad : COLORS.accent,
                      boxShadow: w.state === "slashed" ? "none" : GLOW,
                    }}
                  />
                  {w.name}
                </div>
                <div>{w.score.toFixed(2)}</div>
                <div
                  style={{
                    color: stateColor,
                    textTransform: "uppercase",
                    fontSize: 16,
                    letterSpacing: 2,
                  }}
                >
                  {w.state}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 8,
                      background: COLORS.border,
                      borderRadius: 999,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${(pct / 50) * 100}%`,
                        height: "100%",
                        background:
                          w.state === "slashed" ? COLORS.bad : COLORS.accent,
                        boxShadow: w.state === "slashed" ? "none" : GLOW,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      color: w.state === "slashed" ? COLORS.bad : COLORS.text,
                      fontSize: 18,
                      width: 48,
                      textAlign: "right",
                    }}
                  >
                    {pct.toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 24 }}>
          <Tag>ranked from S3ReputationRegistry</Tag>
          <Tag>rebalances every epoch</Tag>
          <Tag accent>slashed → 0% allocation</Tag>
        </div>
      </div>
      <StatusBar />
      <StatusBarFooter label="rfb6 · allocator · arc-testnet" />
    </AbsoluteFill>
  );
};

const Tag: React.FC<{ children: React.ReactNode; accent?: boolean }> = ({
  children,
  accent,
}) => (
  <span
    style={{
      padding: "8px 16px",
      borderRadius: 999,
      border: `1px solid ${accent ? COLORS.accentMuted : COLORS.border}`,
      color: accent ? COLORS.accent : COLORS.textDim,
      fontFamily: FONTS.mono,
      fontSize: 16,
      background: accent ? "rgba(252,211,77,0.05)" : "transparent",
    }}
  >
    {children}
  </span>
);

const GridBackdrop: React.FC = () => (
  <svg
    width="100%"
    height="100%"
    style={{ position: "absolute", inset: 0, opacity: 0.3 }}
  >
    <defs>
      <pattern id="grid5" width="80" height="80" patternUnits="userSpaceOnUse">
        <path
          d="M 80 0 L 0 0 0 80"
          fill="none"
          stroke={COLORS.grid}
          strokeWidth="1"
        />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid5)" />
  </svg>
);
