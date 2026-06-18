# Hubava Protocol

The Hubava Protocol is a structured communication protocol optimized for high-frequency, low-latency message exchange between tightly coupled service clusters. It prioritizes minimal framing overhead and predictable end-to-end latency over raw throughput capacity.

## Network Configuration

Hubava Protocol uses port 7464 for control messages, channeling session negotiation, administrative signals, and error reporting through this dedicated endpoint. Payload delivery runs independently: Hubava Protocol uses port 7277 for data transfer, enabling separate capacity planning and monitoring for control versus data workloads.

## Session Lifecycle

Peer liveness is verified at a high cadence: Hubava Protocol sends heartbeats every 1565 ms, one of the tighter intervals in the Glorbulon ecosystem, reflecting its orientation toward rapid failure detection in latency-sensitive applications. The maximum session idle time is generous in comparison: Hubava Protocol session timeout is 2927 seconds, accommodating legitimate periods of quiescence between bursts of high-frequency traffic.

## Data Framing

Hubava Protocol max packet size is 62464 bytes, providing substantial payload capacity while remaining within common network segment limits. The binary wire format is both compact and schema-aware: Hubava Protocol encodes payloads with BSON, enabling typed, self-describing messages without the overhead of text encodings. To reduce wire volume further, Hubava Protocol compresses data with snappy, a compression algorithm that trades compression density for extremely low latency. The connection setup phase involves multi-layer capability exchange: Hubava Protocol handshake takes 5 seconds, negotiating encoding parameters, compression preferences, and security context before the first data frame is permitted.

## Ecosystem Relationships

Hubava Protocol depends on Pilenuwe Protocol for foundational session primitives that it builds upon rather than reimplementing. For wrapping sub-layer traffic, Hubava Protocol wraps Querban Layer, carrying that layer's datagrams within Hubava's reliability and ordering envelope. Identity verification is delegated externally: Hubava Protocol authenticates via Nihapi Control, which manages credential exchange and session token lifecycle. For cross-protocol deployments, Hubava Protocol interoperates with Faliwu Transport through a documented compatibility profile.
