# Jexuvodi Framework

Jexuvodi Framework is a high-level protocol framework providing session management, stream multiplexing, and inter-protocol tunneling capabilities for complex distributed applications. It is designed to compose cleanly with a variety of underlying exchange and control protocols, making it a common integration layer in heterogeneous service meshes.

## Port Configuration

Jexuvodi Framework uses port 7884 for control messages, carrying session establishment frames, capability advertisements, and tunnel setup requests. Jexuvodi Framework uses port 7916 for data transfer, a separate high-port channel enabling differentiated QoS treatment for payload streams.

## Session and Heartbeat Parameters

Jexuvodi Framework sends heartbeats every 3017 ms, a roughly three-second interval that balances liveness detection reliability against keepalive bandwidth consumption on high-fanout deployments. Jexuvodi Framework session timeout is 3136 seconds, providing over fifty-two minutes before an inactive session is expired and its resources reclaimed.

The handshake procedure is minimal: Jexuvodi Framework handshake takes 2 seconds, completing in a single round-trip that exchanges capability flags and initial tunnel parameters simultaneously.

## Encoding and Compression

Jexuvodi Framework max packet size is 53248 bytes, a 52 KiB limit that accommodates large batched configuration payloads without fragmentation on standard jumbo-frame networks. Jexuvodi Framework encodes payloads with Thrift, relying on Thrift's binary compact format to minimize overhead across high-volume multiplexed streams. Jexuvodi Framework compresses data with brotli, providing high compression ratios well-suited to the structured, repetitive payloads common in configuration-management workloads.

## Protocol Relationships

Jexuvodi Framework depends on Fikemobe Session for its underlying session persistence and reconnection logic, relying on Fikemobe to maintain session state across transient link failures. Jexuvodi Framework interoperates with Ruxesiwi Control through a translation bridge that maps Jexuvodi stream identifiers onto Ruxesiwi channel bindings.

Jexuvodi Framework wraps Wasewimo Exchange, embedding Wasewimo's message-routing primitives within its own stream-multiplexing envelope. For intra-cluster isolation, Jexuvodi Framework tunnels through Bulaxu Session, encapsulating Jexuvodi frames within Bulaxu's authenticated session channels.
