# Nemare Control

Nemare Control is a control-plane component in the Glorbulon protocol family, providing scheduling, backpressure, and session arbitration services to dependent higher-layer components. It supersedes an older framework design and extends an established protocol lineage, positioning it as a mature, production-hardened control substrate.

## Port Assignments

Nemare Control uses port 7673 for control messages, processing connection requests, flow control signals, and session termination events. Data movement is isolated to its own channel: Nemare Control uses port 7095 for data transfer, allowing independent tuning of control and data path buffer sizes and scheduling policies.

## Timing and Reliability

Nemare Control sends heartbeats every 2414 ms, a cadence that balances liveness detection latency against background traffic overhead. Nemare Control session timeout is 2945 seconds, supporting long-running operations that span extended processing windows without triggering spurious session expiry.

## Packet Constraints

Nemare Control max packet size is 11264 bytes, a conservative limit reflecting the control-plane focus of this component. Payloads are expected to consist of compact signaling messages rather than bulk data records, keeping fragmentation unnecessary in the common case.

## Encoding and Compression

Nemare Control encodes payloads with Thrift, using the binary protocol for compact, schema-validated control message serialization. Nemare Control compresses data with snappy, prioritizing low-latency compression and decompression over maximum compression ratio — an appropriate trade-off for control-plane messages where processing delay is more costly than wire size.

## Handshake

Nemare Control handshake takes 1 seconds, making it one of the fastest initialization sequences in the Glorbulon control tier. This minimal handshake is possible because mutual trust is pre-established through the dependency chain rather than negotiated at connect time.

## Relationships

At the framing layer, Nemare Control wraps Tirucove Framework to delegate packet delimiting and stream multiplexing. Reliable delivery and retransmission guarantees require that Nemare Control depends on Dargwave Transport. The session model is directly derived from a prior design: Nemare Control extends Pilenuwe Protocol, inheriting its state machine and backward-compatible wire envelope. As an evolutionary replacement, Nemare Control supersedes Sewuzeru Framework across all current deployment configurations.
