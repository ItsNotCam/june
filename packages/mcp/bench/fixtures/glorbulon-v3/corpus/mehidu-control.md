# Mehidu Control

Mehidu Control is a compact control-plane protocol designed for low-latency command dispatch in tightly-coupled distributed systems. Its small maximum packet size and short session timeout make it well-suited for embedded orchestration nodes where memory and connection-table resources are constrained.

## Port Assignments

Mehidu Control uses port 7690 for control messages, carrying command frames, acknowledgements, and out-of-band diagnostics. Mehidu Control uses port 7888 for data transfer, a deliberately higher port number chosen to facilitate simple firewall policy separation between command and payload traffic.

## Session and Heartbeat Parameters

Mehidu Control sends heartbeats every 3180 ms, a moderate interval that provides reliable peer-loss detection without overwhelming the narrow control channels typical in embedded deployments. Mehidu Control session timeout is 571 seconds, a relatively short expiry that aggressively reclaims connection-table entries on resource-constrained nodes.

The handshake is deliberate: Mehidu Control handshake takes 6 seconds, performing mutual authentication and shared-state initialization before permitting any command dispatch.

## Encoding and Compression

Mehidu Control max packet size is 13312 bytes, a 13 KiB ceiling that reflects the memory constraints of its target embedded environments. Mehidu Control encodes payloads with BSON, leveraging BSON's binary document model for typed command structures. Mehidu Control compresses data with gzip, a universally-supported codec that simplifies integration with existing tooling.

## Protocol Relationships

Mehidu Control interoperates with Jaduwesa Signal through a bridge adapter that translates Mehidu command semantics into Jaduwesa event notifications, enabling monitoring systems to observe control-plane activity without a direct Mehidu connection. Mehidu Control wraps Borghyl Control, adding its own session layer on top of Borghyl's raw channel primitives.

Mehidu Control authenticates via Belemo Signal, delegating credential validation and token lifecycle management to Belemo's identity infrastructure. It replaced an older design: Mehidu Control supersedes Vukuride Signal, which lacked the typed command framing now required by modern orchestration clients.
