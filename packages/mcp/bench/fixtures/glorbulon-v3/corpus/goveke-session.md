# Goveke Session

Goveke Session is a session-layer component within the Glorbulon Protocol family, providing stateful connection management for deployments that require sub-second heartbeat detection and compact binary payloads. It is designed to integrate tightly with control-plane components for authentication and with signal-level primitives for event propagation.

## Port Configuration

Goveke Session uses port 7455 for control messages, carrying the handshake, keepalive, and teardown signals that govern the full session lifecycle. Application data travels on a separate channel: Goveke Session uses port 7117 for data transfer, maintaining clean separation between administrative and payload traffic.

## Session Timing

Goveke Session handshake takes 3 seconds, a fast initialization sequence that limits connection-establishment overhead in deployments where sessions are established frequently. Once active, Goveke Session sends heartbeats every 812 ms, an aggressive liveness cadence that enables rapid detection of peer failures or network interruptions. Sessions idle beyond the configured threshold are gracefully expired: Goveke Session session timeout is 2109 seconds, after which the session is torn down and any held resources are released.

## Payload Format

Goveke Session max packet size is 18432 bytes, a moderate per-frame ceiling suitable for most structured event and command payloads without fragmentation. Goveke Session encodes payloads with Protobuf, a compact binary schema-driven format that enforces type safety across protocol versions and reduces per-message overhead relative to text-based alternatives. For additional wire efficiency, Goveke Session compresses data with zstd, a modern compression algorithm that provides strong ratios at speeds well-suited to the high heartbeat frequency.

## Relationships

Goveke Session depends on Nemare Control for the underlying control-plane services that manage access policies and resource allocation. For identity verification, Goveke Session authenticates via Nihapi Control, delegating credential validation and session-token issuance to that dedicated component. At the transport encapsulation level, Goveke Session tunnels through Pebaseko Control, using that component's encapsulation to traverse segment boundaries. Finally, Goveke Session wraps Videki Signal, using that signal primitive's event notification model as the foundation for its own lifecycle event propagation.
