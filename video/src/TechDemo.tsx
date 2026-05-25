import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Img,
} from "remotion";
import { COLORS, FONTS } from "./theme";

export const TECH_DEMO_FPS = 30;
export const TECH_DEMO_WIDTH = 3840;
export const TECH_DEMO_HEIGHT = 2160;
const SCALE = 2;

const SCENE_SECONDS = {
  intro: 83,
  demoClean: 58,
  uiWalkthrough: 82,
  outro: 12,
};

const s = (sec: number) => Math.round(sec * TECH_DEMO_FPS);

export const TECH_DEMO_DURATION_FRAMES = s(
  SCENE_SECONDS.intro +
    SCENE_SECONDS.demoClean +
    SCENE_SECONDS.uiWalkthrough +
    SCENE_SECONDS.outro,
);

const vo = (id: string) => staticFile(`vo/${id}.mp3`);

const INTRO_VO_TIMELINE = [
  { id: "tech-1-paradigm", at: 0 },
  { id: "tech-2-usecase", at: 16 },
  { id: "tech-3-zero-member-llc", at: 34 },
  { id: "tech-4-firewall", at: 50 },
  { id: "tech-5-escrow", at: 61 },
  { id: "tech-6-reputation", at: 72 },
] as const;

export const TechDemo: React.FC = () => {
  let start = 0;
  const introDur = s(SCENE_SECONDS.intro);

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <Sequence from={start} durationInFrames={introDur}>
        <IntroSlide />
        {INTRO_VO_TIMELINE.map((v) => (
          <Sequence key={v.id} from={s(v.at)}>
            <Audio src={vo(v.id)} />
          </Sequence>
        ))}
      </Sequence>
      {(() => {
        start += introDur;
        return null;
      })()}

      <Sequence from={start} durationInFrames={s(SCENE_SECONDS.demoClean)}>
        <CaptureScene
          title="Live Run"
          subtitle="npm run demo:clean"
          badge="Terminal Capture"
          frameDir="captures/terminal-frames"
        />
        <Audio src={vo("tech-7-demo-clean")} />
      </Sequence>
      {(() => {
        start += s(SCENE_SECONDS.demoClean);
        return null;
      })()}

      <Sequence from={start} durationInFrames={s(SCENE_SECONDS.uiWalkthrough)}>
        <CaptureScene
          title="Post-Render UI Evidence"
          subtitle="network -> traces -> dashboard"
          badge="UI Walkthrough"
          frameDir="captures/ui-frames"
        />
        <Audio src={vo("tech-8-ui-walkthrough")} />
      </Sequence>
      {(() => {
        start += s(SCENE_SECONDS.uiWalkthrough);
        return null;
      })()}

      <Sequence from={start} durationInFrames={s(SCENE_SECONDS.outro)}>
        <OutroSlide />
        <Audio src={vo("tech-9-outro")} />
      </Sequence>
    </AbsoluteFill>
  );
};

const PHASE = {
  hero: [0, 16],
  usecase: [16, 34],
  substrate: [34, 50],
  firewall: [50, 61],
  escrow: [61, 72],
  reputation: [72, 83],
} as const;

