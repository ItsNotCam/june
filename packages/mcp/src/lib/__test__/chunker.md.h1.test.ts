import { describe, it, expect } from "bun:test";
import { chunkMarkdown } from "../chunker.md";
import { BREADCRUMB_DELIMITER } from "../chunker.types";

const D = BREADCRUMB_DELIMITER;

// ---------------------------------------------------------------------------
// h1-only splitting
// ---------------------------------------------------------------------------

describe("h1-only splitting", () => {
  it("produces one chunk when document has a single h1", () => {
    const chunks = chunkMarkdown("# Hello\nbody", "f.md");
    expect(chunks).toHaveLength(1);
  });

  it("produces two chunks when document has two h1s", () => {
    const chunks = chunkMarkdown("# First\nbody one\n# Second\nbody two", "f.md");
    expect(chunks).toHaveLength(2);
  });

  it("produces three chunks when document has three h1s", () => {
    const chunks = chunkMarkdown("# A\nbody\n# B\nbody\n# C\nbody", "f.md");
    expect(chunks).toHaveLength(3);
  });

  it("sets single-entry breadcrumb when document has one h1", () => {
    const chunks = chunkMarkdown("# First\nbody\n# Second\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["First"]);
    expect(chunks[1]!.breadcrumb).toEqual(["Second"]);
  });

  it("starts content with heading text as prefix when h1 is present", () => {
    const chunks = chunkMarkdown("# First\nbody\n# Second\nbody", "f.md");
    expect(chunks[0]!.content.startsWith("First")).toBe(true);
    expect(chunks[1]!.content.startsWith("Second")).toBe(true);
  });

  it("captures body text under the correct h1 when two h1s are present", () => {
    const chunks = chunkMarkdown("# First\nalpha\n# Second\nbeta", "f.md");
    expect(chunks[0]!.content).toContain("alpha");
    expect(chunks[0]!.content).not.toContain("beta");
    expect(chunks[1]!.content).toContain("beta");
    expect(chunks[1]!.content).not.toContain("alpha");
  });

  it("captures all lines of a multiline body under a single h1", () => {
    const md = "# Heading\nline one\nline two\nline three";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.content).toContain("line one");
    expect(chunks[0]!.content).toContain("line two");
    expect(chunks[0]!.content).toContain("line three");
  });

  it("produces a chunk with empty body when h1 is immediately followed by another h1", () => {
    const chunks = chunkMarkdown("# Empty\n# Next\nbody", "f.md");
    const empty = chunks.find(c => c.breadcrumb[0] === "Empty")!;
    expect(empty).toBeDefined();
    const body = empty.content.split("\n\n").slice(1).join("").trim();
    expect(body).toBe("");
  });

  it("separates prefix and body with a blank line when h1 has body content", () => {
    const chunks = chunkMarkdown("# Heading\nbody text", "f.md");
    expect(chunks[0]!.content).toBe("Heading\n\nbody text");
  });

  it("omits delimiter from content when document has only h1 chunks", () => {
    const chunks = chunkMarkdown("# One\nbody\n# Two\nbody", "f.md");
    expect(chunks[0]!.content).not.toContain(D);
    expect(chunks[1]!.content).not.toContain(D);
  });

  it("sets source on every chunk when document has multiple h1s", () => {
    const chunks = chunkMarkdown("# A\nbody\n# B\nbody", "guide.md");
    expect(chunks[0]!.source).toBe("guide.md");
    expect(chunks[1]!.source).toBe("guide.md");
  });

  it("preserves whitespace-only lines within body content", () => {
    const md = "# Heading\nparagraph one\n   \nparagraph two";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.content).toContain("paragraph one");
    expect(chunks[0]!.content).toContain("paragraph two");
  });

  it("preserves a very long heading text in breadcrumb without truncation", () => {
    const longHeading = "A".repeat(500);
    const chunks = chunkMarkdown(`# ${longHeading}\nbody`, "f.md");
    expect(chunks[0]!.breadcrumb).toEqual([longHeading]);
  });
});

