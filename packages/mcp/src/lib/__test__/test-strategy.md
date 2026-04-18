# Markdown Chunker — Expected Output

## What a chunk looks like

Every chunk is a `MarkdownChunk`:

```ts
type MarkdownChunk = {
  content: string;
  breadcrumb: string[];
  source: string;
};
```

## `source`

The filename passed as the second argument to `chunkMarkdown(md, source)`. Set identically on every chunk produced from the same file. Throws if omitted.

## `breadcrumb`

An ordered list of heading texts from the root down to the heading that opens this chunk. Heading markdown syntax is stripped — `**bold**`, `_italic_`, `` `code` ``, and `[label](url)` are all reduced to plain text. The array is compact: skipped heading levels leave no `undefined` or empty gaps.

```
# Guide            → ["Guide"]
## Installation    → ["Guide", "Installation"]
### Prerequisites  → ["Guide", "Installation", "Prerequisites"]
```

When a new heading resets an ancestor level, all deeper entries are discarded:

```
# A → ## B → ### C → ## D   results in   ["A", "D"]  for the D chunk
```

Content that appears before the first heading gets an empty breadcrumb `[]`.

## `content`

The content string has two parts, separated by a blank line:

```
{breadcrumb path}

{body text}
```

### Breadcrumb path prefix

The breadcrumb entries joined by ` § ` (`MarkdownDelimiter`). For a root-level heading there is no delimiter — the prefix is just the heading text.

```
Guide                               ← single level, no §
Guide § Installation                ← two levels
Guide § Installation § Prerequisites  ← three levels
```

### Body text

The raw text content between this heading and the next heading of equal or higher level. The heading line itself is excluded. Code fences are preserved verbatim and their contents are never split into separate chunks — a `#` inside a fence is not a heading.

### Pre-heading content

Text before the first heading in the file produces a chunk whose `content` is the raw text with no prefix (breadcrumb is `[]`, so there is no path to prepend and no blank-line separator).

### Heading with no body

If a heading is immediately followed by another heading (or end of file), the chunk still exists. Its content is the prefix only — there is no body text after the blank line.

## Full example

Input (`guide.md`):

```markdown
# Guide

intro

## Installation

install content

### Steps

steps content
```

Output:

```ts
[
  {
    source: "guide.md",
    breadcrumb: ["Guide"],
    content: "Guide\n\nintro",
  },
  {
    source: "guide.md",
    breadcrumb: ["Guide", "Installation"],
    content: "Guide § Installation\n\ninstall content",
  },
  {
    source: "guide.md",
    breadcrumb: ["Guide", "Installation", "Steps"],
    content: "Guide § Installation § Steps\n\nsteps content",
  },
]
```
