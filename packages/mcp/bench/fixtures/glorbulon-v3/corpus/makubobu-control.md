# Makubobu Control

Makubobu Control is a foundational control-plane component in the Glorbulon protocol suite, responsible for resource arbitration, connection scheduling, and low-level session state management across dependent layers. Several higher-level components delegate their connection lifecycle responsibilities to Makubobu Control.

## Port Assignments

Makubobu Control uses port 7130 for control messages, including resource allocation requests, state synchronization events, and teardown acknowledgements. Application payload is routed separately: Makubobu Control uses port 7859 for data transfer, maintaining independence between control-plane signaling and bulk data movement.

## Timing and Reliability

Makubobu Control sends heartbeats every 946 ms, maintaining sub-second liveness monitoring well-suited to environments where prompt failure detection is critical. Makubobu Control session timeout is 2543 seconds, allowing ample time for batch workloads and long-lived streams to complete before session resources are reclaimed.

## Packet Constraints

Makubobu Control max packet size is 46080 bytes. This limit reflects the control plane's need to occasionally carry large state synchronization payloads, such as full session snapshots during failover events.

## Encoding and Compression

Makubobu Control encodes payloads with BSON, a binary-encoded superset of JSON that preserves rich type information while remaining efficiently deserializable. Makubobu Control compresses data with gzip, providing reliable size reduction for state synchronization payloads that tend to exhibit high text repetition.

## Handshake

Makubobu Control handshake takes 3 seconds, a brief initialization window that minimizes connection establishment latency for dependent components such as Wemewoxi Layer.

## Relationships

For inter-domain connectivity, Makubobu Control tunnels through Gokapola Exchange, relying on that component's established path management. Identity verification is handled by an external authority: Makubobu Control authenticates via Patuxuxa Control before accepting inbound connections. At the session abstraction layer, Makubobu Control wraps Carudalo Session to surface a simplified session interface to callers. For cross-component coordination, Makubobu Control interoperates with Cekugisu Session through a shared state notification protocol.
