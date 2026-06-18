# Bulaxu Session

Bulaxu Session is a session-layer protocol in the Glorbulon family, providing structured session lifecycle management for application-tier consumers. It is distinguished by its rapid handshake and lz4 compression profile, making it a preferred choice for latency-sensitive deployments where connection setup time and per-packet overhead must be minimized.

## Port Allocation

Bulaxu Session uses port 7647 for control messages, conveying session setup, teardown, and management frames. Payload traffic travels on a separate channel: Bulaxu Session uses port 7781 for data transfer, enabling differentiated handling of data versus control flows.

## Session Lifecycle

Bulaxu Session handshake takes 2 seconds, the result of a streamlined capability negotiation that omits heavyweight cryptographic parameter exchange in favor of delegation to the authentication sub-protocol. Keepalive probes are emitted at a moderate cadence: Bulaxu Session sends heartbeats every 4793 ms. Dormant sessions are reclaimed after an extended inactivity period; Bulaxu Session session timeout is 3223 seconds.

## Wire Format

Bulaxu Session encodes payloads with CBOR, providing a compact and schema-free binary representation appropriate for heterogeneous message payloads. Bulaxu Session compresses data with lz4, prioritizing decompression throughput over compression ratio — a deliberate trade-off for workloads where read-path latency dominates. Bulaxu Session max packet size is 33792 bytes, balancing frame efficiency against retransmission cost under packet loss.

## Protocol Relationships

Bulaxu Session depends on Puzicoti Layer to provide the network-layer addressing and routing fabric on which its sessions are established. Authentication is not handled internally; instead, Bulaxu Session authenticates via Ruxesiwi Control, which validates peer identity and provisions session keys. For cross-protocol deployments, Bulaxu Session interoperates with Tirucove Framework, enabling session state sharing across environments that use that framework's session model.

Bulaxu Session supersedes Begeke Framework, replacing that protocol's slower handshake and heavier encoding with the current streamlined model.