const IntroSlide: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const heroIn = spring({ frame, fps, config: { damping: 200, stiffness: 80 } });
  const heroOut = interpolate(t, [PHASE.hero[1] - 1.5, PHASE.hero[1]], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const heroOpacity = heroIn * heroOut;

  const usecaseProgress = interpolate(
    t,
    [PHASE.usecase[0], PHASE.usecase[0] + 0.8],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const usecaseOut = interpolate(
    t,
    [PHASE.usecase[1] - 1.5, PHASE.usecase[1]],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const payloadProgress = interpolate(
    t,
    [PHASE.usecase[0] + 3, PHASE.usecase[0] + 10],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const substrateIn = interpolate(
    t,
    [PHASE.substrate[0], PHASE.substrate[0] + 1],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(120% 120% at 18% 12%, #1c1c1c 0%, #0a0a0a 50%, #060606 100%)",
        overflow: "hidden",
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: `${120 * SCALE}px ${120 * SCALE}px`,
          opacity: 0.6,
          maskImage:
            "radial-gradient(circle at 50% 50%, black 35%, transparent 80%)",
        }}
      />

      <BrandStrip />

      {t < PHASE.hero[1] && <Hero opacity={heroOpacity} />}

      {t >= PHASE.usecase[0] && t < PHASE.substrate[0] && (
        <UsecaseStage
          inProg={usecaseProgress}
          outProg={usecaseOut}
          payload={payloadProgress}
        />
      )}

      {t >= PHASE.substrate[0] && (
        <SubstrateStage tSeconds={t} progress={substrateIn} />
      )}
    </AbsoluteFill>
  );
};

const BrandStrip: React.FC = () => (
  <div
    style={{
      position: "absolute",
      top: 40 * SCALE,
      left: 60 * SCALE,
      right: 60 * SCALE,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontFamily: FONTS.mono,
      color: COLORS.accent,
      letterSpacing: 4 * SCALE,
      fontSize: 14 * SCALE,
      textTransform: "uppercase",
      opacity: 0.85,
    }}
  >
    <span>Arc S3 — Tech Demo</span>
    <span style={{ color: COLORS.text, opacity: 0.6 }}>
      Evidence-Based Agent Settlement
    </span>
  </div>
);

const Hero: React.FC<{ opacity: number }> = ({ opacity }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleY = interpolate(
    spring({ frame, fps, config: { damping: 200, stiffness: 90 } }),
    [0, 1],
    [40 * SCALE, 0],
  );
  const tagFade = interpolate(frame, [18, 36], [0, 1], {
    extrapolateRight: "clamp",
  });
  const subFade = interpolate(frame, [60, 90], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        opacity,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        textAlign: "center",
        padding: `${120 * SCALE}px ${160 * SCALE}px`,
      }}
    >
      <div
        style={{
          fontFamily: FONTS.mono,
          color: COLORS.accent,
          letterSpacing: 6 * SCALE,
          fontSize: 22 * SCALE,
          textTransform: "uppercase",
          opacity: tagFade,
          marginBottom: 28 * SCALE,
        }}
      >
        Re-Evaluating the Agent Economy
      </div>
      <div
        style={{
          fontFamily: FONTS.sans,
          fontWeight: 800,
          fontSize: 140 * SCALE,
          color: COLORS.text,
          lineHeight: 1.02,
          letterSpacing: -2,
          transform: `translateY(${titleY}px)`,
          background:
            "linear-gradient(180deg, #ffffff 0%, #cfcfcf 60%, #8c8c8c 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        Arc S3
      </div>
      <div
        style={{
          fontFamily: FONTS.sans,
          fontWeight: 500,
          fontSize: 40 * SCALE,
          color: COLORS.text,
          opacity: subFade * 0.92,
          marginTop: 40 * SCALE,
          maxWidth: 1700 * SCALE,
        }}
      >
        A paradigm shift for the agent economy — not just infra,
        <br />
        enforceable software coordination.
      </div>
    </AbsoluteFill>
  );
};

const UsecaseStage: React.FC<{
  inProg: number;
  outProg: number;
  payload: number;
}> = ({ inProg, outProg, payload }) => {
  const opacity = inProg * outProg;
  const slide = interpolate(inProg, [0, 1], [60 * SCALE, 0]);
  return (
    <AbsoluteFill
      style={{
        opacity,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: `${160 * SCALE}px ${120 * SCALE}px`,
      }}
    >
      <div
        style={{
          fontFamily: FONTS.mono,
          color: COLORS.accent,
          letterSpacing: 5 * SCALE,
          fontSize: 20 * SCALE,
          textTransform: "uppercase",
          marginBottom: 36 * SCALE,
          transform: `translateY(${slide}px)`,
        }}
      >
        Trustless Agent-to-Agent Collaboration
      </div>
      <div
        style={{
          fontFamily: FONTS.sans,
          fontWeight: 700,
          fontSize: 86 * SCALE,
          color: COLORS.text,
          textAlign: "center",
          marginBottom: 80 * SCALE,
          transform: `translateY(${slide}px)`,
        }}
      >
        Agent A buys payloads from Agent B
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 80 * SCALE,
          width: "100%",
          maxWidth: 2800 * SCALE,
        }}
      >
        <AgentNode label="Agent A" sub="Buyer" />
        <ArrowChannel progress={payload} />
        <AgentNode label="Agent B" sub="Seller" />
      </div>

      <div
        style={{
          fontFamily: FONTS.sans,
          fontWeight: 500,
          fontSize: 32 * SCALE,
          color: COLORS.text,
          opacity: 0.7,
          marginTop: 80 * SCALE,
          textAlign: "center",
          maxWidth: 1900 * SCALE,
        }}
      >
        Without settlement guarantees, every failure directly burns capital.
      </div>
    </AbsoluteFill>
  );
};

