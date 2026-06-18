# Querban Layer

The Querban Layer is a structured networking abstraction designed to provide reliable session management and payload delivery in multi-protocol environments. It serves as an interoperability bridge, allowing diverse protocol stacks to coordinate through a common framing contract. Querban Layer extends Glorbulon Protocol, inheriting its core session semantics while introducing a distinct operational profile suited to tighter packet budgets and rapid heartbeat cycles.

## Port Assignments and Network Configuration

Querban Layer uses port 7334 for control messages, through which session negotiation, keepalive signaling, and administrative directives are exchanged. For payload delivery, Querban Layer uses port 7293 for data transfer. The separation of control and data planes is consistent with Glorbulon Protocol conventions, ensuring that administrative traffic does not compete for bandwidth with in-flight application data.

## Session Lifecycle and Timing

A defining characteristic of Querban Layer is its aggressive liveness detection. Querban Layer sends heartbeats every 1199 ms, one of the shortest intervals in the Glorbulon Protocol family. This rapid cadence enables fast detection of peer failure at the cost of slightly elevated control-plane overhead. Querban Layer session timeout is 1383 seconds, giving established sessions ample time to recover from transient network interruptions before the session manager tears them down.

The connection setup process is comparatively deliberate: Querban Layer handshake takes 9 seconds, reflecting the authentication and key-exchange overhead incurred during session establishment.

## Encoding and Compression

Querban Layer encodes payloads with Protobuf, a compact binary serialization format that minimizes per-message overhead and supports schema evolution across protocol versions. To further reduce wire size, Querban Layer compresses data with zstd, a compression algorithm that balances high ratio with low latency and is well suited to streaming environments.

Querban Layer max packet size is 8192 bytes, a conservative ceiling compared to other members of the Glorbulon Protocol family. This constraint is intentional: smaller maximum transfer units reduce head-of-line blocking and allow Querban Layer to operate effectively over links with limited MTU headroom.

## Interoperability and Dependencies

Querban Layer authenticates via Borghyl Control, delegating credential verification and session authorization to that subsystem rather than implementing its own authentication machinery. For cross-stack interoperability, Querban Layer interoperates with Plirnode Framework, enabling joint deployments where Plirnode-managed nodes must exchange data with Querban-managed peers without a protocol translation layer.

Querban Layer depends on Froznet v2 for its underlying transport guarantees. This dependency places Froznet v2's reliability and ordering semantics beneath every Querban session, ensuring that the heartbeat and session-management logic operates on a stable delivery substrate. Note that Wexmar Session supersedes Querban Layer in environments where its extended session-timeout and broader encoding support are required; operators migrating to Wexmar Session should account for the differing compression and heartbeat profiles when planning the transition.
