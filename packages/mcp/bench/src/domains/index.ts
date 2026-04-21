// author: Claude
import type { DomainTemplate } from "./types";
import { glorbulonProtocol } from "./glorbulon-protocol";

/**
 * Registry of built-in domain templates.
 *
 * v1 ships one (`glorbulon-protocol`). Operators who want to try their own
 * drop a `DomainTemplate` module into `src/domains/` and register it here
 * — the bench refuses unknown domain names at Stage 1.
 */
const TEMPLATES: Readonly<Record<string, DomainTemplate>> = {
  "glorbulon-protocol": glorbulonProtocol,
};

export const getDomainTemplate = (name: string): DomainTemplate | undefined =>
  TEMPLATES[name];

export const listDomainNames = (): string[] => Object.keys(TEMPLATES);

export type { DomainTemplate } from "./types";
