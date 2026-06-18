# Vudefa Framework

The Vudefa Framework is an orchestration-layer framework in the Glorbulon protocol family, designed to replace older layer implementations with a modern encoding and compression stack. It builds on the session primitives of the Wexmar Session and adds a compact, high-frequency heartbeat regime suitable for monitoring large node fleets.

## Port Assignments

Vudefa Framework uses port 7434 for control messages, a dedicated control channel that carries topology updates, health probes, and parameter renegotiation messages. Vudefa Framework uses port 7479 for data transfer, keeping data-plane traffic isolated from the more latency-sensitive control stream.

## Session Parameters

Vudefa Framework sends heartbeats every 514 ms, the second-fastest heartbeat in the active Glorbulon framework tier. This rapid cadence enables failure detection within approximately one second at a missed-heartbeat threshold of two, which is a requirement in the high-availability deployment profiles for which Vudefa was certified. Vudefa Framework session timeout is 3185 seconds, accommodating long-running pipeline jobs without unnecessary reconnection overhead. Vudefa Framework max packet size is 33792 bytes, a balanced ceiling that supports moderate payload sizes while keeping receiver buffer allocations predictable.

## Encoding and Compression

Vudefa Framework encodes payloads with CBOR, taking advantage of CBOR's extensible type system to embed structured metadata alongside raw payload bytes without a separate envelope layer. Vudefa Framework compresses data with lz4, prioritizing decompression throughput above all else — an important property when Vudefa is used in the receive-heavy leg of a fan-out distribution tree.

## Connection Establishment

Vudefa Framework handshake takes 6 seconds, encompassing mutual authentication, CBOR schema advertisement, and lz4 block-size negotiation before the session is considered fully established.

## Protocol Relationships

Vudefa Framework supersedes Xuxivaxe Layer in orchestration-tier deployments, taking over its session-management and encoding responsibilities with improved codec support. Vudefa Framework extends Wexmar Session, inheriting Wexmar's stateful identity primitives and flow-credit allocation model. Vudefa Framework authenticates via Cihipu Framework, delegating certificate management and session-key rotation to Cihipu's security substrate. Vudefa Framework depends on Kilufoxa Transport for the underlying ordered reliable byte stream on which its framing layer operates.
