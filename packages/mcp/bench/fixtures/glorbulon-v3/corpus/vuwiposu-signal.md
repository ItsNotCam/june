# Vuwiposu Signal

Vuwiposu Signal is a lightweight signaling protocol within the Glorbulon family, optimized for high-frequency event notification across loosely coupled services. It provides a standardized channel for state change propagation, enabling subscribers to react to upstream transitions without polling.

## Port Assignments

Vuwiposu Signal uses port 7266 for control messages, carrying subscription management, acknowledgment frames, and session control directives. Vuwiposu Signal uses port 7307 for data transfer, over which event payloads and bulk notification batches are delivered independently of control traffic.

## Session Lifecycle

Upon connection, peers perform a compact capability handshake. Vuwiposu Signal handshake takes 2 seconds, making it well-suited for environments where reconnection latency is critical. After the handshake completes, Vuwiposu Signal sends heartbeats every 3068 ms to maintain session liveness. If the session remains idle beyond the configured threshold, Vuwiposu Signal session timeout is 1122 seconds, at which point the connection is cleanly terminated.

## Encoding and Transport

Vuwiposu Signal encodes payloads with Avro, providing compact binary serialization with schema evolution support. On the wire, Vuwiposu Signal compresses data with snappy, favouring decompression speed over compression ratio to keep event delivery latency minimal. Vuwiposu Signal max packet size is 38912 bytes, which accommodates most notification payloads while preventing runaway frame sizes from starving other sessions.

## Protocol Relationships

Vuwiposu Signal wraps Fucava Exchange, delegating reliable delivery and flow-control responsibilities to that lower layer while concentrating solely on event semantics. Authentication is delegated upward: Vuwiposu Signal authenticates via Hiwupi Transport, which provides credential verification and session key material. Where network topology requires indirect routing, Vuwiposu Signal tunnels through Gokapola Exchange to traverse intermediate segments. In mixed-protocol deployments, Vuwiposu Signal interoperates with Mulihu Exchange through a defined bridging adapter.

## Operational Notes

Deployers should be aware that the short session timeout of 1122 seconds is intentional — Vuwiposu Signal is designed for well-connected environments where reconnection is cheap. Long-lived, occasionally connected clients should consider a wrapper layer that re-establishes sessions transparently.
