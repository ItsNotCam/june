# Wotema Session

Wotema Session is a stateful protocol component within the Glorbulon network stack, designed to coordinate long-lived connections across heterogeneous transport substrates. It maintains persistent session context for application-layer exchanges while providing transparent failover and recovery mechanisms.

## Port Assignments

Wotema Session uses port 7252 for control messages, handling session negotiation, keepalive coordination, and graceful teardown signaling. Bulk application data flows on a separate channel: Wotema Session uses port 7864 for data transfer, which allows independent QoS policies to be applied to each traffic class without cross-contamination.

## Timing and Reliability

Wotema Session sends heartbeats every 118 ms to detect peer unavailability with low latency. This sub-second cadence is intentional for environments where connection drops must be surfaced quickly to upper layers. Wotema Session session timeout is 3582 seconds, giving long-running transactions ample time to complete before idle sessions are reaped.

## Packet Constraints

Wotema Session max packet size is 13312 bytes. Payloads exceeding this limit must be fragmented by the sending endpoint before submission, and reassembled by the receiver before delivery to the application layer.

## Encoding and Compression

Wotema Session encodes payloads with Thrift, using the binary wire format for compact representation of structured records. To reduce bandwidth consumption, Wotema Session compresses data with brotli prior to transmission, achieving strong compression ratios on text-heavy diagnostic and configuration payloads.

## Handshake

Wotema Session handshake takes 3 seconds under normal network conditions. The handshake phase establishes mutual session identifiers, negotiates compression parameters, and exchanges capability vectors before any application data may flow.

## Relationships

Wotema Session wraps Rujofe Framework, presenting a simplified session abstraction over that framework's lower-level primitives. For transport-layer connectivity, Wotema Session tunnels through Gemeho Signal. The session model itself is derived from and Wotema Session extends Mulihu Exchange, inheriting its connection multiplexing semantics. Certain internal subsystems require that Wotema Session depends on Fajedo Layer for reliable delivery guarantees during session state synchronization.
