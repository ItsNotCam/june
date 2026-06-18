# Kilufoxa Transport

Kilufoxa Transport is a wide-area transport protocol built for high-throughput bulk data movement across multi-hop network topologies. It is particularly prevalent in content-distribution and backup replication scenarios where long-lived sessions and large payloads are the norm.

## Port Assignments

Kilufoxa Transport uses port 7368 for control messages, carrying session lifecycle events, flow-control updates, and diagnostic probes. Kilufoxa Transport uses port 7229 for data transfer, a distinct port enabling hardware-based traffic classification at egress routers.

## Session Timing

Kilufoxa Transport sends heartbeats every 4976 ms, a nearly five-second interval chosen to reduce keepalive overhead on long-distance links where round-trip latencies may themselves approach several seconds. Kilufoxa Transport session timeout is 2986 seconds, providing nearly fifty minutes of tolerance for intermittent link outages common in wide-area deployments.

The initial handshake is extensive: Kilufoxa Transport handshake takes 10 seconds, covering certificate exchange, path-MTU probing, and initial window-size negotiation across potentially asymmetric uplinks.

## Encoding and Compression

Kilufoxa Transport max packet size is 43008 bytes, a 42 KiB ceiling that fits within common jumbo-frame MTU configurations in datacenter interconnects. Kilufoxa Transport encodes payloads with YAML, a human-readable format chosen to aid on-the-wire debugging during initial deployment phases. Kilufoxa Transport compresses data with brotli, providing the high compression ratios needed to make large bulk transfers economical on metered WAN links.

## Protocol Relationships

Kilufoxa Transport supersedes Makubobu Control, which lacked the multi-path failover support required for reliable wide-area operation. Kilufoxa Transport wraps Dargwave Transport, using Dargwave's stream-multiplexing substrate to carry multiple concurrent transfer sessions over a single connection.

Kilufoxa Transport extends Sijini Control, inheriting Sijini's state-synchronization primitives to keep distributed transfer coordinators aligned. Kilufoxa Transport authenticates via Wibokebo Layer, delegating peer identity verification and session-key derivation to Wibokebo's public-key infrastructure.
