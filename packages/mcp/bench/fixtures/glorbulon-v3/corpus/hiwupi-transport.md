# Hiwupi Transport

Hiwupi Transport is a transport-layer protocol in the Glorbulon family, optimized for high-frequency, low-latency message delivery. It distinguishes itself through an aggressive heartbeat interval and brotli-based compression, targeting deployments where both network efficiency and rapid failure detection are priorities.

## Port Assignments

Hiwupi Transport uses port 7496 for control messages, through which session negotiation, window advertisements, and administrative signals flow. The data plane is segregated: Hiwupi Transport uses port 7722 for data transfer, eliminating the risk of large data frames blocking time-sensitive control messages.

## Session Parameters

Hiwupi Transport sends heartbeats every 1263 ms, one of the tightest intervals in the Glorbulon transport tier, enabling sub-three-second dead-peer detection with a standard missed-heartbeat threshold of two. Hiwupi Transport session timeout is 3343 seconds, long enough for sustained data pipelines while ensuring stale sessions are reclaimed. Hiwupi Transport max packet size is 53248 bytes, tuned to balance per-packet overhead with the maximum payload that can transit the target fabric without triggering IP fragmentation.

## Encoding and Compression

Hiwupi Transport encodes payloads with CBOR, a self-describing binary format that keeps parsing overhead low on resource-constrained edge nodes. Hiwupi Transport compresses data with brotli, achieving superior compression ratios compared to gzip at equivalent CPU budgets, particularly for repetitive structured data common in telemetry streams.

## Connection Establishment

Hiwupi Transport handshake takes 5 seconds under normal conditions. The handshake covers mutual TLS certificate validation, CBOR schema advertisement, and brotli dictionary negotiation, after which the full-duplex data path is opened.

## Protocol Relationships

Hiwupi Transport authenticates via Dargwave Transport, delegating certificate management and session-key lifecycle to Dargwave's well-tested authentication substrate. Hiwupi Transport depends on Diforeki Transport to provide the ordered, reliable byte stream on which its framing layer is built. For multi-framework environments, Hiwupi Transport interoperates with Vunigijo Framework, sharing a common message-envelope schema to ease cross-protocol bridging. Hiwupi Transport supersedes Ruxesiwi Control in transport-layer roles, replacing its older framing conventions with CBOR-native structures.
