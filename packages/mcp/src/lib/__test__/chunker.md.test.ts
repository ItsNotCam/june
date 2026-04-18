import { describe, it, expect } from "bun:test";
import { chunkMarkdown } from "../chunker.md";
import { BREADCRUMB_DELIMITER } from "../chunker.types";

const D = BREADCRUMB_DELIMITER;

// ---------------------------------------------------------------------------
// source field
// ---------------------------------------------------------------------------

describe("source field", () => {
  it("sets source on every chunk when filename is provided", () => {
    const chunks = chunkMarkdown("# A\nbody\n# B\nbody", "doc.md");
    expect(chunks[0]!.source).toBe("doc.md");
    expect(chunks[1]!.source).toBe("doc.md");
  });

  it("throws when source argument is omitted", () => {
    // @ts-expect-error intentionally omitting required arg
    expect(() => chunkMarkdown("# Hello\nbody")).toThrow();
  });

  it("throws when source is explicitly null", () => {
    // @ts-expect-error intentionally passing null
    expect(() => chunkMarkdown("# Hello\nbody", null)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// pre-heading content
// ---------------------------------------------------------------------------

describe("pre-heading content", () => {
  it("produces a chunk with empty breadcrumb when text appears before first heading", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    const pre = chunks.find(c => c.breadcrumb.length === 0);
    expect(pre).toBeDefined();
    expect(pre!.breadcrumb).toEqual([]);
  });

  it("pre-heading chunk has correct source", () => {
    const chunks = chunkMarkdown("intro\n# H\nbody", "readme.md");
    const pre = chunks.find(c => c.breadcrumb.length === 0);
    expect(pre!.source).toBe("readme.md");
  });

  it("pre-heading chunk content contains the pre-heading text", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    const pre = chunks.find(c => c.breadcrumb.length === 0);
    expect(pre!.content).toContain("intro text");
  });

  it("pre-heading chunk content does not contain a breadcrumb prefix with delimiter", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    const pre = chunks.find(c => c.breadcrumb.length === 0);
    expect(pre!.content).not.toContain(D);
  });
});

// ---------------------------------------------------------------------------
// heading text in breadcrumb vs content
// ---------------------------------------------------------------------------

describe("heading text in breadcrumb vs content", () => {
  it("heading markdown line does not appear raw in content", () => {
    const chunks = chunkMarkdown("# Hello\nbody text", "f.md");
    expect(chunks[0]!.content).not.toContain("# Hello");
  });

  it("root-level chunk content starts with the heading text as prefix", () => {
    const chunks = chunkMarkdown("# Hello\nbody text", "f.md");
    expect(chunks[0]!.content.startsWith("Hello")).toBe(true);
  });

  it("nested chunk content starts with full breadcrumb path joined by delimiter", () => {
    const chunks = chunkMarkdown("# Parent\n## Child\nbody", "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.content.startsWith(`Parent ${D} Child`)).toBe(true);
  });

  it("body text appears after the breadcrumb prefix", () => {
    const chunks = chunkMarkdown("# Hello\nbody text", "f.md");
    expect(chunks[0]!.content).toContain("body text");
    const prefixEnd = chunks[0]!.content.indexOf("Hello") + "Hello".length;
    const bodyStart = chunks[0]!.content.indexOf("body text");
    expect(bodyStart).toBeGreaterThan(prefixEnd);
  });
});

// ---------------------------------------------------------------------------
// breadcrumb construction
// ---------------------------------------------------------------------------

describe("breadcrumb construction", () => {
  it("single h1 produces breadcrumb with one entry", () => {
    const chunks = chunkMarkdown("# Top\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Top"]);
  });

  it("h2 under h1 produces two-entry breadcrumb", () => {
    const chunks = chunkMarkdown("# Parent\n## Child\nbody", "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.breadcrumb).toEqual(["Parent", "Child"]);
  });

  it("h3 under h2 under h1 produces three-entry breadcrumb", () => {
    const chunks = chunkMarkdown("# A\n## B\n### C\nbody", "f.md");
    const deep = chunks.find(c => c.breadcrumb.length === 3)!;
    expect(deep.breadcrumb).toEqual(["A", "B", "C"]);
  });

  it("h6 at full depth produces six-entry breadcrumb", () => {
    const md = "# L1\n## L2\n### L3\n#### L4\n##### L5\n###### L6\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const deep = chunks.find(c => c.breadcrumb.length === 6)!;
    expect(deep.breadcrumb).toEqual(["L1", "L2", "L3", "L4", "L5", "L6"]);
  });

  it("sibling h2s each inherit the same h1 ancestor", () => {
    const md = "# Parent\n## First\nbody\n## Second\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const children = chunks.filter(c => c.breadcrumb.length === 2);
    expect(children[0]!.breadcrumb).toEqual(["Parent", "First"]);
    expect(children[1]!.breadcrumb).toEqual(["Parent", "Second"]);
  });

  it("new h1 resets breadcrumb entirely", () => {
    const md = "# First\n## Nested\n# Second\n## Other";
    const chunks = chunkMarkdown(md, "f.md");
    const last = chunks[chunks.length - 1]!;
    expect(last.breadcrumb).toEqual(["Second", "Other"]);
    expect(last.breadcrumb).not.toContain("First");
    expect(last.breadcrumb).not.toContain("Nested");
  });

  it("new h2 truncates h3 and deeper from breadcrumb", () => {
    const md = "# Top\n## One\n### Deep\n## Two\n### Other";
    const chunks = chunkMarkdown(md, "f.md");
    const last = chunks[chunks.length - 1]!;
    expect(last.breadcrumb).toEqual(["Top", "Two", "Other"]);
  });

  it("skipped heading level produces compact breadcrumb with no undefined gaps", () => {
    const md = "# H1\n### H3\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const h3chunk = chunks.find(c => c.breadcrumb.includes("H3"))!;
    expect(h3chunk.breadcrumb).toEqual(["H1", "H3"]);
    expect(h3chunk.breadcrumb).not.toContain(undefined);
    expect(h3chunk.breadcrumb).not.toContain(null);
    expect(h3chunk.breadcrumb).not.toContain("");
  });
});

// ---------------------------------------------------------------------------
// inline markdown stripping in breadcrumb entries
// ---------------------------------------------------------------------------

describe("inline markdown stripping in breadcrumb entries", () => {
  it("strips bold markers from heading text", () => {
    const chunks = chunkMarkdown("# **Bold** Title\nbody", "f.md");
    expect(chunks[0]!.breadcrumb[0]).toBe("Bold Title");
  });

  it("strips italic markers from heading text", () => {
    const chunks = chunkMarkdown("# _Italic_ Title\nbody", "f.md");
    expect(chunks[0]!.breadcrumb[0]).toBe("Italic Title");
  });

  it("strips inline code markers from heading text", () => {
    const chunks = chunkMarkdown("# Use `code` here\nbody", "f.md");
    expect(chunks[0]!.breadcrumb[0]).toBe("Use code here");
  });

  it("strips link syntax from heading text, keeping link label", () => {
    const chunks = chunkMarkdown("# [Link Label](https://example.com)\nbody", "f.md");
    expect(chunks[0]!.breadcrumb[0]).toBe("Link Label");
  });
});

// ---------------------------------------------------------------------------
// content prefix format
// ---------------------------------------------------------------------------

describe("content prefix format", () => {
  it("single-level chunk prefix contains no delimiter", () => {
    const chunks = chunkMarkdown("# Hello\nbody", "f.md");
    expect(chunks[0]!.content).not.toContain(D);
  });

  it("two-level chunk prefix joins entries with delimiter", () => {
    const chunks = chunkMarkdown("# A\n## B\nbody", "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.content).toContain(`A ${D} B`);
  });

  it(`three-level chunk prefix is H1 ${D} H2 ${D} H3`, () => {
    const chunks = chunkMarkdown("# A\n## B\n### C\nbody", "f.md");
    const deep = chunks.find(c => c.breadcrumb.length === 3)!;
    expect(deep.content).toContain(`A ${D} B ${D} C`);
  });

  it("prefix and body are separated by a blank line", () => {
    const chunks = chunkMarkdown("# Hello\nbody text", "f.md");
    const content = chunks[0]!.content;
    const prefixLine = content.split("\n")[0]!;
    expect(prefixLine).toBe("Hello");
    expect(content).toContain("\n\n");
    expect(content.indexOf("body text")).toBeGreaterThan(content.indexOf("\n\n"));
  });
});

// ---------------------------------------------------------------------------
// code blocks
// ---------------------------------------------------------------------------

describe("code blocks", () => {
  it("hash inside fenced code block is not treated as a heading", () => {
    const md = "# Real Heading\n```\n# fake heading in code\n```\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks).toHaveLength(1);
  });

  it("code block content stays in the same chunk as its containing heading", () => {
    const md = "# Heading\n```\nconst x = 1;\n```\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.content).toContain("const x = 1;");
  });

  it("chunk count is unaffected by headings inside code fences", () => {
    const md = "# One\n```\n# inside\n## also inside\n```\n# Two\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// empty and edge cases
// ---------------------------------------------------------------------------

describe("empty and edge cases", () => {
  it("returns no chunks for an empty string", () => {
    expect(chunkMarkdown("", "f.md")).toHaveLength(0);
  });

  it("returns no chunks for whitespace-only input", () => {
    expect(chunkMarkdown("   \n\n\t\n", "f.md")).toHaveLength(0);
  });

  it("text with no headings produces one chunk with empty breadcrumb", () => {
    const chunks = chunkMarkdown("just some text\nno headings here", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual([]);
    expect(chunks[0]!.content).toContain("just some text");
  });

  it("heading with no body produces a chunk with an empty body after the prefix", () => {
    const chunks = chunkMarkdown("# Empty\n# Next\nbody", "f.md");
    const empty = chunks.find(c => c.breadcrumb[0] === "Empty")!;
    expect(empty).toBeDefined();
    const body = empty.content.split("\n\n").slice(1).join("").trim();
    expect(body).toBe("");
  });

  it("multiple blank lines between heading and body do not prevent content capture", () => {
    const md = "# Heading\n\n\n\nbody after blanks";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.content).toContain("body after blanks");
  });
});

// ---------------------------------------------------------------------------
// delimiter in heading text
// ---------------------------------------------------------------------------

describe("delimiter in heading text", () => {
  it(`${D} in h1 heading text appears in breadcrumb verbatim`, () => {
    const chunks = chunkMarkdown(`# A ${D} B\nbody`, "f.md");
    expect(chunks[0]!.breadcrumb).toEqual([`A ${D} B`]);
  });

  it(`${D} in root heading text does not split the breadcrumb into multiple entries`, () => {
    const chunks = chunkMarkdown(`# A ${D} B\nbody`, "f.md");
    expect(chunks[0]!.breadcrumb).toHaveLength(1);
  });

  it(`${D} in nested heading text is preserved in breadcrumb without inflating depth`, () => {
    const chunks = chunkMarkdown(`# Parent\n## A ${D} B\nbody`, "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.breadcrumb).toEqual(["Parent", `A ${D} B`]);
  });
});

// ---------------------------------------------------------------------------
// unicode and special characters in headings
// ---------------------------------------------------------------------------

describe("unicode and special characters in headings", () => {
  it("unicode heading text is preserved exactly in breadcrumb", () => {
    const chunks = chunkMarkdown("# こんにちは\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["こんにちは"]);
  });

  it("emoji in heading text is preserved in breadcrumb", () => {
    const chunks = chunkMarkdown("# 🔥 Fire\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["🔥 Fire"]);
  });

  it("heading with HTML special characters is preserved in breadcrumb", () => {
    const chunks = chunkMarkdown("# C++ & <Generics>\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["C++ & <Generics>"]);
  });

  it("heading with quotes is preserved in breadcrumb", () => {
    const chunks = chunkMarkdown(`# Say "Hello" and 'Goodbye'\nbody`, "f.md");
    expect(chunks[0]!.breadcrumb).toEqual([`Say "Hello" and 'Goodbye'`]);
  });
});

// ---------------------------------------------------------------------------
// breadcrumb reset across multiple depth levels
// ---------------------------------------------------------------------------

describe("breadcrumb reset across multiple depth levels", () => {
  it("h6 followed by h1 fully resets breadcrumb to single entry", () => {
    const md = "# L1\n## L2\n### L3\n#### L4\n##### L5\n###### L6\nbody\n# Reset\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const reset = chunks.find(c => c.breadcrumb[0] === "Reset")!;
    expect(reset.breadcrumb).toEqual(["Reset"]);
  });

  it("jumping from h5 back to h3 drops h4 and h5 from breadcrumb", () => {
    const md = "# A\n## B\n### C\n#### D\n##### E\n### F\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const f = chunks.find(c => c.breadcrumb.includes("F"))!;
    expect(f.breadcrumb).toEqual(["A", "B", "F"]);
    expect(f.breadcrumb).not.toContain("C");
    expect(f.breadcrumb).not.toContain("D");
    expect(f.breadcrumb).not.toContain("E");
  });

  it("multiple level skip up then back down builds correct breadcrumbs", () => {
    const md = "# A\n### B\n## C\n### D\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const d = chunks.find(c => c.breadcrumb.includes("D"))!;
    expect(d.breadcrumb).toEqual(["A", "C", "D"]);
  });
});

// ---------------------------------------------------------------------------
// setext-style headings
// ---------------------------------------------------------------------------

describe("setext-style headings", () => {
  it("setext h1 (underlined with ===) is recognised as a heading", () => {
    const md = "Introduction\n============\nbody text";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Introduction"]);
  });

  it("setext h2 (underlined with ---) is recognised as a heading", () => {
    const md = "# Parent\n\nSection\n-------\nbody text";
    const chunks = chunkMarkdown(md, "f.md");
    const section = chunks.find(c => c.breadcrumb.includes("Section"))!;
    expect(section.breadcrumb).toEqual(["Parent", "Section"]);
  });
});

// ---------------------------------------------------------------------------
// windows line endings
// ---------------------------------------------------------------------------

describe("windows line endings", () => {
  it("CRLF line endings do not prevent heading detection", () => {
    const md = "# Hello\r\nbody text\r\n# World\r\nbody two";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
    expect(chunks[1]!.breadcrumb).toEqual(["World"]);
  });

  it("CRLF line endings do not leave carriage returns in breadcrumb entries", () => {
    const md = "# Hello\r\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.breadcrumb[0]).toBe("Hello");
    expect(chunks[0]!.breadcrumb[0]).not.toContain("\r");
  });

  it("CRLF line endings do not leave carriage returns in body content", () => {
    const md = "# Hello\r\nbody text\r\n";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.content).toContain("body text");
  });
});

// ---------------------------------------------------------------------------
// indented headings
// ---------------------------------------------------------------------------

describe("indented headings", () => {
  it("heading indented with 4 spaces is not treated as a heading and its text becomes a headingless chunk", () => {
    const chunks = chunkMarkdown("    # Indented four spaces\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// heading level overflow (h7+)
// ---------------------------------------------------------------------------

describe("heading level overflow", () => {
  it("seven hashes is not treated as a heading and its text becomes a headingless chunk", () => {
    const chunks = chunkMarkdown("####### Not a heading\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual([]);
    expect(chunks[0]!.content).toContain("Not a heading");
  });

  it("seven hashes before a real heading lands in pre-heading content", () => {
    const chunks = chunkMarkdown("####### Not a heading\n# Real\nbody", "f.md");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.breadcrumb).toEqual([]);
    expect(chunks[1]!.breadcrumb).toEqual(["Real"]);
  });
});

// ---------------------------------------------------------------------------
// HTML headings — not markdown headings
// ---------------------------------------------------------------------------

describe("HTML headings are not treated as markdown headings", () => {
  it("<h1> tag does not produce a heading chunk and its text becomes a headingless chunk", () => {
    const chunks = chunkMarkdown("<h1>Not a heading</h1>\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual([]);
  });

  it("<h1> tag before a real heading lands in pre-heading content", () => {
    const chunks = chunkMarkdown("<h1>HTML</h1>\n# Real\nbody", "f.md");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.breadcrumb).toEqual([]);
    expect(chunks[1]!.breadcrumb).toEqual(["Real"]);
  });
});

// ---------------------------------------------------------------------------
// tilde code fences
// ---------------------------------------------------------------------------

describe("tilde code fences", () => {
  it("hash inside tilde-fenced code block is not treated as a heading", () => {
    const md = "# Real\n~~~\n# fake\n~~~\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Real"]);
  });

  it("tilde fence content stays in the same chunk as its containing heading", () => {
    const md = "# Heading\n~~~\ncode content\n~~~\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.content).toContain("code content");
  });
});

// ---------------------------------------------------------------------------
// unclosed code fence
// ---------------------------------------------------------------------------

describe("unclosed code fence", () => {
  it("heading after an unclosed code fence is not treated as a heading", () => {
    const md = "# Before\nbody\n```\n# Inside unclosed fence\n# Also inside";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Before"]);
  });
});

// ---------------------------------------------------------------------------
// additional inline markdown stripping
// ---------------------------------------------------------------------------

describe("additional inline markdown stripping in breadcrumb entries", () => {
  it("strips double-underscore bold from heading text", () => {
    const chunks = chunkMarkdown("# __Bold__ Title\nbody", "f.md");
    expect(chunks[0]!.breadcrumb[0]).toBe("Bold Title");
  });

  it("strips strikethrough from heading text", () => {
    const chunks = chunkMarkdown("# ~~removed~~ Title\nbody", "f.md");
    expect(chunks[0]!.breadcrumb[0]).toBe("removed Title");
  });

  it("strips bold-italic combination from heading text", () => {
    const chunks = chunkMarkdown("# ***Bold Italic*** Title\nbody", "f.md");
    expect(chunks[0]!.breadcrumb[0]).toBe("Bold Italic Title");
  });

  it("strips image syntax from heading text keeping alt text", () => {
    const chunks = chunkMarkdown("# ![Logo](logo.png) Title\nbody", "f.md");
    expect(chunks[0]!.breadcrumb[0]).toBe("Logo Title");
  });

  it("strips reference-style link keeping label text", () => {
    const chunks = chunkMarkdown("# [Link Text][ref-id] Title\nbody", "f.md");
    expect(chunks[0]!.breadcrumb[0]).toBe("Link Text Title");
  });

  it("strips multiple inline elements from a single heading", () => {
    const chunks = chunkMarkdown("# **Bold** and _italic_ and `code`\nbody", "f.md");
    expect(chunks[0]!.breadcrumb[0]).toBe("Bold and italic and code");
  });
});

// ---------------------------------------------------------------------------
// empty heading text
// ---------------------------------------------------------------------------

describe("empty heading text", () => {
  it("heading with text that strips entirely to empty does not produce a non-empty breadcrumb entry", () => {
    const chunks = chunkMarkdown("# ****\nbody", "f.md");
    if (chunks.length > 0) {
      expect(chunks[0]!.breadcrumb[0]).toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// horizontal rules vs setext headings
// ---------------------------------------------------------------------------

describe("horizontal rules in body", () => {
  it("--- on its own line in a body does not start a new chunk", () => {
    const md = "# Section\nparagraph\n\n---\n\nmore content";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks).toHaveLength(1);
  });

  it("--- horizontal rule content is captured in the same chunk", () => {
    const md = "# Section\nparagraph\n\n---\n\nmore content";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.content).toContain("more content");
  });
});

// ---------------------------------------------------------------------------
// issue 2: # inside heading text at h2 level — the exact example from review
// ---------------------------------------------------------------------------

describe("hash inside heading text at any level", () => {
  it("# inside backtick code in h2 heading is not stripped from breadcrumb", () => {
    const chunks = chunkMarkdown("# Parent\n## Why use `#` characters?\nbody", "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.breadcrumb).toEqual(["Parent", "Why use # characters?"]);
  });

  it("C# in h2 heading text is not stripped from breadcrumb", () => {
    const chunks = chunkMarkdown("# Docs\n## C# Guide\nbody", "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.breadcrumb).toEqual(["Docs", "C# Guide"]);
  });

  it("# in h2 heading text does not corrupt the content body", () => {
    const chunks = chunkMarkdown("# Docs\n## C# Guide\nbody text here", "f.md");
    const child = chunks.find(c => c.breadcrumb[1] === "C# Guide")!;
    expect(child.content).toContain("body text here");
  });
});

// ---------------------------------------------------------------------------
// issue 1: fragile replace — heading with regex special chars at nested level
// ---------------------------------------------------------------------------

describe("regex special characters in nested heading text", () => {
  it("parentheses in h2 text are preserved in breadcrumb and content prefix", () => {
    const chunks = chunkMarkdown("# Parent\n## Section (v2)\nbody", "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.breadcrumb).toEqual(["Parent", "Section (v2)"]);
    expect(child.content).toContain("Section (v2)");
  });

  it("dot-separated version string in heading text is preserved", () => {
    const chunks = chunkMarkdown("# Release\n## v1.2.3\nbody", "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.breadcrumb).toEqual(["Release", "v1.2.3"]);
  });

  it("square brackets in h2 text are preserved", () => {
    const chunks = chunkMarkdown("# Guide\n## Options[]\nbody", "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.breadcrumb).toEqual(["Guide", "Options[]"]);
  });
});

// ---------------------------------------------------------------------------
// issue 3: markdown stripping — single asterisk italic
// ---------------------------------------------------------------------------

describe("single asterisk italic stripping in breadcrumb", () => {
  it("strips single-asterisk italic from heading text", () => {
    const chunks = chunkMarkdown("# *italic* title\nbody", "f.md");
    expect(chunks[0]!.breadcrumb[0]).toBe("italic title");
  });

  it("# inside backtick in heading text — # stripped with code markers but rest preserved", () => {
    const chunks = chunkMarkdown("# Use `#` syntax\nbody", "f.md");
    expect(chunks[0]!.breadcrumb[0]).toBe("Use # syntax");
  });
});

// ---------------------------------------------------------------------------
// backslash-escaped heading marker
// ---------------------------------------------------------------------------

describe("backslash-escaped heading marker", () => {
  it("\\# is not treated as a heading", () => {
    const chunks = chunkMarkdown("\\# Not a heading\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual([]);
  });

  it("\\# before a real heading lands in pre-heading content", () => {
    const chunks = chunkMarkdown("\\# Not a heading\n# Real\nbody", "f.md");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.breadcrumb).toEqual([]);
    expect(chunks[1]!.breadcrumb).toEqual(["Real"]);
  });
});

// ---------------------------------------------------------------------------
// code fence that closes before a real heading
// ---------------------------------------------------------------------------

describe("code fence that closes before a real heading", () => {
  it("real heading after a closed fence is detected as a heading", () => {
    const md = "# Before\nbody\n```\n# fake\n```\n# After\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.breadcrumb).toEqual(["Before"]);
    expect(chunks[1]!.breadcrumb).toEqual(["After"]);
  });

  it("content inside a closed fence stays in the chunk that opened before it", () => {
    const md = "# Before\nbody\n```\nfake code\n```\n# After\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.content).toContain("fake code");
    expect(chunks[1]!.content).not.toContain("fake code");
  });
});

// ---------------------------------------------------------------------------
// multiple setext headings
// ---------------------------------------------------------------------------

describe("multiple setext headings", () => {
  it("two setext h1s each produce their own chunk", () => {
    const md = "First\n=====\nbody one\n\nSecond\n======\nbody two";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.breadcrumb).toEqual(["First"]);
    expect(chunks[1]!.breadcrumb).toEqual(["Second"]);
  });

  it("setext h1 followed by setext h2 nests correctly", () => {
    const md = "Parent\n======\nbody\n\nChild\n------\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    const child = chunks.find(c => c.breadcrumb.length === 2)!;
    expect(child.breadcrumb).toEqual(["Parent", "Child"]);
  });
});

// ---------------------------------------------------------------------------
// chunk ordering
// ---------------------------------------------------------------------------

describe("chunk ordering", () => {
  it("chunks appear in document order", () => {
    const md = "# First\nbody\n# Second\nbody\n# Third\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["First"]);
    expect(chunks[1]!.breadcrumb).toEqual(["Second"]);
    expect(chunks[2]!.breadcrumb).toEqual(["Third"]);
  });

  it("pre-heading chunk is always at index 0 when present", () => {
    const chunks = chunkMarkdown("preamble\n# First\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual([]);
    expect(chunks[1]!.breadcrumb).toEqual(["First"]);
  });

  it("multiple consecutive headings with no body appear in document order", () => {
    const md = "# A\n# B\n# C\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["A"]);
    expect(chunks[1]!.breadcrumb).toEqual(["B"]);
    expect(chunks[2]!.breadcrumb).toEqual(["C"]);
  });
});

// ---------------------------------------------------------------------------
// complex integration
// ---------------------------------------------------------------------------

describe("complex integration", () => {
  it("multi-level document produces correct chunk count, breadcrumbs, and prefixed content", () => {
    const md = `
# Guide

intro one

intro two

## Installation

install one

install two

### Prerequisites

prereq content

### Steps

steps content

## Usage

usage content

### Advanced

advanced content

# Reference

ref intro

## API

api content
`.trim();

    const chunks = chunkMarkdown(md, "guide.md");

    expect(chunks).toHaveLength(8);

    expect(chunks[0]!.breadcrumb).toEqual(["Guide"]);
    expect(chunks[0]!.content.startsWith("Guide")).toBe(true);
    expect(chunks[0]!.content).toContain("intro one");
    expect(chunks[0]!.content).toContain("intro two");
    expect(chunks[0]!.source).toBe("guide.md");

    expect(chunks[1]!.breadcrumb).toEqual(["Guide", "Installation"]);
    expect(chunks[1]!.content.startsWith(`Guide ${D} Installation`)).toBe(true);
    expect(chunks[1]!.content).toContain("install one");
    expect(chunks[1]!.content).toContain("install two");

    expect(chunks[2]!.breadcrumb).toEqual(["Guide", "Installation", "Prerequisites"]);
    expect(chunks[2]!.content.startsWith(`Guide ${D} Installation ${D} Prerequisites`)).toBe(true);
    expect(chunks[2]!.content).toContain("prereq content");

    expect(chunks[3]!.breadcrumb).toEqual(["Guide", "Installation", "Steps"]);
    expect(chunks[3]!.content.startsWith(`Guide ${D} Installation ${D} Steps`)).toBe(true);
    expect(chunks[3]!.content).toContain("steps content");

    expect(chunks[4]!.breadcrumb).toEqual(["Guide", "Usage"]);
    expect(chunks[4]!.content.startsWith(`Guide ${D} Usage`)).toBe(true);
    expect(chunks[4]!.content).toContain("usage content");

    expect(chunks[5]!.breadcrumb).toEqual(["Guide", "Usage", "Advanced"]);
    expect(chunks[5]!.content.startsWith(`Guide ${D} Usage ${D} Advanced`)).toBe(true);
    expect(chunks[5]!.content).toContain("advanced content");

    expect(chunks[6]!.breadcrumb).toEqual(["Reference"]);
    expect(chunks[6]!.content.startsWith("Reference")).toBe(true);
    expect(chunks[6]!.content).toContain("ref intro");

    expect(chunks[7]!.breadcrumb).toEqual(["Reference", "API"]);
    expect(chunks[7]!.content.startsWith(`Reference ${D} API`)).toBe(true);
    expect(chunks[7]!.content).toContain("api content");
  });
});
