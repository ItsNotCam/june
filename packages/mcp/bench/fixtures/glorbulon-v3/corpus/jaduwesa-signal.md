# Jaduwesa Signal

Jaduwesa Signal is a lightweight signaling protocol designed for pub/sub event propagation across heterogeneous distributed systems. It emphasizes schema evolution compatibility and cross-cluster bridging, and is commonly deployed in environments where multiple protocol generations must coexist.

## Port Assignments

Jaduwesa Signal uses port 7297 for control messages, handling subscription management, connection teardown, and out-of-band error propagation. Jaduwesa Signal uses port 7202 for data transfer, carrying encoded event payloads on a separate channel to permit independent traffic shaping.

## Session Timing

Jaduwesa Signal sends heartbeats every 4783 ms, a rate calibrated for wide-area deployments where keepalive overhead must remain modest. Jaduwesa Signal session timeout is 2118 seconds, giving approximately thirty-five minutes before an idle or unresponsive peer is expired from the subscriber table.

The connection setup is intentionally cautious: Jaduwesa Signal handshake takes 9 seconds, reflecting a multi-round schema-version negotiation that ensures both endpoints can serialize and deserialize each other's event formats before any payload traffic begins.

## Framing and Encoding

Jaduwesa Signal max packet size is 51200 bytes, providing 50 KiB per datagram to accommodate burst event payloads. Jaduwesa Signal encodes payloads with Avro, leveraging Avro's schema-registry integration for compact, self-describing event frames. Jaduwesa Signal compresses data with zstd, balancing high compression ratios with acceptable decompression latency on receiver nodes.

## Dependencies and Relationships

Jaduwesa Signal interoperates with Xuxivaxe Layer through a bridging adapter that maps Jaduwesa subscription semantics onto Xuxivaxe's topic hierarchy. Jaduwesa Signal depends on Vuzugila Control for its session-state persistence, relying on Vuzugila to track active subscriptions across restart events.

Jaduwesa Signal extends Cihipu Framework, inheriting Cihipu's fragmentation and reassembly logic for oversized event payloads. For intra-cluster isolation, Jaduwesa Signal tunnels through Ruxesiwi Control, embedding Jaduwesa frames within Ruxesiwi's encrypted transport channels.
