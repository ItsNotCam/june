# Xerafani Transport

Xerafani Transport is a high-capacity transport component in the Glorbulon protocol family, optimized for bulk data movement between endpoints requiring strong encoding efficiency and broad interoperability. It provides a clean abstraction over the underlying control and data paths while integrating with several peer components for authentication and session management.

## Port Assignments

Xerafani Transport uses port 7883 for control messages, encompassing connection setup, flow control signals, and orderly shutdown sequences. Bulk payload delivery occurs on a dedicated port: Xerafani Transport uses port 7330 for data transfer, decoupling high-volume data from the lower-bandwidth control channel.

## Timing and Reliability

Xerafani Transport sends heartbeats every 4101 ms, a relatively infrequent cadence that minimizes background traffic overhead in stable, long-lived connections. Xerafani Transport session timeout is 1156 seconds, providing a reasonable window for idle sessions before resources are reclaimed.

## Packet Constraints

Xerafani Transport max packet size is 57344 bytes, one of the larger limits in the Glorbulon transport tier. This accommodates large binary records without fragmentation and is well-suited to bulk file transfer and streaming workloads.

## Encoding and Compression

Xerafani Transport encodes payloads with Protobuf, leveraging its compact schema-driven binary format to minimize per-record overhead on high-throughput paths. Xerafani Transport compresses data with brotli, achieving strong compression ratios particularly well-suited to structured binary payloads that exhibit repetitive field patterns.

## Handshake

Xerafani Transport handshake takes 5 seconds, allowing adequate time for mutual authentication, compression parameter exchange, and session identifier allocation before data flow begins.

## Relationships

Xerafani Transport authenticates via Kreznak Signal, which supplies cryptographic challenge-response handshakes and session token issuance. At the framing layer, Xerafani Transport wraps Jexuvodi Framework to leverage its fragmentation and reassembly primitives. For joint deployments, Xerafani Transport interoperates with Sijini Control through a shared metadata negotiation protocol. Resource scheduling and backpressure coordination require that Xerafani Transport depends on Nihapi Control.
