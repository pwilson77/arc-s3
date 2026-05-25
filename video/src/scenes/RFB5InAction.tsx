import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONTS, GLOW } from "../theme";
import { StatusBar, StatusBarFooter } from "../components/StatusBar";

type Row = {
  at: number;
  kind: "scan" | "post" | "skip";
  text: string;
};

const ROWS: Row[] = [
  { at: 0.6, kind: "scan", text: "scan polymarket · NBA · 142 markets" },
  { at: 2.2, kind: "scan", text: "scan kalshi · NBA · 87 markets" },
  {
    at: 3.6,
    kind: "post",
    text: "post task #142 · bond 12.50 USDC · deadline 38s",
  },
  {
    at: 5.4,
    kind: "post",
    text: "post task #143 · bond 8.20 USDC · deadline 41s",
  },
  {
    at: 7.4,
    kind: "skip",
    text: "skip · daily notional cap 100.00 USDC reached",
  },
  {
    at: 9.2,
    kind: "post",
    text: "post task #144 · bond 4.75 USDC · deadline 22s",
  },
  { at: 11.0, kind: "skip", text: "skip · deadline < firewall min 30s" },
  {
    at: 12.8,
    kind: "post",
    text: "post task #145 · bond 9.10 USDC · deadline 47s",
  },
];

const CHARS_PER_SEC = 60;

export const RFB5InAction: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const posted = ROWS.filter(
    (r) =>
      r.kind === "post" &&
      frame >= (r.at + r.text.length / CHARS_PER_SEC) * fps,
  ).length;
  const skipped = ROWS.filter(
    (r) =>
      r.kind === "skip" &&
      frame >= (r.at + r.text.length / CHARS_PER_SEC) * fps,
  ).length;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        padding: "120px 80px 100px",
        display: "flex",
        gap: 40,
      }}
    >
      <GridBackdrop />
      <div
        style={{
          flex: 1.5,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          position: "relative",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONTS.mono,
              color: COLORS.accent,
              fontSize: 16,
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            agent: rfb5
          </div>
          <div
            style={{
              fontFamily: FONTS.sans,
              color: COLORS.text,
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: -0.5,
              marginTop: 6,
            }}
          >
            sports-arb worker
          </div>
        </div>
        <div
          style={{
            flex: 1,
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 14,
            padding: 28,
            fontFamily: FONTS.mono,
            fontSize: 22,
            color: COLORS.text,
            overflow: "hidden",
          }}
        >
          <div
            style={{ color: COLORS.textDim, marginBottom: 14, fontSize: 18 }}
          >
            $ rfb5 run --chain arc-testnet --cap 100 USDC
          </div>
          {ROWS.map((r, i) => {
            const startFrame = r.at * fps;
            if (frame < startFrame) return null;
            const elapsed = (frame - startFrame) / fps;
            const visibleChars = Math.min(
              r.text.length,
              Math.floor(elapsed * CHARS_PER_SEC),
            );
            const color =
              r.kind === "skip"
                ? COLORS.bad
                : r.kind === "post"
                  ? COLORS.good
                  : COLORS.textDim;
            const glyph =
              r.kind === "skip" ? "⊘" : r.kind === "post" ? "✓" : "›";
            return (
              <div
                key={i}
                style={{ marginBottom: 8, whiteSpace: "pre", lineHeight: 1.4 }}
              >
                <span style={{ color, marginRight: 10 }}>{glyph}</span>
                <span>{r.text.slice(0, visibleChars)}</span>
                {visibleChars < r.text.length ? <Caret /> : null}
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          position: "relative",
          paddingTop: 84,
        }}
      >
        <KpiTile label="posted today" value={posted} accent />
        <KpiTile label="skipped" value={skipped} />
        <SpendBar frame={frame} fps={fps} />
        <div
          style={{
            fontFamily: FONTS.mono,
            color: COLORS.textDim,
            fontSize: 16,
            paddingLeft: 4,
            marginTop: 8,
          }}
        >
          every decision signed · on-chain · replayable
        </div>
      </div>
      <StatusBar />
      <StatusBarFooter label="rfb5 · arc-testnet · daily cap 100 USDC" />
    </AbsoluteFill>
  );
};

const Caret: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <span style={{ opacity: frame % 30 < 15 ? 1 : 0, color: COLORS.accent }}>
      ▌
    </span>
  );
};

const KpiTile: React.FC<{ label: string; value: number; accent?: boolean }> = ({
  label,
  value,
  accent,
}) => (
  <div
    style={{
      background: COLORS.panel,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 14,
      padding: "22px 28px",
    }}
  >
    <div
      style={{
        fontFamily: FONTS.sans,
        color: COLORS.textDim,
        fontSize: 18,
        marginBottom: 6,
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontFamily: FONTS.mono,
        color: accent ? COLORS.accent : COLORS.text,
        fontSize: 64,
        fontWeight: 700,
        lineHeight: 1,
        textShadow: accent ? GLOW : "none",
      }}
    >
      {value}
    </div>
  </div>
);

const SpendBar: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const target = 86.25;
  const cap = 100;
  const spent = interpolate(frame, [0, 14 * fps], [0, target], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pct = Math.min(1, spent / cap);
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: "22px 28px",
      }}
    >
      <div
        style={{
          fontFamily: FONTS.sans,
          color: COLORS.textDim,
          fontSize: 18,
          marginBottom: 10,
        }}
      >
        bonded today (USDC)
      </div>
      <div
        style={{
          fontFamily: FONTS.mono,
          color: COLORS.text,
          fontSize: 44,
          fontWeight: 700,
          marginBottom: 14,
        }}
      >
        {spent.toFixed(2)}{" "}
        <span style={{ color: COLORS.textDim, fontSize: 24 }}>
          / {cap.toFixed(0)}
        </span>
      </div>
      <div
        style={{
          height: 10,
          background: COLORS.border,
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct * 100}%`,
            height: "100%",
            background: COLORS.accent,
            boxShadow: GLOW,
          }}
        />
      </div>
    </div>
  );
};

const GridBackdrop: React.FC = () => (
  <svg
    width="100%"
    height="100%"
    style={{ position: "absolute", inset: 0, opacity: 0.3 }}
  >
    <defs>
      <pattern id="grid4" width="80" height="80" patternUnits="userSpaceOnUse">
        <path
          d="M 80 0 L 0 0 0 80"
          fill="none"
          stroke={COLORS.grid}
          strokeWidth="1"
        />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid4)" />
  </svg>
);
