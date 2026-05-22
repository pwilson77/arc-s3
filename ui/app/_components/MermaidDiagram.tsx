"use client";

import { useEffect, useMemo, useState } from "react";

export function MermaidDiagram({
  chart,
  className,
}: {
  chart: string;
  className?: string;
}) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  const id = useMemo(
    () => `mermaid-${Math.random().toString(36).slice(2, 10)}`,
    [],
  );

  useEffect(() => {
    let isMounted = true;

    async function render() {
      try {
        const mermaid = (await import("mermaid/dist/mermaid.esm.mjs")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
        });

        const { svg: renderedSvg } = await mermaid.render(id, chart);
        if (!isMounted) return;

        setSvg(renderedSvg);
        setError("");
      } catch (err) {
        if (!isMounted) return;
        setError(
          err instanceof Error ? err.message : "Failed to render diagram",
        );
      }
    }

    void render();

    return () => {
      isMounted = false;
    };
  }, [chart, id]);

  if (error) {
    return (
      <div className={className}>
        <div className="text-xs text-rose-300 mb-2">
          Failed to render Mermaid diagram
        </div>
        <pre className="text-xs text-neutral-300 bg-neutral-950 border border-neutral-800 rounded p-3 overflow-x-auto">
          {chart}
        </pre>
        <div className="text-[11px] text-neutral-500 mt-2 font-mono">
          {error}
        </div>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className={className}>
        <div className="text-xs text-neutral-500 font-mono">
          rendering diagram…
        </div>
      </div>
    );
  }

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-label="Mermaid diagram"
    />
  );
}
