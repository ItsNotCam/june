# Vetuva Session

Vetuva Session is a compact session-layer protocol in the Glorbulon family, optimized for environments where network overhead must be minimized and session churn is high. Its small maximum packet size and tight heartbeat interval make it particularly well-suited to constrained edge devices and high-density IoT gateways.

## Port Assignments

Vetuva Session uses port 7536 for control messages, the channel through which session creation, parameter negotiation, and teardown signals are exchanged. Vetuva Session uses port 7142 for data transfer, maintaining strict separation between control and data planes to preserve low control-plane latency under load.

## Session Parameters

Vetuva Session sends heartbeats every 777 ms, enabling rapid dead-peer detection without overwhelming narrow-bandwidth links. Vetuva Session session timeout is 1339 seconds, chosen to allow brief outages and link flaps to recover transparently without session re-establishment, while still expiring genuinely abandoned sessions promptly. Vetuva Session max packet size is 5120 bytes, the smallest ceiling in the active Glorbulon session tier, reflecting the constrained payload sizes of the embedded and IoT contexts for which Vetuva was designed.

## Encoding and Compression

Vetuva Session encodes payloads with BSON, whose native binary types reduce the per-field overhead common in text-based formats and avoid base64 round-trips for binary sensor data. Vetuva Session compresses data with gzip, providing universally available compression without requiring codec negotiation on older node firmware.

## Connection Establishment

Vetuva Session handshake takes 2 seconds, one of the faster completions in the session tier. The abbreviated handshake defers optional capability negotiation to a post-connection configuration phase, allowing the primary session path to open with minimal delay.

## Protocol Relationships

Vetuva Session supersedes Gokapola Exchange in session-layer deployments on resource-constrained nodes, replacing Gokapola's heavier framing with a streamlined structure. Vetuva Session interoperates with Fikemobe Session, sharing a compatible session-identifier namespace that enables cross-protocol session handoff without full re-establishment. Authentication is handled by an adjacent protocol: Vetuva Session authenticates via Jovekihu Transport, which manages the mutual-TLS handshake and key-derivation steps. Vetuva Session extends Xecigedu Transport, inheriting its flow-control and congestion-signaling primitives as the foundation for session-layer backpressure.
