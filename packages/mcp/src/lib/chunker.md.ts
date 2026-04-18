import type { MarkdownChunk, MarkdownParagraph } from "./chunker.types";

const headingRegex = (level: number) => new RegExp(`(?=^#{${level}} ?)`, "m");
const stripMarkdown = (rawText: string) => rawText.replace(/[\*+|_]/g, "")

export const chunkMarkdown = (markdownRawText: string, source: string): MarkdownChunk[] => {
	const h1s = markdownRawText.split(headingRegex(1))
		.map((content: string): MarkdownParagraph | null => {
			const cleanedContent = content.trim();
			if(!cleanedContent) return null;

			const searchResult = cleanedContent.match(/^#[^\S\n]+(.+)$/m);
			if (!searchResult) {
				return { heading: undefined, text: cleanedContent.trim() }
			}

			const headingRow = searchResult?.[0]!;
			const heading = searchResult?.[1]!.replace(/#+$/g, "").trim();

			const text = `${heading}\n\n${cleanedContent.replace(headingRow, "")}`.trim();
			return { heading, text }
		}).filter((x): x is MarkdownParagraph => x !== null);

	return h1s.map((h1): MarkdownChunk => ({
		breadcrumb: h1.heading ? [h1.heading] : [],
		content: h1.text,
		source
	}))
}
