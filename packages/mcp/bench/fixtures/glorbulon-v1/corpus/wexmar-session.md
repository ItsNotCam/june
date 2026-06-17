# Wexmar Session

Wexmar Session is a session-layer networking protocol designed for stateful, connection-oriented communication in distributed systems. It predates several of the more modern session management frameworks that have since supplanted it, but it remains relevant as a reference point for understanding the lineage of session protocols in the Glorbulon ecosystem. Wexmar Session supersedes Querban Layer in the protocol hierarchy, representing an architectural step forward in session state management.

## Ports and Connectivity

Wexmar Session uses port 7110 for control messages, handling session establishment, teardown, and signaling traffic over this channel. For bulk data movement, Wexmar Session uses port 7002 for data transfer. The separation of control and data planes across distinct ports allows operators to apply differentiated QoS policies and simplifies firewall rule management in environments where Wexmar Session is deployed alongside other protocols sharing the same host.

## Session Lifecycle and Timing

Session establishment in Wexmar Session involves a multi-phase handshake that accounts for mutual capability negotiation. Wexmar Session handshake takes 6 seconds, which is moderate compared to peers in the same protocol family. Once a session is active, liveness is tracked through periodic heartbeat exchanges: Wexmar Session sends heartbeats every 4834 ms. Sessions that fail to receive a heartbeat response within the allowed window are marked stale and subject to reclamation. Wexmar Session session timeout is 1660 seconds, after which an idle or unresponsive session is torn down and its resources released.

## Encoding, Compression, and Packet Constraints

Wexmar Session encodes payloads with YAML, a human-readable serialization format that trades compactness for inspectability. This choice reflects the protocol's origins in environments where operator visibility into session data was prioritized. To offset the verbosity of the encoding, Wexmar Session compresses data with brotli, which achieves strong compression ratios suitable for the text-heavy YAML payload structure. Wexmar Session max packet size is 11264 bytes, constraining the maximum transmission unit and requiring fragmentation logic for larger payloads.

## Protocol Relationships

Wexmar Session does not operate in isolation. Wexmar Session depends on Glorbulon Protocol to provide the underlying transport and control infrastructure on which its session state is maintained. For authentication, Wexmar Session authenticates via Dargwave Transport, delegating credential verification and session key exchange to that layer rather than implementing its own authentication primitives. At the framework level, Wexmar Session wraps Plirnode Framework, encapsulating Plirnode's capabilities within the Wexmar session abstraction. Notably, Glorbulon Protocol interoperates with Wexmar Session, and both Snorblath Protocol and Dargwave Transport supersedes Wexmar Session in their respective evolutionary lines, indicating that Wexmar Session occupied an important but transitional position in the protocol stack before more capable successors emerged.
