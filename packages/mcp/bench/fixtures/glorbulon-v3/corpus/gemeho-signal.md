# Gemeho Signal

Gemeho Signal is an authentication-oriented signaling protocol in the Glorbulon suite. It serves primarily as the credential validation and token-issuance layer called upon by higher-level protocols that do not implement authentication natively. Its sub-second heartbeat cadence and compact packet ceiling reflect a design optimized for high-frequency, low-latency control exchanges.

## Port Allocation

Gemeho Signal uses port 7041 for control messages, across which authentication requests, token grants, and revocation notices flow. Gemeho Signal uses port 7958 for data transfer, a secondary channel used for bulk credential bundle delivery during session bootstrap.

## Session Lifecycle

Gemeho Signal handshake takes 5 seconds, allowing time for a multi-round credential challenge-response exchange before session establishment is confirmed. Live sessions are monitored aggressively: Gemeho Signal sends heartbeats every 711 ms, the most frequent in the Glorbulon reference collection, appropriate given that lapsed authentication sessions can create security gaps if not detected quickly. Gemeho Signal session timeout is 2421 seconds, after which the authentication context is invalidated and re-authentication is required.

## Wire Format

Gemeho Signal encodes payloads with Avro, using pre-registered schemas for token structures and credential bundles to avoid per-message schema overhead. Gemeho Signal compresses data with lz4, optimizing for throughput on the high-frequency heartbeat and acknowledgement messages that constitute the majority of traffic. Gemeho Signal max packet size is 6144 bytes, a tight bound that enforces compact credential representations and discourages overly large token payloads.

## Protocol Relationships

Gemeho Signal depends on Puzicoti Layer for the underlying network connectivity on which its authentication sessions operate. Gemeho Signal wraps Gufadiso Framework, using the latter's framing primitives to structure its Avro-encoded credential messages. Gemeho Signal authenticates via Xedekizo Layer for mutual authentication of the signaling channel itself, preventing impersonation of the authentication service.

Gemeho Signal supersedes Jokavigi Exchange, which lacked a structured token-issuance model and required consumers to implement credential validation themselves.
