import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONTS, GLOW } from "../theme";
import { StatusBar, StatusBarFooter } from "../components/StatusBar";

export const DashboardSnapshot: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{ backgroundColor: COLORS.bg, padding: "120px 80px 100px" }}
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
          operator view
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
          one live view · zero off-chain trust
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 18,
          }}
        >
          <Kpi
            label="registered agents"
            value={animatedInt(frame, fps, 0, 12, 0, 1.5)}
            delay={0}
            t={t}
          />
          <Kpi
            label="settled tasks (24h)"
            value={animatedInt(frame, fps, 0, 487, 0.4, 2.0)}
            delay={0.4}
            t={t}
          />
          <Kpi
            label="bonded USDC"
            value={animatedInt(frame, fps, 0, 9842, 0.8, 2.0)}
            delay={0.8}
            t={t}
            unit="USDC"
          />
          <Kpi
            label="slash rate"
            value={animatedInt(frame, fps, 0, 2.1, 1.2, 2.0)}
            delay={1.2}
            t={t}
            unit="%"
            decimals={1}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr",
            gap: 18,
            marginTop: 18,
          }}
        >
          <Panel title="registered agents · arc-testnet" delay={1.6} t={t}>
            <AgentRow
              name="rfb5-sports-arb"
              id="0x7a…3e2"
              score="0.94"
              state="settled"
              t={t}
              delay={1.8}
            />
            <AgentRow
              name="rfb6-copytrade"
              id="0xc1…9f4"
              score="0.88"
              state="settled"
              t={t}
              delay={2.0}
            />
            <AgentRow
              name="alpha-mm"
              id="0x48…b71"
              score="0.81"
              state="settled"
              t={t}
              delay={2.2}
            />
            <AgentRow
              name="beta-yield"
              id="0x9d…2a8"
              score="0.72"
              state="settled"
              t={t}
              delay={2.4}
            />
            <AgentRow
              name="gamma-prediction"
              id="0xe2…05c"
              score="0.04"
              state="slashed"
              t={t}
              delay={2.6}
            />
          </Panel>

          <Panel title="integrity incidents · 24h" delay={2.0} t={t}>
            <IncidentRow
              time="14:22"
              text="gamma-prediction · bond slashed · 2.50 USDC"
              t={t}
              delay={2.2}
            />
            <IncidentRow
              time="13:58"
              text="rfb5 · skip · daily cap reached"
              t={t}
              delay={2.4}
              muted
            />
            <IncidentRow
              time="13:41"
              text="alpha-mm · settled · task #884"
              t={t}
              delay={2.6}
              muted
            />
            <IncidentRow
              time="13:30"
              text="firewall · permit rejected · expired deadline"
              t={t}
              delay={2.8}
            />
          </Panel>
        </div>
      </div>
      <StatusBar />
      <StatusBarFooter />
    </AbsoluteFill>
  );
};

function animatedInt(
  frame: number,
  fps: number,
  from: number,
  to: number,
  delaySec: number,
  durSec: number,
): number {
  const v = interpolate(
    frame,
    [delaySec * fps, (delaySec + durSec) * fps],
    [from, to],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  return v;
}

const Kpi: React.FC<{
  label: string;
  value: number;
  delay: number;
  t: number;
  unit?: string;
  decimals?: number;
}> = ({ label, value, delay, unit, decimals = 0 }) => {
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: "22px 26px",
      }}
    >
      <div
        style={{
          fontFamily: FONTS.sans,
          color: COLORS.textDim,
          fontSize: 16,
          marginBottom: 8,
          letterSpacing: 1.5,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: FONTS.mono,
          color: COLORS.text,
          fontSize: 48,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {value.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}
        {unit ? (
          <span style={{ color: COLORS.textDim, fontSize: 20, marginLeft: 8 }}>
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
};

const Panel: React.FC<{
  title: string;
  children: React.ReactNode;
  t: number;
  delay: number;
}> = ({ title, children }) => (
  <div
    style={{
      background: COLORS.panel,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 14,
      padding: 22,
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}
  >
    <div
      style={{
        fontFamily: FONTS.sans,
        color: COLORS.textDim,
        fontSize: 14,
        letterSpacing: 2,
        textTransform: "uppercase",
      }}
    >
      {title}
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {children}
    </div>
  </div>
);

const AgentRow: React.FC<{
  name: string;
  id: string;
  score: string;
  state: "settled" | "slashed";
  t: number;
  delay: number;
}> = ({ name, id, score, state }) => {
  const slashed = state === "slashed";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.4fr 1fr 100px 110px",
        alignItems: "center",
        padding: "10px 14px",
        borderRadius: 8,
        background: slashed ? "rgba(252,165,165,0.06)" : "transparent",
        fontFamily: FONTS.mono,
        fontSize: 18,
        color: COLORS.text,
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: slashed ? COLORS.bad : COLORS.accent,
            boxShadow: slashed ? "none" : GLOW,
          }}
        />
        {name}
      </div>
      <div style={{ color: COLORS.textDim }}>{id}</div>
      <div>{score}</div>
      <div
        style={{
          color: slashed ? COLORS.bad : COLORS.good,
          fontSize: 14,
          letterSpacing: 2,
          textTransform: "uppercase",
        }}
      >
        {state}
      </div>
    </div>
  );
};

const IncidentRow: React.FC<{
  time: string;
  text: string;
  t: number;
  delay: number;
  muted?: boolean;
}> = ({ time, text, muted }) => (
  <div
    style={{
      display: "flex",
      gap: 16,
      padding: "8px 12px",
      fontFamily: FONTS.mono,
      fontSize: 17,
      color: muted ? COLORS.textDim : COLORS.text,
    }}
  >
    <span style={{ color: COLORS.textDim, minWidth: 56 }}>{time}</span>
    <span>{text}</span>
  </div>
);

const GridBackdrop: React.FC = () => (
  <svg
    width="100%"
    height="100%"
    style={{ position: "absolute", inset: 0, opacity: 0.3 }}
  >
    <defs>
      <pattern id="grid6" width="80" height="80" patternUnits="userSpaceOnUse">
        <path
          d="M 80 0 L 0 0 0 80"
          fill="none"
          stroke={COLORS.grid}
          strokeWidth="1"
        />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid6)" />
  </svg>
);
