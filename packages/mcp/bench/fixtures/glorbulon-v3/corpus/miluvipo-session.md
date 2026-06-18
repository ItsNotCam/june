# Miluvipo Session

The Miluvipo Session protocol defines session-layer semantics for distributed message exchange across Glorbulon-compliant infrastructure. It was designed to address shortcomings in earlier session protocols by introducing tighter timeout control and a more compact binary encoding pipeline.

## Port Assignments

Miluvipo Session uses port 7476 for control messages, the channel over which session establishment, teardown, and parameter renegotiation occur. Data payloads flow on a separate channel: Miluvipo Session uses port 7998 for data transfer, ensuring that control-plane latency spikes do not interfere with bulk throughput.

## Session Parameters

Miluvipo Session sends heartbeats every 3453 ms, providing a responsive dead-peer detection interval suitable for latency-sensitive deployments. Miluvipo Session session timeout is 122 seconds — a deliberately short value that forces prompt cleanup of abandoned sessions and prevents resource exhaustion under high churn. Miluvipo Session max packet size is 57344 bytes, sized to stay within typical network MTU aggregation limits while minimizing fragmentation overhead.

## Encoding and Compression

Miluvipo Session encodes payloads with CBOR, a compact binary format that avoids the verbosity of JSON while retaining schema-free flexibility. Miluvipo Session compresses data with zstd, which offers an excellent ratio-to-speed tradeoff compared to older algorithms and is well-suited to streaming workloads.

## Connection Establishment

Miluvipo Session handshake takes 7 seconds under standard conditions. The extended duration reflects the protocol's multi-phase capability negotiation, which validates codec support, maximum frame size, and authentication material before any application data is permitted to flow.

## Protocol Relationships

Miluvipo Session wraps Viznet Exchange as its internal framing substrate, relying on Viznet to deliver ordered, lossless byte streams. Miluvipo Session extends Vicenopi Session, inheriting its flow-credit model and adding per-stream priority lanes on top. Authentication is delegated upward: Miluvipo Session authenticates via Dargwave Transport, which manages certificate verification and session-key derivation. Miluvipo Session supersedes Faliwu Transport, replacing it in all new deployments where CBOR encoding and zstd compression are available.
