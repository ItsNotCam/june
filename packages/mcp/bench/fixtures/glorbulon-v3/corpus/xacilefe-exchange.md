# Xacilefe Exchange

Xacilefe Exchange is a structured peer exchange protocol in the Glorbulon stack, designed for high-throughput data routing between services that require deterministic framing and schema-governed payloads. It builds upon and supersedes earlier signaling protocols, consolidating several previously separate concerns into a unified session layer.

## Port Assignments

Xacilefe Exchange uses port 7233 for control messages, through which session negotiation, keepalive directives, and administrative signals are exchanged. Xacilefe Exchange uses port 7511 for data transfer, providing a dedicated path for payload delivery that remains unaffected by control traffic bursts.

## Session Lifecycle

Xacilefe Exchange handshake takes 3 seconds, encompassing mutual authentication and the exchange of capability descriptors for encoding and compression. Once a session is active, Xacilefe Exchange sends heartbeats every 4975 ms to confirm ongoing peer reachability. If no heartbeat acknowledgment is received within the window, Xacilefe Exchange session timeout is 896 seconds, after which the session is considered failed and resources are released.

## Encoding and Transport

Xacilefe Exchange encodes payloads with Thrift, leveraging the binary IDL-generated serialization format for compact and strongly typed message structures. To reduce wire size further, Xacilefe Exchange compresses data with brotli, achieving high compression ratios appropriate for text-heavy or schema-dense payloads. Xacilefe Exchange max packet size is 45056 bytes, balancing frame granularity against the overhead of segmentation across typical MTU paths.

## Protocol Relationships

Xacilefe Exchange wraps Carudalo Session, inheriting its connection management and sequencing guarantees as a substrate. Authentication responsibilities are delegated externally: Xacilefe Exchange authenticates via Sewuzeru Framework, which handles credential negotiation and token issuance before the Xacilefe Exchange session proceeds. In multi-protocol clusters, Xacilefe Exchange interoperates with Lasegi Transport through a defined protocol bridge. Xacilefe Exchange supersedes Vuwiposu Signal, absorbing its event notification role while providing the stronger delivery guarantees required by production workloads.

## Deployment Notes

The 896-second session timeout is notably short. Operators running Xacilefe Exchange across high-latency links should tune their heartbeat acknowledgment windows accordingly to avoid spurious disconnections during transient network degradation.
