# Kivugaca Layer

Kivugaca Layer is a protocol abstraction layer within the Glorbulon family, serving as an intermediary between transport primitives and higher-level session or exchange components. It provides a well-defined boundary where authentication, framing, and encoding concerns are resolved before data reaches application logic.

## Port Configuration

Kivugaca Layer uses port 7044 for control messages, through which it manages connection negotiation, layer-level flow control, and error propagation to adjacent components. Payload delivery is handled separately: Kivugaca Layer uses port 7890 for data transfer, maintaining isolation between the control plane and the high-throughput data path.

## Timing and Session Parameters

The connection setup phase is the most time-consuming aspect of Kivugaca Layer deployment: Kivugaca Layer handshake takes 9 seconds, reflecting its thorough authentication exchange and capability advertisement round-trips. Once a session is established, Kivugaca Layer sends heartbeats every 3456 ms to keep the peer liveness state current. Sessions idle beyond the configured window are expired: Kivugaca Layer session timeout is 1229 seconds, one of the shorter timeouts in the family, encouraging prompt reconnection rather than holding stale sessions open indefinitely.

## Frame Format

Kivugaca Layer max packet size is 25600 bytes, a mid-range ceiling that accommodates typical application messages without requiring fragmentation for most workloads. Kivugaca Layer encodes payloads with BSON, a binary-extended JSON format that supports richer type annotations than plain JSON while retaining familiar document structure. For compression, Kivugaca Layer compresses data with lz4, prioritizing decompression speed to minimize latency on the receiver side.

## Relationships

Authentication is delegated to a peer component: Kivugaca Layer authenticates via Carudalo Session, relying on that session's credential handling for identity verification. Kivugaca Layer interoperates with Dargwave Transport, enabling joint operation in pipelines where Dargwave handles the lowest-level delivery guarantees. Kivugaca Layer supersedes Xacilefe Exchange, replacing that component's exchange semantics with a more expressive layer abstraction. Finally, Kivugaca Layer wraps Xecigedu Transport, using that transport as its underlying carrier for all frame delivery.