const AgentNode: React.FC<{ label: string; sub: string }> = ({ label, sub }) => (
  <div
    style={{
      width: 480 * SCALE,
      padding: `${40 * SCALE}px ${30 * SCALE}px`,
      border: `2px solid ${COLORS.border}`,
      borderRadius: 24 * SCALE,
      background: "rgba(15,15,15,0.85)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 14 * SCALE,
      boxShadow: `0 ${12 * SCALE}px ${48 * SCALE}px rgba(0,0,0,0.6)`,
    }}
  >
    <div
      style={{
        width: 100 * SCALE,
        height: 100 * SCALE,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${COLORS.accent} 0%, #2a2a2a 80%)`,
        boxShadow: `0 0 ${30 * SCALE}px ${COLORS.accent}55`,
      }}
    />
    <div
      style={{
        fontFamily: FONTS.sans,
        fontWeight: 700,
        fontSize: 54 * SCALE,
        color: COLORS.text,
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontFamily: FONTS.mono,
        color: COLORS.accent,
        letterSpacing: 3 * SCALE,
        fontSize: 18 * SCALE,
        textTransform: "uppercase",
      }}
    >
      {sub}
    </div>
  </div>
);

const ArrowChannel: React.FC<{ progress: number }> = ({ progress }) => (
  <div
    style={{
      flex: 1,
      height: 12 * SCALE,
      position: "relative",
      borderRadius: 6 * SCALE,
      background: "rgba(255,255,255,0.08)",
    }}
  >
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        height: "100%",
        width: `${progress * 100}%`,
        background: `linear-gradient(90deg, ${COLORS.accent}, #ffffff)`,
        borderRadius: 6 * SCALE,
        boxShadow: `0 0 ${24 * SCALE}px ${COLORS.accent}aa`,
      }}
    />
    <div
      style={{
        position: "absolute",
        top: -34 * SCALE,
        left: `calc(${progress * 100}% - ${40 * SCALE}px)`,
        width: 80 * SCALE,
        height: 80 * SCALE,
        borderRadius: 16 * SCALE,
        background: "#0a0a0a",
        border: `2px solid ${COLORS.accent}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONTS.mono,
        fontSize: 22 * SCALE,
        color: COLORS.accent,
        boxShadow: `0 0 ${24 * SCALE}px ${COLORS.accent}aa`,
      }}
    >
      $$
    </div>
  </div>
);

const PILLARS = [
  {
    key: "firewall",
    title: "Intent Firewall",
    detail: "Blocks catastrophic parameters & slippage pre-trade.",
    revealAt: PHASE.firewall[0],
  },
  {
    key: "escrow",
    title: "Slash-Bonded Escrow",
    detail: "Bonds locked; bad actors slashed automatically.",
    revealAt: PHASE.escrow[0],
  },
  {
    key: "reputation",
    title: "Reputation Registry",
    detail: "Time-weighted outcomes build institutional trust.",
    revealAt: PHASE.reputation[0],
  },
] as const;

const SubstrateStage: React.FC<{ tSeconds: number; progress: number }> = ({
  tSeconds,
  progress,
}) => {
  const headerSlide = interpolate(progress, [0, 1], [40 * SCALE, 0]);
  return (
    <AbsoluteFill
      style={{
        opacity: progress,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: `${180 * SCALE}px ${120 * SCALE}px`,
      }}
    >
      <div
        style={{
          fontFamily: FONTS.mono,
          color: COLORS.accent,
          letterSpacing: 5 * SCALE,
          fontSize: 20 * SCALE,
          textTransform: "uppercase",
          marginBottom: 28 * SCALE,
          transform: `translateY(${headerSlide}px)`,
        }}
      >
        Zero-Member LLC Mechanics
      </div>
      <div
        style={{
          fontFamily: FONTS.sans,
          fontWeight: 700,
          fontSize: 84 * SCALE,
          color: COLORS.text,
          textAlign: "center",
          marginBottom: 24 * SCALE,
          transform: `translateY(${headerSlide}px)`,
        }}
      >
        On-Chain Legal Substrate
      </div>
      <div
        style={{
          fontFamily: FONTS.sans,
          fontWeight: 500,
          fontSize: 32 * SCALE,
          color: COLORS.text,
          opacity: 0.7,
          marginBottom: 90 * SCALE,
          textAlign: "center",
          maxWidth: 2200 * SCALE,
        }}
      >
        Firewall + Courthouse + Registry as programmable governance —
        backed by Arc finality and USDC gas.
      </div>

      <div
        style={{
          display: "flex",
          gap: 60 * SCALE,
          justifyContent: "center",
          width: "100%",
          maxWidth: 3200 * SCALE,
        }}
      >
        {PILLARS.map((p) => (
          <Pillar
            key={p.key}
            title={p.title}
            detail={p.detail}
            revealAt={p.revealAt}
            tSeconds={tSeconds}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Pillar: React.FC<{
  title: string;
  detail: string;
  revealAt: number;
  tSeconds: number;
}> = ({ title, detail, revealAt, tSeconds }) => {
  const reveal = interpolate(
    tSeconds,
    [revealAt, revealAt + 1.2],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const lift = interpolate(reveal, [0, 1], [60 * SCALE, 0]);
  const glowHex = Math.round(reveal * 128)
    .toString(16)
    .padStart(2, "0");

  return (
    <div
      style={{
        flex: 1,
        padding: `${48 * SCALE}px ${40 * SCALE}px`,
        border: `2px solid ${reveal > 0.5 ? COLORS.accent : COLORS.border}`,
        borderRadius: 24 * SCALE,
        background: "rgba(14,14,14,0.92)",
        opacity: 0.25 + reveal * 0.75,
        transform: `translateY(${lift}px)`,
        boxShadow:
          reveal > 0
            ? `0 0 ${40 * SCALE}px ${COLORS.accent}${glowHex}`
            : "none",
        display: "flex",
        flexDirection: "column",
        gap: 22 * SCALE,
      }}
    >
      <div
        style={{
          fontFamily: FONTS.mono,
          color: COLORS.accent,
          letterSpacing: 3 * SCALE,
          fontSize: 18 * SCALE,
          textTransform: "uppercase",
        }}
      >
        Pillar
      </div>
      <div
        style={{
          fontFamily: FONTS.sans,
          fontWeight: 700,
          fontSize: 56 * SCALE,
          color: COLORS.text,
          lineHeight: 1.1,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: FONTS.sans,
          fontWeight: 500,
          fontSize: 28 * SCALE,
          color: COLORS.text,
          opacity: 0.78,
          lineHeight: 1.3,
        }}
      >
        {detail}
      </div>
    </div>
  );
};

const OutroSlide: React.FC = () => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 18], [0, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(120% 100% at 50% 50%, #1a1a1a 0%, #060606 80%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        opacity: fade,
        padding: `${100 * SCALE}px ${160 * SCALE}px`,
      }}
    >
      <div
        style={{
          fontFamily: FONTS.mono,
          color: COLORS.accent,
          letterSpacing: 6 * SCALE,
          fontSize: 22 * SCALE,
          textTransform: "uppercase",
          marginBottom: 28 * SCALE,
        }}
      >
        Evidence-Based Agent Settlement
      </div>
      <div
        style={{
          fontFamily: FONTS.sans,
          fontWeight: 800,
          fontSize: 130 * SCALE,
          color: COLORS.text,
          textAlign: "center",
          background: "linear-gradient(180deg, #ffffff 0%, #b8b8b8 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        Arc S3 Is Live
      </div>
      <div
        style={{
          fontFamily: FONTS.sans,
          fontWeight: 500,
          fontSize: 38 * SCALE,
          color: COLORS.text,
          opacity: 0.88,
          marginTop: 40 * SCALE,
          textAlign: "center",
          maxWidth: 2000 * SCALE,
        }}
      >
        Register, stake, settle, and compound reputation on-chain.
        <br />
        Every lifecycle step is verifiable.
      </div>
    </AbsoluteFill>
  );
};

type CaptureSceneProps = {
  title: string;
  subtitle: string;
  badge: string;
  frameDir: string;
};

const CaptureScene: React.FC<CaptureSceneProps> = ({
  title,
  subtitle,
  badge,
  frameDir,
}) => {
  const frame = useCurrentFrame();
  // PNGs are 1-indexed, Remotion frames are 0-indexed
  const imgNum = String(frame + 1).padStart(5, "0");
  const imgSrc = staticFile(`${frameDir}/${imgNum}.png`);
  return (
    <AbsoluteFill style={{ backgroundColor: "#050505" }}>
      <Img
        src={imgSrc}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          opacity: 1,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 44 * SCALE,
          right: 44 * SCALE,
          bottom: 44 * SCALE,
          border: `1px solid ${COLORS.border}`,
          background: "rgba(10, 10, 10, 0.78)",
          backdropFilter: "blur(5px)",
          padding: `${20 * SCALE}px ${24 * SCALE}px`,
          borderRadius: 14 * SCALE,
          display: "flex",
          flexDirection: "column",
          gap: 8 * SCALE,
        }}
      >
        <div
          style={{
            fontFamily: FONTS.mono,
            color: COLORS.accent,
            textTransform: "uppercase",
            fontSize: 18 * SCALE,
            letterSpacing: 2 * SCALE,
          }}
        >
          {badge}
        </div>
        <div
          style={{
            fontFamily: FONTS.sans,
            fontWeight: 700,
            fontSize: 44 * SCALE,
            color: COLORS.text,
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: FONTS.sans,
            fontWeight: 500,
            fontSize: 28 * SCALE,
            color: COLORS.text,
            opacity: 0.92,
          }}
        >
          {subtitle}
        </div>
      </div>
    </AbsoluteFill>
  );
};
