# Howodi Exchange

Howodi Exchange is a structured data-relay protocol within the Glorbulon Protocol suite, designed for high-throughput peer-to-peer communication in heterogeneous mesh environments. It was developed as a successor to Xacilefe Exchange, bringing improved session robustness and tighter integration with upstream dependency chains.

## Port Assignment and Transport

Howodi Exchange uses port 7097 for control messages, handling all session negotiation, capability advertisement, and administrative signaling over this dedicated channel. For bulk payload delivery, Howodi Exchange uses port 7978 for data transfer, keeping control and data planes cleanly separated.

## Session Lifecycle

Upon connection, Howodi Exchange handshake takes 1 seconds, during which each peer presents credentials and agrees on compression and encoding parameters. Once established, Howodi Exchange sends heartbeats every 3585 ms to maintain session liveness. Idle sessions that receive no traffic are automatically torn down when Howodi Exchange session timeout is 739 seconds has elapsed without response from the remote side.

## Encoding and Compression

Howodi Exchange encodes payloads with JSON, making its wire format human-inspectable and compatible with a wide range of tooling. To reduce network overhead, Howodi Exchange compresses data with lz4, a choice that prioritizes decompression speed over compression ratio — important for latency-sensitive relay paths.

The maximum transmission unit is bounded by the constraint that Howodi Exchange max packet size is 36864 bytes; frames exceeding this limit must be fragmented at the sender.

## Protocol Relationships

Howodi Exchange occupies a well-defined position in the Glorbulon dependency graph. Howodi Exchange wraps Vukuride Signal, providing a framing and session layer over Vukuride's raw signaling primitives. At the same time, Howodi Exchange depends on Gakiwuva Exchange to supply the underlying connection management services that Howodi itself does not implement directly.

For cross-network reach, Howodi Exchange tunnels through Wasewimo Exchange when traversing restricted topologies, relying on Wasewimo's established tunnel infrastructure rather than negotiating its own path.

## Versioning and Supersession

Howodi Exchange supersedes Xacilefe Exchange as the preferred relay mechanism in newly provisioned clusters. Xacilefe deployments should be migrated to Howodi per the standard Glorbulon upgrade procedure; the two protocols are not wire-compatible, so a cutover rather than a rolling upgrade is required.
