import React from "react";
import { COLORS, FONTS } from "../theme";
import { Brandmark } from "./Brandmark";

export const StatusBar: React.FC = () => {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 64,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 48px",
        borderBottom: `1px solid ${COLORS.border}`,
        background: "rgba(10,10,10,0.85)",
        backdropFilter: "blur(8px)",
        fontFamily: FONTS.mono,
        fontSize: 16,
        color: COLORS.textDim,
        zIndex: 50,
      }}
    >
      <Brandmark size={26} />
      <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
        <Pill dot>live</Pill>
        <span>arc-testnet</span>
        <span>chain=5042002</span>
        <span>settled in USDC</span>
      </div>
    </div>
  );
};

const Pill: React.FC<{ children: React.ReactNode; dot?: boolean }> = ({
  children,
  dot,
}) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "4px 10px",
      borderRadius: 999,
      border: `1px solid ${COLORS.border}`,
      color: COLORS.text,
      fontSize: 14,
    }}
  >
    {dot ? (
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: COLORS.accent,
          boxShadow: "0 0 6px rgba(252,211,77,0.8)",
        }}
      />
    ) : null}
    {children}
  </span>
);

export const StatusBarFooter: React.FC<{ label?: string }> = ({ label }) => {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 48px",
        borderTop: `1px solid ${COLORS.border}`,
        background: "rgba(10,10,10,0.85)",
        fontFamily: FONTS.mono,
        fontSize: 14,
        color: COLORS.textDim,
        zIndex: 50,
      }}
    >
      <span>{label ?? "accountable agents, not just picks"}</span>
      <span>arc l1 · chain 5042002 · testnet</span>
    </div>
  );
};
