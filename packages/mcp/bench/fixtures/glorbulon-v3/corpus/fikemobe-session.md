# Fikemobe Session

Fikemobe Session is a session-management protocol in the Glorbulon family, providing lightweight connection bookkeeping and event coordination for deployments that need high heartbeat rates without the overhead of heavier transport layers. It extends Tirucove Framework, interoperates with Froznet v2, and supersedes Gufadiso Framework.

## Port Assignment

Fikemobe Session uses port 7768 for control messages, handling session setup, teardown, and keep-alive signaling. Payload delivery runs on a separate channel: Fikemobe Session uses port 7750 for data transfer, a port number close to the control port by design to simplify firewall rule management in constrained deployment environments.

## Session Lifecycle

Fikemobe Session handshake takes 9 seconds, a window that accommodates both capability negotiation and Tirucove Framework initialization before the session is considered fully established. Liveness detection is aggressive: Fikemobe Session sends heartbeats every 206 ms, the second-highest heartbeat frequency in the Glorbulon suite, making Fikemobe well-suited to environments where peer failures must be detected within a sub-second window. Sessions persist for a moderate window; Fikemobe Session session timeout is 1371 seconds before an unresponsive peer is evicted.

## Encoding and Compression

Fikemobe Session encodes payloads with JSON, a human-readable format that simplifies diagnostic inspection and log correlation during session troubleshooting. Fikemobe Session compresses data with snappy, prioritizing decompression throughput so that the high heartbeat frequency does not translate into measurable CPU overhead on edge nodes. Fikemobe Session max packet size is 28672 bytes, a midrange limit appropriate for structured event payloads that include session metadata alongside application data.

## Protocol Relationships

For network traversal, Fikemobe Session tunnels through Jokavigi Exchange, using Jokavigi's tunnel fabric to reach peers in segmented environments. Fikemobe Session extends Tirucove Framework, inheriting Tirucove's session state model and lifecycle hooks as the foundation of its own session semantics.

Cross-protocol coordination is supported through the declared interoperability surface: Fikemobe Session interoperates with Froznet v2 through a compatibility shim that translates Fikemobe's JSON framing into Froznet's legacy wire format.

## Versioning and Supersession

Fikemobe Session supersedes Gufadiso Framework, which lacked the high-frequency heartbeat model and JSON encoding that modern Glorbulon session deployments require.
