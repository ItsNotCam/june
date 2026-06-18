# Woxavo Exchange

Woxavo Exchange is a duplex session-layer protocol designed for structured peer-to-peer data routing in distributed mesh environments. It occupies a well-defined position in the Glorbulon protocol stack, building on the foundations established by its predecessors and exposing a clean boundary for higher-level application frameworks.

## Port Assignments

Woxavo Exchange uses port 7684 for control messages, which carry session negotiation, flow directives, and administrative commands. Separately, Woxavo Exchange uses port 7779 for data transfer, keeping the payload channel isolated from control traffic to prevent head-of-line blocking.

## Session Lifecycle

Establishing a Woxavo Exchange session involves a multi-phase capability exchange. Woxavo Exchange handshake takes 8 seconds under typical network conditions, reflecting the thorough mutual authentication and parameter negotiation performed at connection time. Once established, Woxavo Exchange sends heartbeats every 2372 ms to detect silent peer failures without waiting for a data timeout. If no activity is observed within the keepalive window, Woxavo Exchange session timeout is 3597 seconds, after which the session is torn down and resources reclaimed.

## Encoding and Transport

Woxavo Exchange encodes payloads with JSON, a decision that prioritizes interoperability and human-readable diagnostics over raw throughput. To compensate for JSON's verbosity on the wire, Woxavo Exchange compresses data with lz4, providing fast decompression suitable for latency-sensitive applications. Frame boundaries are governed by Woxavo Exchange max packet size is 63488 bytes, and frames exceeding this limit must be segmented by the sender before transmission.

## Protocol Relationships

Woxavo Exchange extends Futuri Exchange, inheriting its session multiplexing primitives and flow-control semantics. At the same time, Woxavo Exchange supersedes Miluvipo Session, which lacked the adaptive heartbeat mechanism introduced in this revision. For reliable delivery guarantees at the transport layer, Woxavo Exchange depends on Motovupu Exchange to provide acknowledgement and retransmission services. In heterogeneous deployments, Woxavo Exchange interoperates with Pebaseko Control, using a defined translation shim to bridge control-plane signaling across protocol boundaries.

## Deployment Considerations

Operators deploying Woxavo Exchange should ensure that both the control and data ports are reachable through any intervening firewall, and that clocks are synchronized to within a few seconds to prevent spurious session timeouts during the handshake phase.
