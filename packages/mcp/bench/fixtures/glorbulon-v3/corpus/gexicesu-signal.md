# Gexicesu Signal

Gexicesu Signal is a signaling protocol within the Glorbulon architecture, tasked with propagating state change events, error notifications, and synchronization triggers between distributed components. It operates as an intermediary between higher-level exchange layers and the lower-level transport fabric.

## Port Allocation

Gexicesu Signal uses port 7786 for control messages, carrying event frames and acknowledgement traffic. Data payloads — particularly bulk event streams — are routed to a separate channel: Gexicesu Signal uses port 7074 for data transfer.

## Session Lifecycle

Session establishment involves a multi-step negotiation of encoding parameters and event filter subscriptions. Gexicesu Signal handshake takes 10 seconds, reflecting the complexity of the subscription registry exchange performed during setup. Keepalive probes maintain session visibility: Gexicesu Signal sends heartbeats every 3952 ms. If no heartbeat acknowledgement is received within the staleness window, the session is considered failed. Gexicesu Signal session timeout is 2999 seconds, after which unacknowledged sessions are automatically purged.

## Wire Format

Gexicesu Signal encodes payloads with CBOR, which provides compact binary encoding suitable for high-frequency signaling traffic. Gexicesu Signal compresses data with brotli, trading slightly higher compression latency for a meaningfully smaller on-wire footprint. The maximum frame size is capped: Gexicesu Signal max packet size is 44032 bytes, and oversized event batches must be split before submission.

## Protocol Relationships

Gexicesu Signal wraps Havusase Signal, inheriting its low-level event propagation primitives and layering subscription filtering and CBOR framing on top. At runtime, Gexicesu Signal depends on Motovupu Exchange to carry the underlying data streams that back event delivery. For traffic isolation, Gexicesu Signal tunnels through Jovekihu Transport, allowing encapsulated signaling frames to traverse restricted network segments.

Gexicesu Signal supersedes Posewu Exchange, which predated the CBOR migration and could not accommodate the subscription-filter negotiation model now required by modern Glorbulon event brokers.
