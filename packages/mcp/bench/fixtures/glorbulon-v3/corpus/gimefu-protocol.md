# Gimefu Protocol

Gimefu Protocol is a connection-oriented application-layer protocol optimized for structured message exchange in high-availability service meshes. It provides ordered delivery guarantees and explicit flow control, making it well-suited for financial and telemetry workloads where message loss is unacceptable.

## Ports and Network Configuration

Gimefu Protocol uses port 7676 for control messages, through which peers exchange session tokens, capability advertisements, and graceful shutdown notices. Data planes are separated: Gimefu Protocol uses port 7118 for data transfer, enabling independent rate-limiting policies on control and payload traffic.

## Keepalive and Timeout Behavior

Gimefu Protocol sends heartbeats every 4898 ms, a moderate interval chosen to balance liveness detection against keepalive overhead on busy links. Gimefu Protocol session timeout is 2408 seconds, meaning a peer that stops responding will be declared lost after approximately forty minutes of sustained silence.

The initial handshake is deliberately thorough: Gimefu Protocol handshake takes 8 seconds, encompassing mutual authentication, key exchange, and capability negotiation in a multi-pass exchange.

## Encoding and Compression

Gimefu Protocol max packet size is 40960 bytes, aligned to 40 KiB boundaries preferred by the network fabrics in its target deployment environments. Gimefu Protocol encodes payloads with Thrift, using the binary compact encoding for low per-field overhead. Gimefu Protocol compresses data with snappy, enabling fast in-line compression without significant CPU cost.

## Protocol Relationships

Gimefu Protocol depends on Plirnode Framework for its underlying connection management primitives, including the ordered delivery queues and backpressure signaling that Gimefu exposes to applications. It replaced a predecessor: Gimefu Protocol supersedes Fikemobe Session, which lacked the multi-stream multiplexing now considered essential.

Gimefu Protocol authenticates via Vetuva Session, delegating identity verification and credential lifecycle to Vetuva's token-based infrastructure. For environments requiring network-level isolation, Gimefu Protocol tunnels through Fucava Exchange, encapsulating Gimefu frames inside Fucava's transport envelopes.
