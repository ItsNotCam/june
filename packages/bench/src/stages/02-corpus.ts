// author: Claude
import { writeFile, mkdir } from "fs/promises";
import { resolve } from "path";
import type { Fact, FactsFile } from "@/types/facts";
import type { CorpusDocument, CorpusManifest } from "@/types/corpus";
import type { LlmProvider } from "@/providers/types";
import { CorpusAuthorOutputSchema } from "@/schemas/corpus";
import { renderPrompt } from "@/lib/prompts";
import { writeJsonAtomic, sha256Hex } from "@/lib/artifacts";
import { CorpusValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getConfig } from "@/lib/config";
import { BudgetMeter } from "@/lib/cost";
import { mapConcurrent } from "@/lib/concurrency";
import { normalizeForResolution } from "@/lib/normalize";

/**
 * Stage 2 — corpus generation (§16).
 *
 * Deterministically groups facts into documents, then asks the corpus-author
 * LLM to render each group as natural technical prose with every planted
 * `surface_hint` embedded verbatim. A post-generation validator rejects docs
 * missing any hint and retries with a tightened reprompt up to
 * `config.corpus.max_retries` (default 3). If a doc fails after the retry
 * budget, the run aborts with `CorpusValidationError` (exit code 1).
 *
 * The corpus author is an LLM — output is not byte-deterministic even at
 * temperature 0. Within a single fixture the corpus is frozen once
 * `corpus_manifest.json` is written; `compare` refuses to diff across
 * regenerations (I-EVAL-4).
 */
export const runStage2 = async (args: {
  facts: FactsFile;
  corpus_dir: string;
  manifest_path: string;
  provider: LlmProvider;
  model: string;
  max_tokens: number;
  budget: BudgetMeter;
  domain_theme: string;
}): Promise<CorpusManifest> => {
  const cfg = getConfig();
  const groups = groupFactsIntoDocuments(
    args.facts.facts,
    cfg.corpus.max_facts_per_doc,
  );

  await mkdir(args.corpus_dir, { recursive: true });

  // Respect role-1 concurrency — default 4, generates up to four docs in
  // parallel instead of one-at-a-time.
  const documents = await mapConcurrent(groups, cfg.roles.corpus_author.concurrency, (group, i) =>
    generateDocument({
      group,
      index: i,
      corpus_dir: args.corpus_dir,
      provider: args.provider,
      model: args.model,
      max_tokens: args.max_tokens,
      budget: args.budget,
      domain_theme: args.domain_theme,
      max_retries: cfg.corpus.max_retries,
    }),
  );

  const manifest: CorpusManifest = {
    fixture_id: args.facts.fixture_id,
    schema_version: 1,
    documents,
    corpus_author: { provider: args.provider.name, model: args.model },
  };
  await writeJsonAtomic(args.manifest_path, manifest);
  logger.info("stage.2.complete", {
    fixture_id: args.facts.fixture_id,
    document_count: documents.length,
    total_retries: documents.reduce((n, d) => n + (d.validator_attempts - 1), 0),
  });
  return manifest;
};

/**
 * Groups facts into documents deterministically (§16).
 *
 * Atomic facts sharing an `entity` go together; relational facts attach to
 * the document containing their `subject`. Each document is capped at
 * `max_facts_per_doc` facts — overflow spills into a sibling document.
 *
 * Deterministic given a fixed fact order — two runs of the same fixture
 * produce the same groupings even if the LLM later is non-deterministic.
 */
export const groupFactsIntoDocuments = (
  facts: readonly Fact[],
  max_facts_per_doc: number,
): Fact[][] => {
  const byEntity = new Map<string, Fact[]>();
  for (const f of facts) {
    const key = f.kind === "atomic" ? f.entity : f.subject;
    const arr = byEntity.get(key) ?? [];
    arr.push(f);
    byEntity.set(key, arr);
  }

  const groups: Fact[][] = [];
  for (const [, entityFacts] of byEntity) {
    for (let i = 0; i < entityFacts.length; i += max_facts_per_doc) {
      groups.push(entityFacts.slice(i, i + max_facts_per_doc));
    }
  }
  return groups;
};

const generateDocument = async (args: {
  group: Fact[];
  index: number;
  corpus_dir: string;
  provider: LlmProvider;
  model: string;
  max_tokens: number;
  budget: BudgetMeter;
  domain_theme: string;
  max_retries: number;
}): Promise<CorpusDocument> => {
  const entity = args.group[0]!.kind === "atomic"
    ? args.group[0]!.entity
    : args.group[0]!.subject;
  const slug = slugify(entity) + (args.index > 0 ? `-${args.index}` : "");
  const filename = `${slug}.md`;
  const absolute_path = resolve(args.corpus_dir, filename);
  const document_title = `${entity}: reference`;

  let missing: string[] = [];
  let markdown = "";
  let attempts = 0;

  for (; attempts < args.max_retries; attempts++) {
    const prompt = await renderPrompt("corpus-author", {
      domain_theme: args.domain_theme,
      document_title_suggestion: document_title,
      facts_json: JSON.stringify(args.group, null, 2),
    });
    const retryHint =
      attempts === 0
        ? ""
        : `\n\n[RETRY ${attempts + 1}] The previous output was missing these verbatim hints; include each exactly as written:\n${missing
            .map((m) => `- ${m}`)
            .join("\n")}`;

    const res = await args.provider.call({
      model: args.model,
      messages: [{ role: "user", content: prompt + retryHint }],
      max_tokens: args.max_tokens,
      temperature: 0,
      response_format: "json",
    });
    args.budget.record("role_1", res.cost_usd);

    const parsed = parseCorpusJson(res.text);
    if (!parsed) {
      missing = args.group.map((f) => f.surface_hint);
      continue;
    }

    markdown = parsed.markdown;
    // Normalize both sides the same way Stage 5's resolver will. A hint
    // that passes validation here is guaranteed to substring-match
    // `chunks.raw_content` at resolution time — drift between validator
    // and resolver is L5's exact failure mode.
    const normalizedMarkdown = normalizeForResolution(markdown);
    missing = args.group
      .filter((f) => !normalizedMarkdown.includes(normalizeForResolution(f.surface_hint)))
      .map((f) => f.surface_hint);

    if (missing.length === 0) break;
  }

  attempts = Math.min(attempts + 1, args.max_retries);

  if (missing.length > 0) {
    throw new CorpusValidationError(
      `Corpus document "${document_title}" is missing ${missing.length} surface hint(s) after ${args.max_retries} attempts`,
      document_title,
      args.group
        .filter((f) => missing.includes(f.surface_hint))
        .map((f) => f.id),
    );
  }

  await writeFile(absolute_path, markdown, "utf-8");
  const content_hash = sha256Hex(markdown);

  return {
    filename,
    absolute_path,
    document_title,
    planted_fact_ids: args.group.map((f) => f.id),
    validator_attempts: attempts,
    validator_status: "pass",
    content_hash,
  };
};

const parseCorpusJson = (text: string): { markdown: string } | null => {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence && fence[1]) candidates.push(fence[1].trim());

  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate);
      const result = CorpusAuthorOutputSchema.safeParse(obj);
      if (result.success) return { markdown: result.data.markdown };
    } catch {
      // fall through
    }
  }
  return null;
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
