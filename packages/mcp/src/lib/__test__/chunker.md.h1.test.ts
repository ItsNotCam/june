import { describe, it, expect } from "bun:test";
import { chunkMarkdown } from "../chunker.md";
import { MarkdownDelimiter } from "../chunker.types";

const D = MarkdownDelimiter;

// ---------------------------------------------------------------------------
// h1-only splitting
// ---------------------------------------------------------------------------

describe("h1-only splitting", () => {
  it("single h1 produces one chunk", () => {
    const chunks = chunkMarkdown("# Hello\nbody", "f.md");
    expect(chunks).toHaveLength(1);
  });

  it("two h1s produce two chunks", () => {
    const chunks = chunkMarkdown("# First\nbody one\n# Second\nbody two", "f.md");
    expect(chunks).toHaveLength(2);
  });

  it("three h1s produce three chunks", () => {
    const chunks = chunkMarkdown("# A\nbody\n# B\nbody\n# C\nbody", "f.md");
    expect(chunks).toHaveLength(3);
  });

  it("each h1 chunk has a single-entry breadcrumb", () => {
    const chunks = chunkMarkdown("# First\nbody\n# Second\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["First"]);
    expect(chunks[1]!.breadcrumb).toEqual(["Second"]);
  });

  it("each h1 chunk content starts with the heading text as prefix", () => {
    const chunks = chunkMarkdown("# First\nbody\n# Second\nbody", "f.md");
    expect(chunks[0]!.content.startsWith("First")).toBe(true);
    expect(chunks[1]!.content.startsWith("Second")).toBe(true);
  });

  it("body text is captured under the correct h1", () => {
    const chunks = chunkMarkdown("# First\nalpha\n# Second\nbeta", "f.md");
    expect(chunks[0]!.content).toContain("alpha");
    expect(chunks[0]!.content).not.toContain("beta");
    expect(chunks[1]!.content).toContain("beta");
    expect(chunks[1]!.content).not.toContain("alpha");
  });

  it("multiline body under a single h1 is captured in full", () => {
    const md = "# Heading\nline one\nline two\nline three";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.content).toContain("line one");
    expect(chunks[0]!.content).toContain("line two");
    expect(chunks[0]!.content).toContain("line three");
  });

  it("h1 with no body produces a chunk with prefix but no body text", () => {
    const chunks = chunkMarkdown("# Empty\n# Next\nbody", "f.md");
    const empty = chunks.find(c => c.breadcrumb[0] === "Empty")!;
    expect(empty).toBeDefined();
    const body = empty.content.split("\n\n").slice(1).join("").trim();
    expect(body).toBe("");
  });

  it("no delimiter appears in h1-only chunks", () => {
    const chunks = chunkMarkdown("# One\nbody\n# Two\nbody", "f.md");
    expect(chunks[0]!.content).not.toContain(D);
    expect(chunks[1]!.content).not.toContain(D);
  });
});

// ---------------------------------------------------------------------------
// pre-heading content
// ---------------------------------------------------------------------------

describe("pre-heading content", () => {
  it("text before the first heading produces an extra chunk", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    expect(chunks).toHaveLength(2);
  });

  it("pre-heading chunk is the first chunk", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual([]);
  });

  it("pre-heading chunk contains the pre-heading text", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    expect(chunks[0]!.content).toBe("intro text");
  });

  it("pre-heading chunk has correct source", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "readme.md");
    expect(chunks[0]!.source).toBe("readme.md");
  });

  it("pre-heading chunk content contains no delimiter", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    expect(chunks[0]!.content).not.toContain(D);
  });

  it("heading chunk after pre-heading content has correct breadcrumb", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    expect(chunks[1]!.breadcrumb).toEqual(["Heading"]);
  });

  it("heading chunk body after pre-heading content does not include the pre-heading text", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    expect(chunks[1]!.content).not.toContain("intro text");
  });

  it("multiline pre-heading text is captured in full", () => {
    const md = "line one\nline two\nline three\n# Heading\nbody";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.content).toContain("line one");
    expect(chunks[0]!.content).toContain("line two");
    expect(chunks[0]!.content).toContain("line three");
  });
});

