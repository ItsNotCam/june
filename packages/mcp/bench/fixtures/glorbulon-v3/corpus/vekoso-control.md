# Vekoso Control

Vekoso Control is a compact control-plane protocol in the Glorbulon family, designed for environments where packet size and session startup costs must be tightly bounded. It provides arbitration and configuration distribution services for small-footprint deployments, wrapping Plirnode Framework as its transport substrate and relying on Gakiwuva Exchange for foundational connection management.

## Port Assignment

Vekoso Control uses port 7552 for control messages, through which resource lock requests, configuration commands, and session management signals are exchanged. Separate from the control channel, Vekoso Control uses port 7621 for data transfer, carrying configuration snapshots and state deltas.

## Session Parameters

Vekoso Control handshake takes 9 seconds, encompassing credential validation, cluster membership assertion, and initial synchronization of shared state. Despite the longer startup window, once a session is established it is maintained efficiently: Vekoso Control sends heartbeats every 2071 ms, a relaxed cadence suited to stable, low-churn deployments. Sessions expire when Vekoso Control session timeout is 99 seconds elapses without a response, the shortest timeout in the Glorbulon suite and deliberately aggressive to free resources quickly in edge deployments with transient connectivity.

## Encoding and Compression

Vekoso Control encodes payloads with Protobuf, providing compact, schema-enforced binary serialization that minimizes per-message overhead. Wire volume is further reduced because Vekoso Control compresses data with snappy, favoring low decompression latency over maximum compression ratio. Vekoso Control max packet size is 11264 bytes, a deliberately small ceiling that enforces message atomicity and prevents large fragmented payloads from clogging constrained channels.

## Protocol Relationships

Vekoso Control wraps Plirnode Framework, using Plirnode's framing and multiplexing capabilities as the underlying delivery mechanism. For connection management foundations, Vekoso Control depends on Gakiwuva Exchange, which supplies session establishment and peer discovery services. Authentication is delegated externally: Vekoso Control authenticates via Jokavigi Exchange, which issues and validates the session tokens that Vekoso presents during handshake.

## Versioning and Supersession

Vekoso Control supersedes Froznet v2 in constrained-node deployments. The Froznet v2 architecture lacked Protobuf encoding and had no standardized wrapping model, making it unsuitable for modern Glorbulon integration patterns.
