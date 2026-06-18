// author: Claude
import type { DomainTemplate } from "./types";
import type { AtomicFact, Fact, RelationalFact } from "@/types/facts";
import { pick, randInt, shuffle, type Rng } from "@/lib/rng";
import { DEFAULT_ENTITY_COUNT } from "@/lib/ids";

/**
 * v1's synthetic domain — a fictional network-protocol family (§15, Appendix A).
 *
 * Produces 80 atomic facts (10 protocols × 8 attributes) and 40 relational
 * facts (10 protocols × 4 relations each, drawn deterministically from the
 * Rng). Every fact's `surface_hint` is composed by template string — no LLM,
 * so the "verbatim" promise is a property of this module's output rather
 * than a wish about an LLM's behavior.
 *
 * **Nothing in this file corresponds to anything real.** Glorbulon, Froznet,
 * Snorblath, etc. are invented names; port numbers are drawn from the private
 * 7000–7999 range; codec and algorithm references (CBOR, zstd, etc.) are
 * real codec names used as factcheckable values, not claims about any real
 * protocol.
 */

const PROTOCOLS: readonly string[] = [
  "Glorbulon Protocol",
  "Froznet v2",
  "Snorblath Protocol",
  "Viznet Exchange",
  "Dargwave Transport",
  "Querban Layer",
  "Wexmar Session",
  "Plirnode Framework",
  "Borghyl Control",
  "Kreznak Signal",
];

const ENCODINGS: readonly string[] = [
  "CBOR",
  "MessagePack",
  "Protobuf",
  "JSON",
  "Avro",
  "Thrift",
  "BSON",
  "YAML",
];

const COMPRESSIONS: readonly string[] = [
  "gzip",
  "zstd",
  "lz4",
  "snappy",
  "brotli",
  "deflate",
];

const RELATIONS: readonly { predicate: string; sentence: (s: string, o: string) => string }[] = [
  { predicate: "depends_on", sentence: (s, o) => `${s} depends on ${o}` },
  { predicate: "interoperates_with", sentence: (s, o) => `${s} interoperates with ${o}` },
  { predicate: "supersedes", sentence: (s, o) => `${s} supersedes ${o}` },
  { predicate: "extends", sentence: (s, o) => `${s} extends ${o}` },
  { predicate: "wraps", sentence: (s, o) => `${s} wraps ${o}` },
  { predicate: "tunnels_through", sentence: (s, o) => `${s} tunnels through ${o}` },
  { predicate: "authenticates_via", sentence: (s, o) => `${s} authenticates via ${o}` },
];

/** Port number in `[7000, 8000)` drawn from the Rng — deterministic per seed. */
const portNumber = (rng: Rng): number => 7000 + Math.floor(rng() * 1000);

/** Integer in `[lo, hi]`. */
const intInRange = (rng: Rng, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));

const buildAtomicFacts = (rng: Rng, entities: readonly string[]): AtomicFact[] => {
  const out: AtomicFact[] = [];
  let counter = 1;
  const usedPorts = new Set<number>();

  const uniquePort = (): number => {
    for (let tries = 0; tries < 1000; tries++) {
      const p = portNumber(rng);
      if (!usedPorts.has(p)) {
        usedPorts.add(p);
        return p;
      }
    }
    throw new Error("Exhausted port pool while generating atomic facts");
  };

  for (const entity of entities) {
    const controlPort = uniquePort();
    const dataPort = uniquePort();
    const heartbeatMs = intInRange(rng, 100, 5000);
    const sessionTimeout = intInRange(rng, 30, 3600);
    const maxPacket = intInRange(rng, 1, 64) * 1024;
    const encoding = pick(rng, ENCODINGS)!;
    const compression = pick(rng, COMPRESSIONS)!;
    const handshakeSec = intInRange(rng, 1, 10);

    const mk = (attribute: string, value: string, sentence: string): AtomicFact => ({
      kind: "atomic",
      id: `f-atomic-${String(counter++).padStart(4, "0")}`,
      entity,
      attribute,
      value,
      surface_hint: sentence,
    });

    // Surface hints are deliberately period-free so the LLM can embed them
    // inside a sentence with its own punctuation: "Glorbulon Protocol uses
    // port 7733 for control messages, and port 7891 for data transfer."
    // A trailing period forces the LLM to end a sentence on the exact hint,
    // which rarely survives natural prose flow.
    out.push(
      mk(
        "control_port",
        String(controlPort),
        `${entity} uses port ${controlPort} for control messages`,
      ),
      mk(
        "data_port",
        String(dataPort),
        `${entity} uses port ${dataPort} for data transfer`,
      ),
      mk(
        "heartbeat_interval_ms",
        String(heartbeatMs),
        `${entity} sends heartbeats every ${heartbeatMs} ms`,
      ),
      mk(
        "session_timeout_s",
        String(sessionTimeout),
        `${entity} session timeout is ${sessionTimeout} seconds`,
      ),
      mk(
        "max_packet_size",
        String(maxPacket),
        `${entity} max packet size is ${maxPacket} bytes`,
      ),
      mk(
        "encoding",
        encoding,
        `${entity} encodes payloads with ${encoding}`,
      ),
      mk(
        "compression",
        compression,
        `${entity} compresses data with ${compression}`,
      ),
      mk(
        "handshake_duration_s",
        String(handshakeSec),
        `${entity} handshake takes ${handshakeSec} seconds`,
      ),
    );
  }

  return out;
};

