# Tirucove Framework

Tirucove Framework is a mid-stack protocol framework in the Glorbulon Protocol family, coordinating message encoding, compression, and session lifecycle across the components it governs. It is frequently deployed in environments where Thrift-encoded service calls must traverse multiple network segments efficiently.

## Port Configuration

Tirucove Framework uses port 7964 for control messages, carrying the lifecycle signaling that governs session establishment, keepalive, and orderly teardown. Application payload delivery is routed to a distinct channel: Tirucove Framework uses port 7708 for data transfer, ensuring control-plane events cannot delay time-sensitive data frames.

## Handshake and Session Timing

Tirucove Framework handshake takes 9 seconds, a deliberate initialization window that allows both endpoints to complete mutual capability advertisement and encoding negotiation before any application frames are exchanged. Liveness is maintained continuously throughout the session: Tirucove Framework sends heartbeats every 3894 ms, with missed heartbeats triggering a graceful shutdown sequence. The session expiry window is Tirucove Framework session timeout is 2313 seconds, after which idle connections are released and their resources reclaimed.

## Payload Characteristics

Tirucove Framework max packet size is 20480 bytes, a moderate per-frame budget suited to service-call payloads and mid-sized document transfers. Tirucove Framework encodes payloads with Thrift, a compact binary encoding with built-in schema evolution support that facilitates rolling upgrades across heterogeneous service versions. Before transmission, Tirucove Framework compresses data with deflate, a streaming-compatible algorithm whose broad implementation support simplifies interoperability with third-party consumers.

## Relationships and Topology

For transport tunneling, Tirucove Framework tunnels through Kaxapi Layer, using that layer's encapsulation to traverse otherwise-incompatible network segments. Tirucove Framework depends on Cekugisu Session for the session-state management and heartbeat coordination that underpin reliable operation. Tirucove Framework extends Gokapola Exchange, inheriting that exchange's framing conventions as the baseline for its own message boundaries. Finally, Tirucove Framework supersedes Wemewoxi Layer, replacing that predecessor's limited session model with a more capable and configurable framework design.
