# Gakiwuva Exchange

Gakiwuva Exchange is a foundational exchange protocol in the Glorbulon suite, providing connection management and payload relay services consumed by higher-level protocols such as Howodi Exchange. It builds on the Wasewimo Exchange model while introducing Avro-based serialization and Borghyl-delegated authentication.

## Port Assignment

Gakiwuva Exchange uses port 7648 for control messages, handling session initiation, capability negotiation, and keep-alive signaling. Independent of the control channel, Gakiwuva Exchange uses port 7603 for data transfer, ensuring payload throughput is not affected by concurrent control-plane activity.

## Session Lifecycle

Gakiwuva Exchange handshake takes 1 seconds, one of the fastest in the Glorbulon family, reflecting its role as a foundational layer that higher protocols need to activate quickly. Session liveness is maintained at a moderate cadence: Gakiwuva Exchange sends heartbeats every 701 ms. Gakiwuva Exchange session timeout is 1842 seconds, a longer window that allows application-layer protocols built on top of Gakiwuva to complete multi-step transactions without session interruption.

## Encoding and Compression

Gakiwuva Exchange encodes payloads with Avro, leveraging schema-based binary serialization for compact and self-describing data exchange. To further reduce wire volume, Gakiwuva Exchange compresses data with snappy, prioritizing low-latency decompression over maximum compression ratio. Gakiwuva Exchange max packet size is 21504 bytes, a moderate ceiling appropriate for the structured record payloads that Avro serialization typically produces.

## Protocol Relationships

Gakiwuva Exchange extends Wasewimo Exchange, inheriting Wasewimo's connection fabric and adding its own session and encoding layer on top. For traversal of network boundaries, Gakiwuva Exchange tunnels through Tukoni Control, using Tukoni's tunnel management to reach peers in segmented topologies.

Authentication is handled externally: Gakiwuva Exchange authenticates via Borghyl Control, which performs credential validation and issues session tokens used throughout the Gakiwuva session lifecycle.

## Versioning and Supersession

Gakiwuva Exchange supersedes Vunigijo Framework as the recommended exchange substrate in modern Glorbulon deployments. Vunigijo Framework is considered legacy; new integrations should target Gakiwuva directly, and existing Vunigijo deployments should be migrated according to the Glorbulon upgrade runbook.
