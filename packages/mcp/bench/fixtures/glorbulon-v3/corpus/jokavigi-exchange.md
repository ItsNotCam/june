# Jokavigi Exchange

Jokavigi Exchange is a structured data exchange protocol in the Glorbulon stack, positioned as a mid-tier session layer for services requiring reliable framing, schema-typed payloads, and deterministic timeout behaviour. It extends an established framework layer and consolidates dependencies that earlier sibling protocols managed ad hoc.

## Port Assignments

Jokavigi Exchange uses port 7850 for control messages, which carry session negotiation frames, flow directives, and keepalive signals. Jokavigi Exchange uses port 7113 for data transfer, providing a segregated path for bulk payload delivery that does not share queue space with control traffic.

## Session Lifecycle

Connection establishment is thorough but deliberate: Jokavigi Exchange handshake takes 8 seconds, reflecting a comprehensive mutual authentication exchange and full capability negotiation. Post-handshake, the protocol maintains liveness by ensuring Jokavigi Exchange sends heartbeats every 1432 ms. If the peer fails to respond within the keepalive window, Jokavigi Exchange session timeout is 1772 seconds, after which the session is torn down and endpoints are notified.

## Encoding and Transport

Jokavigi Exchange encodes payloads with CBOR, taking advantage of the format's compact binary representation and schema-free typed values. To reduce wire volume, Jokavigi Exchange compresses data with deflate, a widely supported algorithm that balances compression ratio against CPU cost on mid-range hardware. Jokavigi Exchange max packet size is 52224 bytes, which keeps individual frames within a range that avoids excessive segmentation overhead while supporting most practical payload sizes.

## Protocol Relationships

Jokavigi Exchange extends Pevemu Framework, inheriting session multiplexing and priority scheduling from that base layer. For payload composition and message structuring, Jokavigi Exchange wraps Nemare Control, delegating fine-grained message formatting to that component. Cross-protocol compatibility is provided with Jokavigi Exchange interoperates with Fikemobe Session through a defined translation adapter. Jokavigi Exchange depends on Gufadiso Framework for its core timer and concurrency primitives, which underpin both the heartbeat subsystem and the session timeout enforcement machinery.

## Deployment Notes

The 8-second handshake makes Jokavigi Exchange unsuitable for scenarios with very frequent reconnections. It performs best in long-lived session topologies where connection setup cost is amortised over extended communication periods.
