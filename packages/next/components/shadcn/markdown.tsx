// author: Claude
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a GFM markdown string (headings, tables, lists, code) styled with the
 * app's semantic tokens. Used for run summary reports, which are emitted as
 * markdown with tables — `remark-gfm` is required for those to render as tables
 * rather than literal pipes.
 */

// react-markdown@9 passes a `node` prop that must not reach the DOM element;
// each renderer drops it and forwards the rest so GFM attributes (e.g. table
// cell alignment) are preserved.
const components: Components = {
  h1: ({ node: _node, ...p }) => (
    <h1 className="text-foreground mt-3 mb-1 text-base font-semibold" {...p} />
  ),
  h2: ({ node: _node, ...p }) => (
    <h2 className="text-foreground mt-3 mb-1 text-sm font-semibold" {...p} />
  ),
  h3: ({ node: _node, ...p }) => (
    <h3 className="text-foreground mt-2 mb-1 text-xs font-semibold" {...p} />
  ),
  p: ({ node: _node, ...p }) => <p className="my-1.5 leading-relaxed" {...p} />,
  ul: ({ node: _node, ...p }) => <ul className="my-1.5 list-disc pl-5" {...p} />,
  ol: ({ node: _node, ...p }) => <ol className="my-1.5 list-decimal pl-5" {...p} />,
  li: ({ node: _node, ...p }) => <li className="my-0.5" {...p} />,
  strong: ({ node: _node, ...p }) => <strong className="text-foreground font-semibold" {...p} />,
  a: ({ node: _node, ...p }) => (
    <a className="text-primary underline" target="_blank" rel="noreferrer" {...p} />
  ),
  hr: ({ node: _node, ...p }) => <hr className="border-border my-3" {...p} />,
  code: ({ node: _node, ...p }) => (
    <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]" {...p} />
  ),
  table: ({ node: _node, ...p }) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-border w-full border-collapse border text-xs" {...p} />
    </div>
  ),
  th: ({ node: _node, ...p }) => (
    <th className="border-border bg-muted border px-2 py-1 text-left font-medium" {...p} />
  ),
  td: ({ node: _node, ...p }) => (
    <td className="border-border border px-2 py-1" {...p} />
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
