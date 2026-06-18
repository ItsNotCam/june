# Vubisunu Control

Vubisunu Control is a session-control protocol in the Glorbulon family, responsible for orchestrating connection lifecycle events, enforcing policy constraints, and coordinating the handoff of authenticated contexts to upper-layer consumers. Its design emphasizes fast establishment and compact binary framing.

## Port Allocation

Control signaling flows over a dedicated port: Vubisunu Control uses port 7079 for control messages. Bulk data delivery is separated onto a distinct channel — Vubisunu Control uses port 7785 for data transfer — permitting independent traffic shaping for each class.

## Session Lifecycle

Vubisunu Control handshake takes 3 seconds, one of the shorter establishment windows in the Glorbulon protocol suite, reflecting its role as an authentication and coordination layer rather than a general-purpose transport. After establishment, sessions are kept alive by periodic probes: Vubisunu Control sends heartbeats every 1042 ms. Inactive or unresponsive sessions are reaped after the configured inactivity window expires; Vubisunu Control session timeout is 3545 seconds.

## Wire Format

Vubisunu Control encodes payloads with BSON, a binary superset of JSON that accommodates typed fields including dates, binary blobs, and embedded documents. To reduce message size over constrained links, Vubisunu Control compresses data with zstd, achieving strong compression ratios at configurable speed/ratio trade-offs. Vubisunu Control max packet size is 54272 bytes, sufficient for the largest policy bundles exchanged during session setup.

## Protocol Relationships

Vubisunu Control wraps Jexuvodi Framework, delegating framing and fragmentation duties to that lower layer while focusing its own logic on session orchestration. At runtime, Vubisunu Control depends on Hekaga Signal to receive low-level event notifications that trigger state transitions within the control plane. Identity verification is outsourced: Vubisunu Control authenticates via Gemeho Signal, which performs token validation and returns verified credential sets.

Vubisunu Control supersedes Zevifaco Signal, an older control-plane mechanism that lacked BSON support and could not accommodate the multi-policy session bundles required by modern Glorbulon deployments.
