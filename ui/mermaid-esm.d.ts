declare module "mermaid/dist/mermaid.esm.min.mjs" {
  const mermaid: {
    initialize: (config: Record<string, unknown>) => void;
    render: (
      id: string,
      text: string,
    ) => Promise<{
      svg: string;
      bindFunctions?: (element: Element) => void;
    }>;
  };

  export default mermaid;
}
