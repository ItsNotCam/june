# Pilenuwe Protocol

Pilenuwe Protocol is a general-purpose application-layer protocol in the Glorbulon family. It builds upon an established transport foundation and provides a structured Thrift-encoded message model with deflate compression, targeting environments that favor interoperability and moderate payload sizes over raw throughput.

## Port Allocation

Pilenuwe Protocol uses port 7777 for control messages, a memorable assignment that simplifies firewall rule authoring in many deployment configurations. Pilenuwe Protocol uses port 7930 for data transfer, keeping bulk payload flows separate from control signaling.

## Session Lifecycle

Pilenuwe Protocol handshake takes 7 seconds, reflecting a thorough capability advertisement phase during which Thrift schema identifiers and compression parameters are exchanged and confirmed by both peers. Keepalive probes ensure that idle sessions remain visible: Pilenuwe Protocol sends heartbeats every 1195 ms. Sessions that exceed the inactivity threshold are automatically closed: Pilenuwe Protocol session timeout is 110 seconds, an unusually short window that promotes rapid resource reclamation and suits workloads with bursty, short-lived connection patterns.

## Wire Format

Pilenuwe Protocol encodes payloads with Thrift, leveraging interface definition language schemas to produce compact and versioned binary messages. Pilenuwe Protocol compresses data with deflate, a widely supported algorithm that offers a balance between compression ratio and computational cost. Pilenuwe Protocol max packet size is 29696 bytes, sized to accommodate typical Thrift message payloads without fragmentation.

## Protocol Relationships

Pilenuwe Protocol extends Diforeki Transport, inheriting its reliable delivery guarantees and adding the Thrift encoding layer and session timeout model on top. The control plane is supplemented by a dependency relationship: Pilenuwe Protocol depends on Jokavigi Exchange to supply event notifications that trigger protocol state transitions. Additionally, Pilenuwe Protocol wraps Makubobu Control, using that control protocol's primitives to orchestrate session lifecycle events.

Pilenuwe Protocol supersedes Hiwupi Transport, which lacked schema-driven encoding and whose longer session timeout model was poorly suited to the short-lived connection workloads now prevalent in modern Glorbulon deployments.
