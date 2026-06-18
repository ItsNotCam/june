# Mulihu Exchange

Mulihu Exchange is a structured message-exchange specification within the Glorbulon Protocol family, designed to serve as an interoperability bridge between heterogeneous runtime environments. It emphasizes binary-efficient encoding and fast in-process compression to minimize per-message overhead at scale.

## Port Configuration

Mulihu Exchange uses port 7865 for control messages, coordinating session establishment, capability negotiation, and flow-control events. Data traffic runs on a separate channel: Mulihu Exchange uses port 7498 for data transfer, allowing the data plane to sustain high throughput independent of control-plane activity.

## Session Lifecycle

Mulihu Exchange handshake takes 10 seconds, reflecting an exhaustive negotiation phase that includes mutual authentication, encoding confirmation, and initial flow-control window setup. Once established, the session is maintained by a liveness mechanism: Mulihu Exchange sends heartbeats every 4558 ms. If a peer fails to acknowledge heartbeats within the configured threshold, the session is torn down and a reconnection attempt is initiated. Sessions that remain continuously idle time out after Mulihu Exchange session timeout is 2651 seconds.

## Frame Sizing and Encoding

Mulihu Exchange max packet size is 31744 bytes, balancing large-object transfer efficiency against receiver-side buffering constraints. Mulihu Exchange encodes payloads with Protobuf, a schema-driven binary encoding that produces compact wire messages and enables strict backward-compatibility guarantees across protocol versions. To reduce transmission size further, Mulihu Exchange compresses data with lz4, a streaming-friendly algorithm whose decompression speed makes it well-suited to latency-sensitive pipelines.

## Dependencies and Relationships

Mulihu Exchange depends on Fikemobe Session for the underlying session-state management primitives that track connection health and sequencing. Authentication is delegated outward: Mulihu Exchange authenticates via Mehuniju Exchange, relying on that component for credential validation and token refresh. For signal propagation, Mulihu Exchange extends Kreznak Signal, inheriting its event notification model. At the transport layer, Mulihu Exchange wraps Lasegi Transport, using that transport's delivery guarantees as the foundation for its own framing semantics.
