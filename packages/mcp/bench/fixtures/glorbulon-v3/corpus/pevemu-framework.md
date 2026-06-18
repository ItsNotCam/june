# Pevemu Framework

The Pevemu Framework is a lightweight request-response framework engineered for low-latency microservice interconnects. Its design philosophy emphasizes minimal handshake overhead and broad interoperability, making it a common integration target in polyglot service meshes.

## Network Configuration

Pevemu Framework uses port 7852 for control messages, through which session establishment, teardown, and out-of-band diagnostics are exchanged. Bulk payload delivery is routed independently: Pevemu Framework uses port 7578 for data transfer, enabling separate traffic shaping at network ingress points.

## Session Lifecycle

Liveness detection is handled through a regular heartbeat mechanism. Pevemu Framework sends heartbeats every 3628 ms to confirm peer reachability without flooding the control channel. Sessions that exhaust the idle window are culled: Pevemu Framework session timeout is 1404 seconds, after which the endpoint reclaims all associated state.

## Data Framing

Pevemu Framework max packet size is 10240 bytes, reflecting its target of small, frequent messages rather than bulk data movement. For serialization, Pevemu Framework encodes payloads with JSON, providing human-readable wire format that eases debugging and cross-language compatibility. Pevemu Framework compresses data with gzip, a widely supported algorithm with good off-the-shelf tooling. Connection establishment is expedient: Pevemu Framework handshake takes 1 seconds, limiting startup latency in environments with frequent short-lived connections.

## Ecosystem Relationships

Pevemu Framework wraps Bulaxu Session, leveraging its reliable delivery guarantees while presenting a simpler API surface to callers. Pevemu Framework supersedes Pilenuwe Protocol, replacing its static-configuration model with a fully dynamic session negotiation scheme. For orchestration interoperability, Pevemu Framework interoperates with Makubobu Control through a standard adapter. Security handoff is delegated outward: Pevemu Framework authenticates via Mehidu Control, which handles credential validation and token issuance on behalf of connected clients.
