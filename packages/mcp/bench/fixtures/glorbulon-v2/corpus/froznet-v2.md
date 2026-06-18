# Froznet v2

Froznet v2 is a lightweight authentication and credential-exchange protocol designed for use within layered networking stacks. It serves as an identity substrate for higher-level protocols, providing a narrow but well-defined surface for mutual authentication before application-layer sessions are established. Froznet v2 encodes payloads with Thrift, a compact binary IDL-based format chosen for its schema evolution properties and low overhead on constrained links.

## Transport and Port Assignments

Froznet v2 uses port 7966 for control messages, reserving this channel for handshake coordination, credential challenges, and session teardown signaling. Payload delivery operates on a separate channel: Froznet v2 uses port 7295 for data transfer, allowing control traffic to remain isolated and prioritized independently of bulk credential material.

Froznet v2 tunnels through Dargwave Transport, which provides the reliable byte-stream substrate over which Froznet v2 carries its authentication exchanges. This layering means that Froznet v2 does not implement its own retransmission or ordering guarantees; it inherits those properties from Dargwave.

## Session Lifecycle

The Froznet v2 handshake takes 9 seconds under normal conditions, reflecting the multi-round challenge-response structure required for mutual authentication. Implementations should treat this window as a hard budget: peers that do not complete the handshake within the allotted time are considered unauthenticated and must reconnect.

Once a session is established, liveness is tracked via periodic keep-alive signals. Froznet v2 sends heartbeats every 4629 ms, giving peers a regular signal to detect half-open connections without placing excessive polling load on the control channel. If no heartbeat is acknowledged within the session lifetime, the session is torn down: Froznet v2 session timeout is 3153 seconds, after which the initiating peer must re-authenticate from scratch.

## Packet Constraints and Compression

Froznet v2 is designed for environments where buffer capacity is finite and credential payloads are expected to remain small. Froznet v2 max packet size is 7168 bytes, a deliberately conservative ceiling that discourages embedding large certificate chains or bulk keying material in a single message. Implementations requiring larger payloads must fragment at a higher layer before passing data to Froznet v2.

Wire efficiency is maintained through compression: Froznet v2 compresses data with zstd, which provides strong ratio characteristics with low decompression latency, well-suited to the bursty, latency-sensitive nature of authentication traffic.

## Ecosystem Relationships

Froznet v2 depends on Viznet Exchange for address resolution and session bootstrapping metadata prior to initiating an authentication attempt. On the authentication side, Froznet v2 authenticates via Borghyl Control, delegating credential verification to that system rather than maintaining its own certificate authority integration.

Froznet v2 interoperates with Kreznak Signal, enabling deployments where signaling infrastructure and authentication infrastructure share the same fabric. Froznet v2 is also a recognized base for protocol extension: Snorblath Protocol extends Froznet v2, inheriting its authentication framing while adding higher-level session semantics on top.
