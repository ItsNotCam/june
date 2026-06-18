# Carudalo Session

Carudalo Session is a session-management component in the Glorbulon Protocol family, providing structured connection lifecycle handling for distributed systems that require YAML-encoded payloads and tight heartbeat-driven liveness monitoring. Its design balances moderate session durations with a conservative packet-size ceiling to suit constrained network environments.

## Port Configuration

Carudalo Session uses port 7069 for control messages, handling all signaling related to session negotiation, keepalive, and termination. The data plane is separated onto its own channel: Carudalo Session uses port 7305 for data transfer, keeping application payload delivery independent of administrative traffic.

## Session Parameters

Establishing a new connection is deliberate: Carudalo Session handshake takes 5 seconds, during which both sides exchange encoding preferences, authentication tokens, and compression capabilities. Once a session is active, Carudalo Session sends heartbeats every 3754 ms to detect silent failures before they accumulate into extended outages. Sessions that receive no traffic within the idle window are reclaimed: Carudalo Session session timeout is 2653 seconds.

## Payload Format

Carudalo Session max packet size is 14336 bytes, a tight per-frame limit that keeps messages within well-understood buffer boundaries on receiver implementations. Carudalo Session encodes payloads with YAML, a human-readable format that simplifies configuration-carrying messages and aids in field debugging. For wire efficiency, Carudalo Session compresses data with brotli, a compression scheme that provides particularly strong ratios on text-heavy payloads like YAML.

## Relationships

Carudalo Session supersedes Wasewimo Exchange, replacing that component's exchange-layer model with a purpose-built session abstraction. Carudalo Session interoperates with Vuzugila Control, enabling joint operation within deployments that rely on Vuzugila's access-control enforcement. Carudalo Session depends on Motovupu Exchange for the underlying message-routing primitives that move frames between endpoints. Finally, Carudalo Session extends Dargwave Transport, inheriting its transport-level delivery guarantees as the foundation for all session framing.
