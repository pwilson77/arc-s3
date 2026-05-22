import React, { useEffect } from "react";

export function Modal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className="bg-neutral-950 border border-neutral-800 rounded-xl shadow-xl max-w-[1220px] w-full mx-4 relative animate-fade-in h-[82vh] md:h-[760px] overflow-hidden flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-neutral-400 hover:text-neutral-200 text-xl font-mono"
          aria-label="Close"
        >
          ×
        </button>
        <div className="overflow-y-auto h-full">{children}</div>
      </div>
    </div>
  );
}