// ---------------------------------------------------------------------------
// pre-heading content
// ---------------------------------------------------------------------------

describe("pre-heading content", () => {
  it("produces an extra chunk when text appears before the first heading", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    expect(chunks).toHaveLength(2);
  });

  it("places pre-heading chunk first when text appears before the first heading", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual([]);
  });

  it("captures pre-heading text verbatim in content when it appears before the first heading", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    expect(chunks[0]!.content).toBe("intro text");
  });

  it("sets source correctly on pre-heading chunk", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "readme.md");
    expect(chunks[0]!.source).toBe("readme.md");
  });

  it("omits delimiter from pre-heading chunk content", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    expect(chunks[0]!.content).not.toContain(D);
  });

  it("sets correct breadcrumb on heading chunk that follows pre-heading content", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    expect(chunks[1]!.breadcrumb).toEqual(["Heading"]);
  });

  it("excludes pre-heading text from heading chunk content when both are present", () => {
    const chunks = chunkMarkdown("intro text\n# Heading\nbody", "f.md");
    expect(chunks[1]!.content).not.toContain("intro text");
  });

  it("captures all lines of multiline pre-heading text in content", () => {
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
  it("treats #NoSpace as body text and produces a headingless chunk", () => {
    const chunks = chunkMarkdown("#NoSpace\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual([]);
    expect(chunks[0]!.content).toContain("#NoSpace");
  });

  it("places #NoSpace in pre-heading chunk when a real heading follows", () => {
    const chunks = chunkMarkdown("#NoSpace\n# Real\nbody", "f.md");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.breadcrumb).toEqual([]);
    expect(chunks[0]!.content).toContain("#NoSpace");
    expect(chunks[1]!.breadcrumb).toEqual(["Real"]);
  });

  it("trims trailing whitespace from heading text in breadcrumb", () => {
    const chunks = chunkMarkdown("# Hello   \nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });

  it("preserves numbers and punctuation in heading text in breadcrumb", () => {
    const chunks = chunkMarkdown("# 3. Introduction\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["3. Introduction"]);
  });

  it("produces a chunk when heading appears at end of file with no trailing newline", () => {
    const chunks = chunkMarkdown("# Heading", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Heading"]);
  });

  it("produces empty body when heading is at end of file with no trailing newline", () => {
    const chunks = chunkMarkdown("# Heading", "f.md");
    const body = chunks[0]!.content.split("\n\n").slice(1).join("").trim();
    expect(body).toBe("");
  });

  it("produces two chunks with identical breadcrumbs when duplicate h1 heading names appear", () => {
    const chunks = chunkMarkdown("# Introduction\nbody one\n# Introduction\nbody two", "f.md");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.breadcrumb).toEqual(["Introduction"]);
    expect(chunks[1]!.breadcrumb).toEqual(["Introduction"]);
  });

  it("isolates body text to the correct chunk when duplicate h1 heading names appear", () => {
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
  it("preserves source with path separators exactly on every chunk", () => {
    const chunks = chunkMarkdown("# A\nbody\n# B\nbody", "docs/guide.md");
    expect(chunks[0]!.source).toBe("docs/guide.md");
    expect(chunks[1]!.source).toBe("docs/guide.md");
  });

  it("preserves source with spaces exactly", () => {
    const chunks = chunkMarkdown("# Hello\nbody", "my file.md");
    expect(chunks[0]!.source).toBe("my file.md");
  });
});

// ---------------------------------------------------------------------------
// delimiter in body content
// ---------------------------------------------------------------------------

describe("delimiter in body content", () => {
  it(`preserves ${D} in body text verbatim without corrupting content`, () => {
    const chunks = chunkMarkdown(`# Heading\nbody with ${D} inside`, "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Heading"]);
    expect(chunks[0]!.content).toContain(`body with ${D} inside`);
  });

  it(`does not change chunk count when ${D} appears in body text`, () => {
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
  it("treats heading with 1 leading space as a valid heading", () => {
    const chunks = chunkMarkdown(" # Hello\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });

  it("treats heading with 2 leading spaces as a valid heading", () => {
    const chunks = chunkMarkdown("  # Hello\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });

  it("treats heading with 3 leading spaces as a valid heading", () => {
    const chunks = chunkMarkdown("   # Hello\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });
});

// ---------------------------------------------------------------------------
// tab as separator after #
// ---------------------------------------------------------------------------

describe("tab as separator after hash", () => {
  it("treats tab after # as a valid heading separator", () => {
    const chunks = chunkMarkdown("#\tTabbed Heading\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Tabbed Heading"]);
  });
});

// ---------------------------------------------------------------------------
// empty ATX heading text
// ---------------------------------------------------------------------------

describe("empty ATX heading text", () => {
  it("produces a headingless chunk when bare # has nothing after it", () => {
    const chunks = chunkMarkdown("#\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual([]);
  });

  it("produces a headingless chunk when # is followed by only a space", () => {
    const chunks = chunkMarkdown("# \nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// leading spaces in heading text
// ---------------------------------------------------------------------------

describe("leading spaces in heading text are stripped", () => {
  it("strips multiple spaces after # from breadcrumb text", () => {
    const chunks = chunkMarkdown("#   Hello\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });
});

// ---------------------------------------------------------------------------
// body content is raw — markdown is NOT stripped
// ---------------------------------------------------------------------------

describe("body content is preserved raw and not stripped like breadcrumb entries", () => {
  it("preserves bold markers in body text verbatim", () => {
    const chunks = chunkMarkdown("# Heading\n**bold text** in body", "f.md");
    expect(chunks[0]!.content).toContain("**bold text**");
  });

  it("preserves inline code in body text verbatim", () => {
    const chunks = chunkMarkdown("# Heading\nuse `someFunction()` here", "f.md");
    expect(chunks[0]!.content).toContain("`someFunction()`");
  });

  it("preserves link syntax in body text verbatim", () => {
    const chunks = chunkMarkdown("# Heading\nsee [link](https://example.com)", "f.md");
    expect(chunks[0]!.content).toContain("[link](https://example.com)");
  });
});

// ---------------------------------------------------------------------------
// hash characters inside heading text are preserved
// ---------------------------------------------------------------------------

describe("hash characters inside heading text are preserved", () => {
  it("preserves C# in breadcrumb when heading text contains C#", () => {
    const chunks = chunkMarkdown("# C# Programming\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["C# Programming"]);
  });

  it("preserves mid-text # in breadcrumb when heading text contains #", () => {
    const chunks = chunkMarkdown("# Why use # for comments?\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Why use # for comments?"]);
  });

  it("preserves C# in breadcrumb and captures body when heading is C# Guide", () => {
    const chunks = chunkMarkdown("# C# Guide\nbody text", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["C# Guide"]);
    expect(chunks[0]!.content).toContain("body text");
  });

  it("preserves multiple # inside heading text in breadcrumb", () => {
    const chunks = chunkMarkdown("# Use #tag and #other\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Use #tag and #other"]);
  });

  it("preserves ## inside heading text after the marker in breadcrumb", () => {
    const chunks = chunkMarkdown("# See ##double for details\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["See ##double for details"]);
  });

  it("strips trailing closing # but preserves C# when heading ends with C# #", () => {
    const chunks = chunkMarkdown("# C# #\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["C#"]);
  });
});

// ---------------------------------------------------------------------------
// regex special characters in heading text
// ---------------------------------------------------------------------------

describe("regex special characters in heading text", () => {
  it("preserves parentheses in breadcrumb when heading text contains them", () => {
    const chunks = chunkMarkdown("# Hello (World)\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello (World)"]);
  });

  it("starts content with parenthesised heading text when heading contains parentheses", () => {
    const chunks = chunkMarkdown("# Hello (World)\nbody", "f.md");
    expect(chunks[0]!.content.startsWith("Hello (World)")).toBe(true);
  });

  it("preserves dot in breadcrumb when heading text contains a dot", () => {
    const chunks = chunkMarkdown("# hello.exe\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["hello.exe"]);
  });

  it("preserves square brackets in breadcrumb when heading text contains them", () => {
    const chunks = chunkMarkdown("# Array[0]\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Array[0]"]);
  });

  it("preserves dollar sign in breadcrumb when heading text contains it", () => {
    const chunks = chunkMarkdown("# Price: $10.00\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Price: $10.00"]);
  });

  it("preserves curly braces in breadcrumb when heading text contains them", () => {
    const chunks = chunkMarkdown("# Config {key: value}\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Config {key: value}"]);
  });

  it("preserves pipe character in breadcrumb when heading text contains it", () => {
    const chunks = chunkMarkdown("# A | B\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["A | B"]);
  });

  it("preserves repeated heading word in body when heading text appears again in body", () => {
    const chunks = chunkMarkdown("# Introduction\nbody that mentions Introduction again", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Introduction"]);
    expect(chunks[0]!.content).toContain("mentions Introduction again");
  });

  it("preserves body reference to heading text when heading line also appears as body content", () => {
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
  it("sets source correctly when document has no headings at all", () => {
    const chunks = chunkMarkdown("just text, no headings", "plain.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.source).toBe("plain.md");
    expect(chunks[0]!.breadcrumb).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ATX closing hash sequences
// ---------------------------------------------------------------------------

describe("ATX closing hash sequences", () => {
  it("strips trailing # from breadcrumb when it is followed only by EOL", () => {
    const chunks = chunkMarkdown("# Hello #\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });

  it("strips trailing ### from breadcrumb when they are followed only by EOL", () => {
    const chunks = chunkMarkdown("# Hello ###\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello"]);
  });

  it("preserves # followed by a word in breadcrumb as it is not a closing sequence", () => {
    const chunks = chunkMarkdown("# Hello # World\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello # World"]);
  });

  it("preserves mid-text # followed by word and strips only the trailing # in breadcrumb", () => {
    const chunks = chunkMarkdown("# Hello # World #\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["Hello # World"]);
  });

  it("strips trailing # but preserves C# when heading text ends with C# #", () => {
    const chunks = chunkMarkdown("# C# #\nbody", "f.md");
    expect(chunks[0]!.breadcrumb).toEqual(["C#"]);
  });
});

// ---------------------------------------------------------------------------
// hash characters that are not headings
// ---------------------------------------------------------------------------

describe("hash characters that are not headings", () => {
  it("does not start a new chunk when hash appears mid-line in body text", () => {
    const chunks = chunkMarkdown("# Section\nSee note # 1 for details", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("See note # 1 for details");
  });
});

// ---------------------------------------------------------------------------
// blank-line-only pre-heading content
// ---------------------------------------------------------------------------

describe("blank-line-only pre-heading content", () => {
  it("produces no pre-heading chunk when only blank lines appear before first heading", () => {
    const chunks = chunkMarkdown("\n\n\n# Heading\nbody", "f.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.breadcrumb).toEqual(["Heading"]);
  });
});

// ---------------------------------------------------------------------------
// body content preservation
// ---------------------------------------------------------------------------

describe("body content preservation", () => {
  it("preserves internal blank lines within body content", () => {
    const md = "# Heading\nparagraph one\n\nparagraph two";
    const chunks = chunkMarkdown(md, "f.md");
    expect(chunks[0]!.content).toContain("paragraph one");
    expect(chunks[0]!.content).toContain("paragraph two");
  });

  it("preserves exact body text without leading or trailing whitespace added", () => {
    const chunks = chunkMarkdown("# Heading\nbody text", "f.md");
    expect(chunks[0]!.content).toBe("Heading\n\nbody text");
  });
});