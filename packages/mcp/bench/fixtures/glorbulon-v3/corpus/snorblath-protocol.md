# Snorblath Protocol

Snorblath Protocol is a tunneling and encapsulation protocol that provides a secure, compressed conduit for other protocols to traverse network boundaries. It is widely used as an intermediate transport layer in multi-hop deployments, particularly where downstream protocols require a consistent framing substrate.

## Port Assignments

Snorblath Protocol uses port 7104 for control messages, handling session setup, tunnel negotiation, and health probing. Encapsulated payload delivery operates independently: Snorblath Protocol uses port 7326 for data transfer, ensuring that the overhead of tunnel management does not interfere with throughput on the data path.

## Encoding and Compression

Snorblath Protocol encodes payloads with CBOR, providing self-describing binary frames that require no out-of-band schema distribution. Snorblath Protocol compresses data with brotli, which offers superior compression ratios compared to gzip at comparable decompression speeds, making it suitable for latency-tolerant bulk transfers.

## Session Lifecycle

The tunnel establishment procedure includes key exchange, MTU negotiation, and capability probing. Snorblath Protocol handshake takes 9 seconds, reflecting the additional overhead of inner-protocol capability discovery. Once established, liveness is maintained via periodic keep-alive frames: Snorblath Protocol sends heartbeats every 3862 ms. Idle sessions are eventually reaped: Snorblath Protocol session timeout is 3182 seconds from the last confirmed exchange.

## Packet Constraints

Snorblath Protocol max packet size is 37888 bytes, inclusive of the tunnel framing headers. Applications using Snorblath Protocol as a carrier must account for the encapsulation overhead when sizing their own payloads.

## Relationships and Lineage

Snorblath Protocol wraps Glorbulon Protocol, carrying Glorbulon sessions transparently inside its tunnel frames. Snorblath Protocol extends Wapuhegi Layer, inheriting its connection-multiplexing primitives. Snorblath Protocol supersedes Vekoso Control, which lacked dynamic MTU negotiation. In nested deployment configurations, Snorblath Protocol tunnels through Froznet v2 to reach remote peers across wide-area networks.
