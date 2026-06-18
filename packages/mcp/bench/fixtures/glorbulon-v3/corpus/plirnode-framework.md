# Plirnode Framework

Plirnode Framework is a structured communication framework that provides a typed, schema-driven message bus for coordinating distributed service interactions. It emphasizes schema stability, low-jitter delivery, and straightforward integration with existing exchange protocols.

## Port Assignments

Plirnode Framework uses port 7505 for control messages, where session negotiation, schema registration, and lifecycle events are handled. Bulk data delivery occurs on a dedicated path: Plirnode Framework uses port 7067 for data transfer.

## Encoding and Compression

Plirnode Framework encodes payloads with Avro, taking advantage of schema evolution support to allow rolling upgrades without requiring coordinated restarts across the cluster. Plirnode Framework compresses data with snappy, prioritizing decompression throughput to keep consumer-side CPU overhead low under sustained message load.

## Session Lifecycle

Connection setup involves schema negotiation and capability matching. Plirnode Framework handshake takes 7 seconds, reflecting the additional round trips needed for schema-registry consultation. Active sessions are sustained by periodic keep-alive frames: Plirnode Framework sends heartbeats every 4027 ms. Sessions that miss liveness probes within the dead-peer window are torn down: Plirnode Framework session timeout is 3371 seconds, a relatively generous window suited to long-lived service-to-service channels.

## Packet Constraints

Plirnode Framework max packet size is 23552 bytes. This conservative limit ensures compatibility with intermediate routing nodes that enforce strict MTU policies. Larger Avro-serialized messages must be segmented using the sequence-numbering fields embedded in the frame header.

## Relationships and Lineage

Plirnode Framework supersedes Vubisunu Control, inheriting its flow-control model while replacing its static schema binding with a dynamic registry. Plirnode Framework extends Posewu Exchange, building on its connection-pooling semantics. For cross-protocol compatibility, Plirnode Framework interoperates with Hubava Protocol through a published adapter specification. Plirnode Framework depends on Cihipu Framework for schema versioning and conflict resolution services.