const buildRelationalFacts = (rng: Rng, atomic: AtomicFact[]): RelationalFact[] => {
  const entities = Array.from(new Set(atomic.map((f) => f.entity)));
  const out: RelationalFact[] = [];
  let counter = 1;
  const usedPairs = new Set<string>();

  // Four relations per entity; deterministic object selection.
  for (const subject of entities) {
    const shuffledOthers = shuffle(rng, entities.filter((e) => e !== subject));
    const rels = shuffle(rng, RELATIONS).slice(0, 4);
    for (const rel of rels) {
      const object = shuffledOthers[out.length % shuffledOthers.length]!;
      const key = `${subject}|${rel.predicate}|${object}`;
      if (usedPairs.has(key)) continue;
      usedPairs.add(key);
      out.push({
        kind: "relational",
        id: `f-rel-${String(counter++).padStart(4, "0")}`,
        subject,
        predicate: rel.predicate,
        object,
        surface_hint: rel.sentence(subject, object),
      });
    }
  }

  return out;
};

// --- Synthetic entity scaling (entityCount > 10) ----------------------------
// Beyond the 10 hardcoded protocols, extra entities are minted as
// pronounceable nonsense names so a larger fixture (e.g. glorbulon-v3, 100
// entities) can be generated deterministically with NO LLM. The generator is
// invoked ONLY when entityCount > 10, so the default-10 path is byte-identical
// to v1/v2 (the main rng stream is never touched by name generation there).

const NAME_SUFFIXES: readonly string[] = [
  "Protocol", "Layer", "Framework", "Transport", "Session", "Control", "Signal", "Exchange",
];
const NAME_CONSONANTS = "bcdfghjklmnprstvwxz".split("");
const NAME_VOWELS = "aeiou".split("");

/**
 * Mints `n` byte-distinct, slug-distinct protocol names. Each name's leading
 * token is globally unique (tracked in a Set seeded with the 10 hardcoded
 * first-words), which guarantees both full-name and slug distinctness
 * regardless of the decorative suffix. Deterministic in `rng`.
 */
const generateProtocolNames = (rng: Rng, n: number): string[] => {
  const usedBases = new Set(PROTOCOLS.map((p) => p.split(" ")[0]!.toLowerCase()));
  const names: string[] = [];
  while (names.length < n) {
    const syllables = 3 + randInt(rng, 2); // 3–4 syllables → 6–8 letters
    let base = "";
    for (let i = 0; i < syllables; i++) {
      base += pick(rng, NAME_CONSONANTS)! + pick(rng, NAME_VOWELS)!;
    }
    if (usedBases.has(base)) continue;
    usedBases.add(base);
    const capped = base[0]!.toUpperCase() + base.slice(1);
    names.push(`${capped} ${pick(rng, NAME_SUFFIXES)!}`);
  }
  return names;
};

export const glorbulonProtocol: DomainTemplate = {
  name: "glorbulon-protocol",
  domain_name: "Glorbulon Protocol",
  generate: (rng: Rng, opts?: { entityCount?: number }) => {
    const entityCount = opts?.entityCount ?? DEFAULT_ENTITY_COUNT;
    // entityCount === 10 ⇒ exactly the hardcoded set, name generator NOT called
    // ⇒ byte-identical to the historical fixtures. Larger counts append minted
    // names (which draw from the same rng — fine, v3 is a fresh fixture).
    const entities =
      entityCount <= PROTOCOLS.length
        ? PROTOCOLS.slice(0, entityCount)
        : [...PROTOCOLS, ...generateProtocolNames(rng, entityCount - PROTOCOLS.length)];
    const atomic = buildAtomicFacts(rng, entities);
    const relational = buildRelationalFacts(rng, atomic);
    const facts: Fact[] = [...atomic, ...relational];
    return { facts };
  },
};
