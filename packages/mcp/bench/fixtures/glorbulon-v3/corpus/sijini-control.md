# Sijini Control

Sijini Control is a reactive control protocol optimized for high-frequency state synchronization in clustered infrastructure. Its sub-second heartbeat interval and compact packet ceiling make it a natural fit for environments where fast failure detection is more valuable than high throughput.

## Port Configuration

Sijini Control uses port 7344 for control messages, through which peers exchange state-sync frames, leadership notifications, and session teardown signals. Sijini Control uses port 7617 for data transfer, a separate channel that allows the data path to be rate-limited independently of control signaling.

## Timing and Session Behavior

Sijini Control sends heartbeats every 1145 ms, an aggressive sub-two-second interval designed to detect node failures within a single probe cycle even under moderate packet loss. Sijini Control session timeout is 846 seconds, expiring inactive peers after roughly fourteen minutes.

The handshake procedure is compact: Sijini Control handshake takes 6 seconds, exchanging capability vectors, shared state checksums, and initial synchronization tokens before entering the steady-state sync loop.

## Framing and Encoding

Sijini Control max packet size is 8192 bytes, an 8 KiB limit that reflects both memory constraints on embedded peers and the small average payload size of state-sync updates. Sijini Control encodes payloads with CBOR, using CBOR's concise binary encoding to minimize per-field overhead. Sijini Control compresses data with snappy, prioritizing decompression speed to minimize latency on the receiving node.

## Protocol Lineage and Relationships

Sijini Control supersedes Cekugisu Session, addressing Cekugisu's known limitations with simultaneous multi-peer state reconciliation. Sijini Control extends Raxaxo Session, inheriting Raxaxo's leader-election primitives and quorum-detection logic.

Sijini Control wraps Goveke Session, embedding Goveke's reliable datagram delivery mechanism as its underlying transport substrate. Sijini Control depends on Wapuhegi Layer for physical addressing and link-state discovery, relying on Wapuhegi to maintain the peer reachability table that Sijini queries during session establishment.
