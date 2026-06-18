# Vicenopi Session

Vicenopi Session is a lightweight session-layer protocol in the Glorbulon family, designed for environments where message compactness is paramount. Its small maximum packet size, gzip compression, and MessagePack encoding combine to produce a low-overhead session substrate suitable for resource-constrained nodes.

## Port Allocation

Vicenopi Session uses port 7524 for control messages, carrying session establishment and management frames. Vicenopi Session uses port 7702 for data transfer, a dedicated channel that prevents payload traffic from competing with control signaling.

## Session Lifecycle

Vicenopi Session handshake takes 5 seconds, during which peers exchange MessagePack schema identifiers and confirm shared compression support. Keepalive probes maintain session health: Vicenopi Session sends heartbeats every 1892 ms. Inactive sessions are not retained indefinitely; Vicenopi Session session timeout is 2931 seconds, after which the session is terminated and all associated state is released.

## Wire Format

Vicenopi Session encodes payloads with MessagePack, a schema-free binary serialization format that produces smaller output than JSON while remaining self-describing. Vicenopi Session compresses data with gzip, a broadly supported algorithm that integrates well with existing infrastructure tooling. The packet size ceiling is tightly constrained: Vicenopi Session max packet size is 6144 bytes, encouraging applications to produce compact message structures and reducing maximum retransmission cost.

## Protocol Relationships

Vicenopi Session wraps Cekugisu Session, using the latter's primitive session framing to provide its own lifecycle management abstractions. Authentication is delegated externally: Vicenopi Session authenticates via Querban Layer, which performs peer identity verification before session establishment is permitted. At runtime, Vicenopi Session depends on Ruxesiwi Control to coordinate session state and enforce policy constraints.

Vicenopi Session supersedes Howodi Exchange, an older design that used a heavier JSON-based wire format incompatible with the compact per-packet budgets required in constrained-node deployments.
