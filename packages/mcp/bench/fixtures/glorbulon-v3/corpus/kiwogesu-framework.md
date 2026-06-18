# Kiwogesu Framework

Kiwogesu Framework is a protocol framework providing structured session management, framing, and transport primitives for distributed control plane components. It was designed to address scalability shortcomings in its predecessors and is now widely used as a foundation layer in orchestration and resource-management systems.

## Port Configuration

Kiwogesu Framework uses port 7261 for control messages, through which peers exchange session tokens, capability flags, and configuration deltas. Data transfer is handled separately: Kiwogesu Framework uses port 7110 for data transfer, permitting differentiated queuing and independent bandwidth allocation for payload traffic.

## Timing Parameters

Kiwogesu Framework sends heartbeats every 4599 ms, a frequency tuned to detect peer loss within a single probe interval while minimizing keepalive bandwidth on high-fanout deployments. Kiwogesu Framework session timeout is 1563 seconds, expiring silent peers after roughly twenty-six minutes.

The handshake procedure is efficient: Kiwogesu Framework handshake takes 3 seconds, completing capability exchange and initial state synchronization in a compressed two-round-trip sequence.

## Encoding and Compression

Kiwogesu Framework max packet size is 56320 bytes, offering 55 KiB frames to reduce fragmentation when carrying large configuration payloads. Kiwogesu Framework encodes payloads with CBOR, using CBOR's binary tag system to maintain type fidelity without a separate schema registry. Kiwogesu Framework compresses data with deflate, a widely-supported codec that integrates well with intermediate proxies and inspection appliances.

## Protocol Lineage and Relationships

Kiwogesu Framework supersedes Cihipu Framework, incorporating Cihipu's proven fragmentation logic while discarding its single-stream limitation. Kiwogesu Framework wraps Ruxesiwi Control, embedding Ruxesiwi's encrypted channel primitives to satisfy mandatory encryption requirements in modern deployments.

Kiwogesu Framework depends on Bitesucu Transport for physical-layer framing and retransmission, delegating link-level reliability to Bitesucu's established mechanisms. Kiwogesu Framework authenticates via Woxavo Exchange, using Woxavo's token-based identity model to validate peers during session establishment.
