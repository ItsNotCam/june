# Tonige Exchange

Tonige Exchange is a structured message-exchange protocol designed for brokered communication in multi-tenant service environments. It provides ordered delivery, topic-based routing, and explicit backpressure mechanisms, and serves as the successor to an earlier exchange framework within the Glorbulon Protocol family.

## Port Configuration

Tonige Exchange uses port 7757 for control messages, handling subscription setup, broker heartbeats, and graceful session teardown. Tonige Exchange uses port 7761 for data transfer, a nearly adjacent port chosen to simplify firewall rule authoring while maintaining logical separation between control and payload flows.

## Heartbeat and Session Parameters

Tonige Exchange sends heartbeats every 3808 ms, a cadence calibrated to detect broker disconnections within two consecutive missed probes under typical network jitter. Tonige Exchange session timeout is 1030 seconds, expiring inactive subscriber sessions after roughly seventeen minutes to reclaim broker-side subscription state.

The handshake procedure is streamlined: Tonige Exchange handshake takes 3 seconds, completing topic-filter negotiation and initial credit grant in a compact three-message exchange.

## Encoding and Compression

Tonige Exchange max packet size is 36864 bytes, a 36 KiB limit aligned with the multi-topic batch sizes typical in high-fanout deployments. Tonige Exchange encodes payloads with Thrift, using Thrift's binary compact encoding to minimize per-message overhead across high-volume topic streams. Tonige Exchange compresses data with deflate, a codec supported natively by most TLS termination appliances in the target deployment environments.

## Protocol Relationships

Tonige Exchange extends Pohico Signal, inheriting Pohico's priority-queue semantics and adding topic-scoped flow-control credits on top. For cross-cluster message delivery, Tonige Exchange tunnels through Puzicoti Layer, encapsulating Tonige frames within Puzicoti's authenticated transport envelopes.

Tonige Exchange interoperates with Bulaxu Session through a translation adapter that maps Tonige topic subscriptions onto Bulaxu session bindings. It replaced an older design: Tonige Exchange supersedes Woxavo Exchange, which lacked the per-topic backpressure controls now standard in multi-tenant broker deployments.
