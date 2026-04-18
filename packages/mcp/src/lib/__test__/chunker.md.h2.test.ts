import { describe, it, expect } from "bun:test";
import { chunkMarkdown } from "../chunker.md";
import { BREADCRUMB_DELIMITER } from "../chunker.types";

const D = BREADCRUMB_DELIMITER;

// ---------------------------------------------------------------------------
// h1 + h2 splitting
// ---------------------------------------------------------------------------

describe("h1 + h2 splitting", () => {
  it("h2 under h1 produces two chunks", () => {
    const chunks = chunkMarkdown("# Parent\nbody\n## Child\nbody", "f.md");
    expect(chunks).toHaveLength(2);
  });

  it("h2 chunk has two-entry breadcrumb", () => {
    const chunks = chunkMarkdown("# Parent\nbody\n## Child\nbody", "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.breadcrumb).toEqual(["Parent", "Child"]);
  });

  it("h2 chunk content is prefixed with parent and child joined by delimiter", () => {
    const chunks = chunkMarkdown("# Parent\nbody\n## Child\nbody", "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.content.startsWith(`Parent ${D} Child`)).toBe(true);
  });

  it("h1 chunk body does not include content from its h2 children", () => {
    const chunks = chunkMarkdown("# Parent\nparent body\n## Child\nchild body", "f.md");
    const parent = chunks.find(c => c.breadcrumb.length === 1)!;
    expect(parent.breadcrumb).toEqual(["Parent"]);
    expect(parent.content).toContain("parent body");
    expect(parent.content).not.toContain("child body");
  });

  it("two sibling h2s under the same h1 both inherit the h1 breadcrumb entry", () => {
    const md = "# Parent\nbody\n## First\nbody\n## Second\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const children = chunks.filter(c => c.breadcrumb.length === 2);
    expect(children).toHaveLength(2);
    expect(children[0]!.breadcrumb).toEqual(["Parent", "First"]);
    expect(children[1]!.breadcrumb).toEqual(["Parent", "Second"]);
  });

  it("two sibling h2s body content is isolated to the correct chunk", () => {
    const md = "# Parent\n## First\nalpha\n## Second\nbeta";
    const chunks = chunkMarkdown(md, "f.md");
    const first = chunks.find(c => c.breadcrumb[1] === "First")!;
    const second = chunks.find(c => c.breadcrumb[1] === "Second")!;
    expect(first.content).toContain("alpha");
    expect(first.content).not.toContain("beta");
    expect(second.content).toContain("beta");
    expect(second.content).not.toContain("alpha");
  });

  it("new h1 resets the h2 breadcrumb entirely", () => {
    const md = "# First\n## Nested\n# Second\n## Other";
    const chunks = chunkMarkdown(md, "f.md");
    const last = chunks[chunks.length - 1]!;
    expect(last.breadcrumb).toEqual(["Second", "Other"]);
    expect(last.breadcrumb).not.toContain("First");
    expect(last.breadcrumb).not.toContain("Nested");
  });

  it("h2 after a new h1 inherits the new h1, not the previous one", () => {
    const md = "# Alpha\n## Under Alpha\n# Beta\n## Under Beta";
    const chunks = chunkMarkdown(md, "f.md");
    const underBeta = chunks.find(c => c.breadcrumb[1] === "Under Beta")!;
    expect(underBeta.breadcrumb).toEqual(["Beta", "Under Beta"]);
  });

  it("h1 with only h2 children and no direct body produces an empty-body h1 chunk", () => {
    const md = "# Parent\n## Child\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const parent = chunks.find(c => c.breadcrumb.length === 1)!;
    expect(parent.breadcrumb).toEqual(["Parent"]);
    const body = parent.content.split("\n\n").slice(1).join("").trim();
    expect(body).toBe("");
  });

  it("h2 immediately followed by another h2 has empty body on the first h2", () => {
    const md = "# Parent\n## First\n## Second\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const first = chunks.find(c => c.breadcrumb[1] === "First")!;
    expect(first.breadcrumb).toEqual(["Parent", "First"]);
    const body = first.content.split("\n\n").slice(1).join("").trim();
    expect(body).toBe("");
  });

  it("heading with identical text at h1 and h2 levels produces breadcrumb with both entries", () => {
    const chunks = chunkMarkdown("# Foo\n## Foo\nbody", "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.breadcrumb).toEqual(["Foo", "Foo"]);
  });

  it("##NoSpace is not treated as a heading", () => {
    const chunks = chunkMarkdown("# Parent\n##NoSpace\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Parent"]);
  });

  it("jumping from h4 back to h2 drops h3 and h4 from breadcrumb", () => {
    const md = "# A\n## B\n### C\n#### D\n## E\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const e = chunks.find(c => c.breadcrumb.includes("E"))!;
    expect(e.breadcrumb).toEqual(["A", "E"]);
    expect(e.breadcrumb).not.toContain("B");
    expect(e.breadcrumb).not.toContain("C");
    expect(e.breadcrumb).not.toContain("D");
  });

  it("multiple h1s each with multiple h2s produce the correct total chunk count and breadcrumbs", () => {
    const md = "# A\n## A1\nbody\n## A2\nbody\n# B\n## B1\nbody\n## B2\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks).toHaveLength(6);
    expect(chunks[0]!.breadcrumb).toEqual(["A"]);
    expect(chunks[1]!.breadcrumb).toEqual(["A", "A1"]);
    expect(chunks[2]!.breadcrumb).toEqual(["A", "A2"]);
    expect(chunks[3]!.breadcrumb).toEqual(["B"]);
    expect(chunks[4]!.breadcrumb).toEqual(["B", "B1"]);
    expect(chunks[5]!.breadcrumb).toEqual(["B", "B2"]);
  });
});

// ---------------------------------------------------------------------------
// duplicate h2 names under different h1 parents
// ---------------------------------------------------------------------------

describe("duplicate h2 names under different h1 parents", () => {
  it("same h2 name under different h1s produces two chunks with distinct breadcrumbs", () => {
    const md = "# A\n## Sub\nbody\n# B\n## Sub\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const subs = chunks.filter(c => c.breadcrumb[1] === "Sub");
    expect(subs).toHaveLength(2);
    expect(subs[0]!.breadcrumb).toEqual(["A", "Sub"]);
    expect(subs[1]!.breadcrumb).toEqual(["B", "Sub"]);
  });

  it("same h2 name under different h1s keeps body text isolated", () => {
    const md = "# A\n## Sub\nalpha\n# B\n## Sub\nbeta";
    const chunks = chunkMarkdown(md, "f.md");
    const first = chunks.find(c => c.breadcrumb[0] === "A" && c.breadcrumb[1] === "Sub")!;
    const second = chunks.find(c => c.breadcrumb[0] === "B" && c.breadcrumb[1] === "Sub")!;
    expect(first.content).toContain("alpha");
    expect(first.content).not.toContain("beta");
    expect(second.content).toContain("beta");
    expect(second.content).not.toContain("alpha");
  });
});

// ---------------------------------------------------------------------------
// closing hashes on h2
// ---------------------------------------------------------------------------

describe("closing hashes on h2 headings", () => {
  it("trailing ## on h2 preceded by space is stripped from breadcrumb text", () => {
    const chunks = chunkMarkdown("# Parent\n## Child ##\nbody", "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.breadcrumb).toEqual(["Parent", "Child"]);
  });
});

// ---------------------------------------------------------------------------
// orphaned h2 — no h1 ancestor
// ---------------------------------------------------------------------------

describe("orphaned h2 with no h1 ancestor", () => {
  it("h2 as the first heading produces a single-entry breadcrumb with no undefined gap", () => {
    const chunks = chunkMarkdown("## Section\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Section"]);
    expect(chunks[0]!.breadcrumb).not.toContain(undefined);
    expect(chunks[0]!.breadcrumb).not.toContain(null);
    expect(chunks[0]!.breadcrumb).not.toContain("");
  });

  it("h3 as the first heading produces a single-entry breadcrumb with no undefined gaps", () => {
    const chunks = chunkMarkdown("### Deep\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Deep"]);
    expect(chunks[0]!.breadcrumb).not.toContain(undefined);
  });

  it("h2 followed by h1 followed by h2 correctly resets context", () => {
    const md = "## Orphan\nbody\n# Root\n## Child\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const child = chunks.find(c => c.breadcrumb.includes("Child"))!;
    expect(child.breadcrumb).toEqual(["Root", "Child"]);
  });
});

// ---------------------------------------------------------------------------
// going back up past a skipped level
// ---------------------------------------------------------------------------

describe("going back up past a skipped level", () => {
  it("h1 then h3 then h2 — h2 breadcrumb drops the h3", () => {
    const md = "# Root\n### Skip\n## Back\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const back = chunks.find(c => c.breadcrumb.includes("Back"))!;
    expect(back.breadcrumb).toEqual(["Root", "Back"]);
    expect(back.breadcrumb).not.toContain("Skip");
  });
});
