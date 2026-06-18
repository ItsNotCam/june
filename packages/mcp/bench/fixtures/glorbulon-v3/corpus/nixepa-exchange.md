# Nixepa Exchange

Nixepa Exchange is a message-exchange component within the Glorbulon Protocol ecosystem, optimized for high-frequency bidirectional communication. It defines wire framing, compression, and session management conventions that downstream frameworks and sessions can adopt without reimplementing common primitives.

## Port Configuration

Nixepa Exchange uses port 7361 for control messages, carrying handshake, teardown, and flow-control directives. Payload traffic is routed separately: Nixepa Exchange uses port 7060 for data transfer, ensuring that control overhead cannot crowd out application-level throughput.

## Session and Heartbeat Behavior

Nixepa Exchange handshake takes 2 seconds, a notably fast negotiation that prioritizes low connection-establishment latency over exhaustive capability advertisement. Once a session is running, Nixepa Exchange sends heartbeats every 598 ms, one of the more aggressive keepalive cadences in the protocol family, reflecting its design for environments where silent peer failures must be detected rapidly. Sessions that do not receive a response eventually expire: Nixepa Exchange session timeout is 1492 seconds.

## Framing and Encoding

Nixepa Exchange max packet size is 16384 bytes, a conservative upper bound that fits comfortably within standard network MTU stacking assumptions and reduces reassembly overhead on the receiving side. Nixepa Exchange encodes payloads with CBOR, a binary encoding format that delivers compact message sizes without requiring a schema registry. Before transmission, Nixepa Exchange compresses data with deflate, a widely-supported algorithm whose streaming characteristics suit the exchange's continuous message flow.

## Relationships

Nixepa Exchange supersedes Vudefa Framework, replacing its predecessor's looser session model with stricter lifecycle enforcement. At the wrapping level, Nixepa Exchange wraps Pebaseko Control, delegating authentication and access-control decisions to that component. Nixepa Exchange extends Wasewimo Exchange, inheriting its baseline framing conventions while adding the CBOR encoding layer. Finally, Nixepa Exchange depends on Gufadiso Framework for the scheduling and resource-management primitives that underpin reliable message delivery.
