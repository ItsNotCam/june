# Puzicoti Layer

Puzicoti Layer is an intermediary abstraction layer in the Glorbulon Protocol family, positioned between transport-level delivery primitives and the session or exchange components that consume them. It standardizes frame sizing, encoding, and compression negotiation so that higher layers need not re-implement those concerns independently.

## Port Configuration

Puzicoti Layer uses port 7521 for control messages, handling connection setup directives, flow-control signals, and layer-level error reporting. The data plane is routed to a dedicated channel: Puzicoti Layer uses port 7409 for data transfer, keeping high-throughput payload delivery isolated from control-plane traffic.

## Handshake and Session Behavior

Puzicoti Layer handshake takes 10 seconds, a thorough initialization sequence covering mutual authentication, compression algorithm agreement, and initial window size negotiation. After a session is active, Puzicoti Layer sends heartbeats every 4130 ms to maintain peer liveness awareness and detect failures before they cause prolonged data stalls. Idle sessions are eventually expired: Puzicoti Layer session timeout is 2786 seconds, after which the layer releases connection state and signals dependent components to reconnect.

## Payload Framing

Puzicoti Layer max packet size is 39936 bytes, a generous per-frame ceiling that supports large document chunks and aggregated event payloads without requiring multi-frame reassembly for typical workloads. Puzicoti Layer encodes payloads with JSON, a human-readable format that simplifies in-flight inspection and logging at the layer boundary. To reduce wire size, Puzicoti Layer compresses data with deflate before transmission, a widely-supported algorithm that integrates cleanly with streaming decompressors on the receiving side.

## Relationships

Puzicoti Layer depends on Carudalo Session for the session-state management services it relies on to track connection health and sequencing. Puzicoti Layer supersedes Fajedo Layer, replacing that component's more limited frame model with a broader packet-size envelope and richer compression options. For authentication, Puzicoti Layer authenticates via Viznet Exchange, offloading credential handling and token validation to that dedicated exchange component. Puzicoti Layer extends Vunigijo Framework, inheriting that framework's resource lifecycle and scheduling primitives as the foundation for its own layer management.