// ---------------------------------------------------------------------------
// heading detection edge cases
// ---------------------------------------------------------------------------

describe("heading detection edge cases", () => {
  it("hash with no space (#NoSpace) is not treated as a heading and its text becomes a headingless chunk", () => {
    const chunks = chunkMarkdown("#NoSpace\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual([]);
    expect(chunks[0]!.content).toContain("#NoSpace");
  });

  it("#NoSpace before a real heading lands in the pre-heading chunk", () => {
    const chunks = chunkMarkdown("#NoSpace\n# Real\nbody", "f.md");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.breadcrumb).toEqual([]);
    expect(chunks[0]!.content).toContain("#NoSpace");
    expect(chunks[1]!.breadcrumb).toEqual(["Real"]);
  });

  it("heading with trailing whitespace has trimmed text in breadcrumb", () => {
    const chunks = chunkMarkdown("# Hello   \nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });

  it("heading with numbers in text preserves full text in breadcrumb", () => {
    const chunks = chunkMarkdown("# 3. Introduction\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["3. Introduction"]);
  });

  it("heading at end of file with no trailing newline still produces a chunk", () => {
    const chunks = chunkMarkdown("# Heading", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Heading"]);
  });

  it("heading at end of file with no body has empty body after prefix", () => {
    const chunks = chunkMarkdown("# Heading", "f.md");
    const body = chunks[0]!.content.split("\n\n").slice(1).join("").trim();
    expect(body).toBe("");
  });

  it("duplicate h1 heading names produce two separate chunks both with the same breadcrumb", () => {
    const chunks = chunkMarkdown("# Introduction\nbody one\n# Introduction\nbody two", "f.md");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.breadcrumb).toEqual(["Introduction"]);
    expect(chunks[1]!.breadcrumb).toEqual(["Introduction"]);
  });

  it("duplicate h1 heading names keep body text isolated to the correct chunk", () => {
    const chunks = chunkMarkdown("# Introduction\nbody one\n# Introduction\nbody two", "f.md");
    expect(chunks[0]!.content).toContain("body one");
    expect(chunks[0]!.content).not.toContain("body two");
    expect(chunks[1]!.content).toContain("body two");
    expect(chunks[1]!.content).not.toContain("body one");
  });
});

// ---------------------------------------------------------------------------
// source field edge cases
// ---------------------------------------------------------------------------

describe("source field edge cases", () => {
  it("source with path separators is preserved exactly on every chunk", () => {
    const chunks = chunkMarkdown("# A\nbody\n# B\nbody", "docs/guide.md");
    expect(chunks[0]!.source).toBe("docs/guide.md");
    expect(chunks[1]!.source).toBe("docs/guide.md");
  });

  it("source with spaces is preserved exactly", () => {
    const chunks = chunkMarkdown("# Hello\nbody", "my file.md");
    expect(chunks[0]!.source).toBe("my file.md");
  });
});

// ---------------------------------------------------------------------------
// delimiter in body content
// ---------------------------------------------------------------------------

describe("delimiter in body content", () => {
  it(`${D} in body text is preserved verbatim and does not corrupt content`, () => {
    const chunks = chunkMarkdown(`# Heading\nbody with ${D} inside`, "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Heading"]);
    expect(chunks[0]!.content).toContain(`body with ${D} inside`);
  });

  it(`${D} in body text does not change chunk count`, () => {
    const chunks = chunkMarkdown(`# One\nbody ${D} text\n# Two\nbody`, "f.md");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.breadcrumb).toEqual(["One"]);
    expect(chunks[1]!.breadcrumb).toEqual(["Two"]);
  });
});

// ---------------------------------------------------------------------------
// indented headings (1–3 spaces are valid in CommonMark)
// ---------------------------------------------------------------------------

describe("indented headings within valid range", () => {
  it("heading with 1 leading space is treated as a heading", () => {
    const chunks = chunkMarkdown(" # Hello\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });

  it("heading with 2 leading spaces is treated as a heading", () => {
    const chunks = chunkMarkdown("  # Hello\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });

  it("heading with 3 leading spaces is treated as a heading", () => {
    const chunks = chunkMarkdown("   # Hello\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });
});

// ---------------------------------------------------------------------------
// tab as separator after #
// ---------------------------------------------------------------------------

describe("tab as separator after hash", () => {
  it("tab after # is treated as a valid heading separator", () => {
    const chunks = chunkMarkdown("#\tTabbed Heading\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Tabbed Heading"]);
  });
});

// ---------------------------------------------------------------------------
// empty ATX heading text
// ---------------------------------------------------------------------------

describe("empty ATX heading text", () => {
  it("bare # with nothing after produces a heading chunk with empty breadcrumb entry", () => {
    const chunks = chunkMarkdown("#\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual([]);
  });

  it("# followed by only a space produces a heading chunk with empty breadcrumb entry", () => {
    const chunks = chunkMarkdown("# \nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// leading spaces in heading text
// ---------------------------------------------------------------------------

describe("leading spaces in heading text are stripped", () => {
  it("multiple spaces after # are stripped from breadcrumb text", () => {
    const chunks = chunkMarkdown("#   Hello\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });
});

// ---------------------------------------------------------------------------
// body content is raw — markdown is NOT stripped
// ---------------------------------------------------------------------------

describe("body content is preserved raw and not stripped like breadcrumb entries", () => {
  it("bold markers in body text are preserved verbatim", () => {
    const chunks = chunkMarkdown("# Heading\n**bold text** in body", "f.md");
    expect(chunks[0]!.content).toContain("**bold text**");
  });

  it("inline code in body text is preserved verbatim", () => {
    const chunks = chunkMarkdown("# Heading\nuse `someFunction()` here", "f.md");
    expect(chunks[0]!.content).toContain("`someFunction()`");
  });

  it("link syntax in body text is preserved verbatim", () => {
    const chunks = chunkMarkdown("# Heading\nsee [link](https://example.com)", "f.md");
    expect(chunks[0]!.content).toContain("[link](https://example.com)");
  });
});

// ---------------------------------------------------------------------------
// issue 2: # in heading text must not be stripped (replace(/#+/g,"") bug)
// ---------------------------------------------------------------------------

describe("hash characters inside heading text are preserved", () => {
  it("C# in heading text is not stripped from breadcrumb", () => {
    const chunks = chunkMarkdown("# C# Programming\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["C# Programming"]);
  });

  it("# mid-text is not stripped from breadcrumb", () => {
    const chunks = chunkMarkdown("# Why use # for comments?\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Why use # for comments?"]);
  });

  it("# in heading text does not corrupt body content", () => {
    const chunks = chunkMarkdown("# C# Guide\nbody text", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["C# Guide"]);
    expect(chunks[0]!.content).toContain("body text");
  });

  it("multiple # inside heading text are all preserved in breadcrumb", () => {
    const chunks = chunkMarkdown("# Use #tag and #other\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Use #tag and #other"]);
  });

  it("## inside heading text after the marker is preserved in breadcrumb", () => {
    const chunks = chunkMarkdown("# See ##double for details\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["See ##double for details"]);
  });
});

// ---------------------------------------------------------------------------
// issue 1: fragile replace — regex special chars in heading text
// ---------------------------------------------------------------------------

describe("regex special characters in heading text", () => {
  it("parentheses in heading text are preserved in breadcrumb", () => {
    const chunks = chunkMarkdown("# Hello (World)\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello (World)"]);
  });

  it("parentheses in heading text are preserved in body content prefix", () => {
    const chunks = chunkMarkdown("# Hello (World)\nbody", "f.md");
    expect(chunks[0]!.content.startsWith("Hello (World)")).toBe(true);
  });

  it("dot in heading text is preserved", () => {
    const chunks = chunkMarkdown("# hello.exe\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["hello.exe"]);
  });

  it("square brackets in heading text are preserved", () => {
    const chunks = chunkMarkdown("# Array[0]\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Array[0]"]);
  });

  it("dollar sign in heading text is preserved", () => {
    const chunks = chunkMarkdown("# Price: $10.00\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Price: $10.00"]);
  });

  it("curly braces in heading text are preserved", () => {
    const chunks = chunkMarkdown("# Config {key: value}\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Config {key: value}"]);
  });

  it("pipe character in heading text is preserved", () => {
    const chunks = chunkMarkdown("# A | B\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["A | B"]);
  });

  it("heading text appearing verbatim in body is preserved in body after heading is removed", () => {
    const chunks = chunkMarkdown("# Introduction\nbody that mentions Introduction again", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Introduction"]);
    expect(chunks[0]!.content).toContain("mentions Introduction again");
  });

  it("heading line appearing as a full line in body is removed from prefix but preserved in body", () => {
    const chunks = chunkMarkdown("# test\nsome body\nreference to test again", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["test"]);
    expect(chunks[0]!.content).toContain("some body");
    expect(chunks[0]!.content).toContain("reference to test again");
  });
});

// ---------------------------------------------------------------------------
// source on pure headingless chunk
// ---------------------------------------------------------------------------

describe("source on pure headingless chunk", () => {
  it("source is set correctly when the document has no headings at all", () => {
    const chunks = chunkMarkdown("just text, no headings", "plain.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.source).toBe("plain.md");
    expect(chunks[0]!.breadcrumb).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ATX closing hash sequences
// CommonMark rule: trailing # chars are stripped ONLY when followed by nothing
// but optional spaces. A # followed by non-space chars is plain heading text.
// ---------------------------------------------------------------------------

describe("ATX closing hash sequences", () => {
  it("trailing # followed by EOL only is stripped — breadcrumb does not include it", () => {
    const chunks = chunkMarkdown("# Hello #\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });

  it("trailing ### followed by EOL only is stripped — breadcrumb does not include them", () => {
    const chunks = chunkMarkdown("# Hello ###\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });

  it("# followed by a word is NOT a closing sequence — the full text is preserved", () => {
    // '# Hello # World' — '# World' has 'World' after the #, so nothing is stripped
    const chunks = chunkMarkdown("# Hello # World\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello # World"]);
  });

  it("mid-text # followed by word is kept, but a later trailing # is still stripped", () => {
    // '# Hello # World #' — '# World' is kept (word after #), trailing ' #' is stripped
    const chunks = chunkMarkdown("# Hello # World #\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello # World"]);
  });
});

// ---------------------------------------------------------------------------
// hash characters that are not headings
// ---------------------------------------------------------------------------

describe("hash characters that are not headings", () => {
  it("hash mid-line in body text does not start a new chunk", () => {
    const chunks = chunkMarkdown("# Section\nSee note # 1 for details", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("See note # 1 for details");
  });
});

// ---------------------------------------------------------------------------
// blank-line-only pre-heading content
// ---------------------------------------------------------------------------

describe("blank-line-only pre-heading content", () => {
  it("only blank lines before first heading do not produce a pre-heading chunk", () => {
    const chunks = chunkMarkdown("\n\n\n# Heading\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Heading"]);
  });
});

// ---------------------------------------------------------------------------
// body content preservation
// ---------------------------------------------------------------------------

describe("body content preservation", () => {
  it("internal blank lines within a body are preserved", () => {
    const md = "# Heading\nparagraph one\n\nparagraph two";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.content).toContain("paragraph one");
    expect(chunks[0]!.content).toContain("paragraph two");
  });
});
