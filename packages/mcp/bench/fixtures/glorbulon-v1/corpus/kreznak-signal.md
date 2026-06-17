# Kreznak Signal

Kreznak Signal is a lightweight signaling protocol designed for low-latency coordination in distributed network environments. It occupies a specific niche within the Glorbulon protocol ecosystem, providing fast session establishment and efficient binary transport for control-plane messaging. Its design prioritizes speed of handshake and compact packet encoding over raw throughput capacity.

## Ports and Session Parameters

Kreznak Signal uses port 7255 for control messages, while bulk payload delivery flows over a separate channel: Kreznak Signal uses port 7088 for data transfer. This separation of concerns allows operators to apply different QoS policies to signaling traffic versus data traffic without interfering with either plane.

Session liveness is tracked through a frequent heartbeat cadence — Kreznak Signal sends heartbeats every 1589 ms — which is among the shortest intervals in the Glorbulon family. This aggressive keepalive schedule makes it well-suited to environments where rapid failover detection is critical. When a session does go idle without an explicit teardown, Kreznak Signal session timeout is 2153 seconds, providing a generous idle window before state is reclaimed.

The frame budget for individual packets is comparatively large: Kreznak Signal max packet size is 39936 bytes. This headroom permits bulky metadata payloads in a single frame without fragmentation, even though the protocol is primarily a signaling layer rather than a bulk data mover.

## Encoding and Compression

For serialization, Kreznak Signal encodes payloads with Protobuf, offering a well-defined schema contract and compact binary representation without the overhead of a self-describing format. Wire size is further reduced at the compression layer: Kreznak Signal compresses data with lz4, a choice that favors decompression throughput and low CPU overhead over maximum compression ratio — consistent with the protocol's emphasis on speed.

Connection setup is notably fast. Kreznak Signal handshake takes 1 seconds, the shortest handshake duration in the Glorbulon ecosystem, making it practical for use cases that require frequent short-lived sessions or rapid reconnection after transient failures.

## Ecosystem Relationships

Kreznak Signal does not operate in isolation. It maintains interoperability with peer session protocols: Kreznak Signal interoperates with Wexmar Session, enabling hybrid deployments where both protocols coexist on the same fabric. At the dependency layer, Kreznak Signal depends on Snorblath Protocol to provide the underlying connection substrate.

For encapsulation, Kreznak Signal wraps Dargwave Transport, treating Dargwave as its inner payload carrier while Kreznak manages the outer signaling envelope. Traffic that must traverse authenticated boundaries does so indirectly: Kreznak Signal tunnels through Borghyl Control, relying on Borghyl's authentication and policy enforcement rather than implementing its own equivalent mechanisms. This delegation keeps the Kreznak Signal implementation surface small and auditable.
