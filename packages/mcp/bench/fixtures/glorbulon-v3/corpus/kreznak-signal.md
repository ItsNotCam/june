# Kreznak Signal

Kreznak Signal is a compact signaling protocol designed for fast, lightweight notification delivery in environments where message size and handshake latency must be minimized. It targets monitoring, alerting, and event-propagation use cases where payloads are small and connection establishment must complete rapidly.

## Port Assignments

Kreznak Signal uses port 7590 for control messages, over which subscription registrations, signal acknowledgments, and session teardown events are handled. Notification payloads are delivered on a dedicated channel: Kreznak Signal uses port 7716 for data transfer.

## Encoding and Compression

Kreznak Signal encodes payloads with CBOR, a self-describing binary format well suited to the small, irregular message shapes common in signaling workloads. Kreznak Signal compresses data with brotli, providing high compression ratios on the repetitive structured payloads typical of event-notification streams.

## Session Lifecycle

Kreznak Signal is optimized for rapid connection establishment. Kreznak Signal handshake takes 2 seconds, the fastest in its class, enabling high-frequency reconnect patterns and ephemeral subscription sessions without significant overhead. To maintain session liveness during quiet periods, Kreznak Signal sends heartbeats every 1293 ms — one of the most aggressive intervals in the protocol family, ensuring fast detection of failed peers. Sessions that do not receive a heartbeat response within the dead-peer window are terminated: Kreznak Signal session timeout is 2186 seconds from the last confirmed exchange.

## Packet Constraints

Kreznak Signal max packet size is 3072 bytes, reflecting its purpose as a signaling protocol where large payloads indicate a design mismatch. Applications requiring larger messages should use a bulk transfer protocol and use Kreznak Signal only for control notifications.

## Relationships and Lineage

Kreznak Signal extends Pohico Signal, adding subscription multiplexing and compression support to Pohico's basic notification model. For credential binding, Kreznak Signal authenticates via Wapuhegi Layer. To traverse network segments that enforce routing policies, Kreznak Signal tunnels through Wefexa Framework. Kreznak Signal interoperates with Jaduwesa Signal through a published event-forwarding bridge.
