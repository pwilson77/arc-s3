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

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fade = (start: number, end: number) =>
    interpolate(frame, [start * fps, end * fps], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: "120px 100px 100px",
      }}
    >
      <GridBackdrop />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 32,
        }}
      >
        <div
          style={{
            opacity: fade(0, 0.6),
            transform: `scale(${interpolate(fade(0, 0.6), [0, 1], [0.95, 1])})`,
          }}
        >
          <Brandmark size={96} />
        </div>

        <div
          style={{
            fontFamily: FONTS.sans,
            color: COLORS.text,
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: -1,
            textAlign: "center",
            opacity: fade(0.4, 1.0),
          }}
        >
          live on{" "}
          <span style={{ color: COLORS.accent, textShadow: GLOW }}>
            arc testnet
          </span>
        </div>

        <div
          style={{
            fontFamily: FONTS.sans,
            color: COLORS.textDim,
            fontSize: 28,
            textAlign: "center",
            maxWidth: 1100,
            opacity: fade(0.8, 1.4),
          }}
        >
          settled in native USDC · reputation that compounds across protocols
        </div>

        <div
          style={{
            display: "flex",
            gap: 28,
            marginTop: 24,
            opacity: fade(1.4, 2.2),
          }}
        >
          <CtaCard
            kicker="agents"
            title="the courthouse is open"
            steps={[
              "register ERC-8004 identity",
              "stake USYC",
              "accept a bonded task",
            ]}
            primary
          />
          <CtaCard
            kicker="builders"
            title="the repo is open"
            steps={["clone arc-s3", "run a worker", "earn reputation"]}
          />
        </div>

        <div
          style={{
            fontFamily: FONTS.mono,
            color: COLORS.textDim,
            fontSize: 22,
            marginTop: 16,
            opacity: fade(2.0, 2.6),
          }}
        >
          github.com/pwilson77/arc-s3 · chain 5042002 · testnet
        </div>
      </div>
      <StatusBar />
      <StatusBarFooter label="come earn." />
    </AbsoluteFill>
  );
};

const CtaCard: React.FC<{
  kicker: string;
  title: string;
  steps: string[];
  primary?: boolean;
}> = ({ kicker, title, steps, primary }) => (
  <div
    style={{
      flex: 1,
      minWidth: 460,
      background: primary ? "rgba(252,211,77,0.06)" : COLORS.panel,
      border: `1px solid ${primary ? COLORS.accentMuted : COLORS.border}`,
      borderRadius: 16,
      padding: 28,
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}
  >
    <div
      style={{
        fontFamily: FONTS.mono,
        color: primary ? COLORS.accent : COLORS.textDim,
        fontSize: 16,
        letterSpacing: 3,
        textTransform: "uppercase",
      }}
    >
      {kicker}
    </div>
    <div
      style={{
        fontFamily: FONTS.sans,
        color: COLORS.text,
        fontSize: 32,
        fontWeight: 700,
        letterSpacing: -0.5,
      }}
    >
      {title}
    </div>
    <ol
      style={{
        margin: "8px 0 0",
        padding: 0,
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {steps.map((s, i) => (
        <li
          key={s}
          style={{
            fontFamily: FONTS.mono,
            color: COLORS.text,
            fontSize: 20,
            display: "flex",
            gap: 12,
          }}
        >
          <span
            style={{
              color: primary ? COLORS.accent : COLORS.textDim,
              width: 24,
            }}
          >
            {i + 1}.
          </span>
          {s}
        </li>
      ))}
    </ol>
  </div>
);

const GridBackdrop: React.FC = () => (
  <svg
    width="100%"
    height="100%"
    style={{ position: "absolute", inset: 0, opacity: 0.35 }}
  >
    <defs>
      <pattern id="grid7" width="80" height="80" patternUnits="userSpaceOnUse">
        <path
          d="M 80 0 L 0 0 0 80"
          fill="none"
          stroke={COLORS.grid}
          strokeWidth="1"
        />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid7)" />
  </svg>
);
