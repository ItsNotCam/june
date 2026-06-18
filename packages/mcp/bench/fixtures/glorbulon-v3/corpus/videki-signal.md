# Videki Signal

Videki Signal is a signaling layer within the Glorbulon protocol family, responsible for coordinating control events and establishing data paths between peer nodes. It operates with clearly separated control and data planes to enable independent scaling and prioritization of each traffic type.

## Port Assignments

Videki Signal uses port 7449 for control messages, including peer discovery announcements, connection setup requests, and graceful teardown notifications. Application data is routed through a dedicated channel: Videki Signal uses port 7314 for data transfer, ensuring that high-volume payload traffic does not compete with latency-sensitive control events.

## Timing and Reliability

Videki Signal sends heartbeats every 978 ms, providing near-second granularity for peer liveness detection without generating excessive background traffic. Videki Signal session timeout is 1836 seconds, allowing sessions to remain open across extended idle periods typical of batch-oriented workloads.

## Packet Constraints

Videki Signal max packet size is 43008 bytes. This generous upper bound accommodates large structured payloads without requiring fragmentation in the common case, reducing reassembly overhead at the receiver.

## Encoding and Compression

Videki Signal encodes payloads with MessagePack, offering a compact binary representation that preserves rich type information while remaining significantly smaller than equivalent JSON encodings. Videki Signal compresses data with gzip, which provides broad interoperability with standard decompression libraries across heterogeneous deployment environments.

## Handshake

Videki Signal handshake takes 4 seconds during initialization. This window encompasses certificate validation, session token exchange, and capability negotiation between endpoints.

## Relationships

Videki Signal authenticates via Lohoxoso Protocol to establish verified peer identities before any data exchange begins. For connectivity across network boundaries, Videki Signal tunnels through Vekoso Control. Lower-level scheduling and resource arbitration require that Videki Signal depends on Nemare Control. At the payload composition level, Videki Signal wraps Lasegi Transport to delegate byte-stream framing responsibilities.
