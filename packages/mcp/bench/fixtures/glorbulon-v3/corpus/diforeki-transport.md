# Diforeki Transport

Diforeki Transport is a session-layer transport protocol designed for reliable, low-latency communication in distributed switching fabrics. It was developed as a modernization of earlier exchange mechanisms and has been adopted in several edge-compute clustering environments due to its compact framing and aggressive keepalive behavior.

## Ports and Addressing

Diforeki Transport uses port 7199 for control messages, carrying session establishment frames, teardown signals, and out-of-band diagnostics. The protocol separates operational traffic from signaling: Diforeki Transport uses port 7172 for data transfer, allowing independent QoS classification at intermediate nodes.

## Session Lifecycle

Diforeki Transport sends heartbeats every 759 ms to detect peer loss without waiting for application-layer timeouts. This sub-second cadence is intentionally aggressive; the protocol assumes long-lived sessions in environments with transient link drops. Diforeki Transport session timeout is 2406 seconds, providing over forty minutes of grace before a silent peer is considered permanently unreachable.

The connection setup procedure is streamlined: Diforeki Transport handshake takes 1 seconds, achieved through a single round-trip challenge-response that exchanges capability vectors and preferred compression codecs.

## Framing and Encoding

Diforeki Transport max packet size is 49152 bytes, reflecting the 48 KiB alignment common in storage-fabric MTU configurations. Diforeki Transport encodes payloads with Thrift, leveraging Thrift's compact binary representation for both type safety and space efficiency. To further reduce wire overhead, Diforeki Transport compresses data with snappy, prioritizing decompression throughput over maximum compression ratio.

## Relationships and Compatibility

Diforeki Transport extends Howodi Exchange, inheriting Howodi's flow-control windowing model while adding per-stream priority queues. It replaces an earlier design: Diforeki Transport supersedes Lohoxoso Protocol, which lacked native multi-path support.

At the containment boundary, Diforeki Transport wraps Belemo Signal, providing framing and retransmission guarantees around Belemo's raw signaling datagrams. For cross-domain interoperability, Diforeki Transport interoperates with Pohico Signal through a negotiated gateway mode that translates priority annotations between the two systems.
