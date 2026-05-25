import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { COLORS, FONTS, GLOW } from "../theme";
import { StatusBar, StatusBarFooter } from "../components/StatusBar";

type Node = { id: string; label: string; sub: string; x: number; y: number };

const NODE_W = 320;
const NODE_H = 110;
const ROW_Y = 540;

const NODES: Node[] = [
  { id: "agent", label: "Agent", sub: "ERC-8004 identity", x: 180, y: ROW_Y },
  {
    id: "firewall",
    label: "Intent Firewall",
    sub: "permit check",
    x: 640,
    y: ROW_Y,
  },
  {
    id: "court",
    label: "Escrow Courthouse",
    sub: "bond + settle",
    x: 1100,
    y: ROW_Y,
  },
  {
    id: "rep",
    label: "Reputation Registry",
    sub: "EWMA score",
    x: 1560,
    y: ROW_Y,
  },
];

export const Architecture: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <GridBackdrop />
      <div
        style={{
          fontFamily: FONTS.mono,
          color: COLORS.accent,
          fontSize: 18,
          letterSpacing: 3,
          textTransform: "uppercase",
          padding: "120px 0 0 140px",
          opacity: interpolate(frame, [0, 20], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Lifecycle
      </div>
      <div
        style={{
          fontFamily: FONTS.sans,
          color: COLORS.text,
          fontSize: 56,
          fontWeight: 700,
          padding: "12px 0 0 140px",
          letterSpacing: -1,
          opacity: interpolate(frame, [10, 30], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Every task is bonded, settled, scored.
      </div>

      <svg
        width="1920"
        height="1080"
        style={{ position: "absolute", inset: 0 }}
      >
        {NODES.slice(0, -1).map((n, i) => {
          const next = NODES[i + 1];
          const x1 = n.x + NODE_W;
          const x2 = next.x;
          const y = n.y + NODE_H / 2;
          const startSec = 2 + i * 1.6;
          const t = interpolate(
            frame,
            [startSec * fps, (startSec + 1.0) * fps],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          );
          const len = x2 - x1;
          return (
            <g key={n.id}>
              <line
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke={COLORS.border}
                strokeWidth={2}
              />
              <line
                x1={x1}
                y1={y}
                x2={x1 + len * t}
                y2={y}
                stroke={COLORS.accent}
                strokeWidth={2}
              />
              <polygon
                points={`${x1 + len * t - 12},${y - 7} ${x1 + len * t},${y} ${x1 + len * t - 12},${y + 7}`}
                fill={COLORS.accent}
                opacity={t}
              />
            </g>
          );
        })}

        {NODES.map((n, i) => {
          const startFrame = i * 1.6 * fps;
          const t = interpolate(frame - startFrame, [0, 22], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const opacity = t;
          const dy = interpolate(t, [0, 1], [12, 0]);
          return (
            <g
              key={n.id}
              transform={`translate(${n.x}, ${n.y + dy})`}
              opacity={opacity}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={14}
                fill={COLORS.panel}
                stroke={COLORS.accent}
                strokeOpacity={0.4}
                strokeWidth={1.5}
              />
              <circle
                cx={22}
                cy={28}
                r={5}
                fill={COLORS.accent}
                style={{ filter: `drop-shadow(${GLOW})` }}
              />
              <text
                x={42}
                y={36}
                fill={COLORS.text}
                fontFamily={FONTS.sans}
                fontSize={26}
                fontWeight={700}
              >
                {n.label}
              </text>
              <text
                x={42}
                y={72}
                fill={COLORS.textDim}
                fontFamily={FONTS.mono}
                fontSize={18}
              >
                {n.sub}
              </text>
            </g>
          );
        })}
      </svg>

      <div
        style={{
          position: "absolute",
          bottom: 180,
          left: 140,
          right: 140,
          display: "flex",
          gap: 18,
          opacity: interpolate(frame, [6 * fps, 8 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {[
          "bind identity",
          "stake USYC",
          "post bonded task",
          "settle or slash",
        ].map((s) => (
          <div
            key={s}
            style={{
              padding: "10px 20px",
              borderRadius: 999,
              border: `1px solid ${COLORS.border}`,
              color: COLORS.text,
              fontFamily: FONTS.mono,
              fontSize: 18,
              background: COLORS.panel,
            }}
          >
            {s}
          </div>
        ))}
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
    style={{ position: "absolute", inset: 0, opacity: 0.35 }}
  >
    <defs>
      <pattern id="grid3" width="80" height="80" patternUnits="userSpaceOnUse">
        <path
          d="M 80 0 L 0 0 0 80"
          fill="none"
          stroke={COLORS.grid}
          strokeWidth="1"
        />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid3)" />
  </svg>
);
