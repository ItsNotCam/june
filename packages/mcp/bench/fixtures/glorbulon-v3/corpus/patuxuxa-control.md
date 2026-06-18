# Patuxuxa Control

Patuxuxa Control is a control-plane protocol within the Glorbulon family, specializing in lightweight orchestration of distributed node state. Its design prioritizes fast handshake completion and compact framing, making it a common choice for control-intensive topologies where data volumes are modest but message rates are high.

## Port Assignments

Patuxuxa Control uses port 7320 for control messages, through which topology updates, health probes, and configuration directives are routed. Patuxuxa Control uses port 7683 for data transfer, providing a dedicated path for small payload exchanges that accompany control operations without contaminating the control channel.

## Session Parameters

Patuxuxa Control sends heartbeats every 3010 ms, which keeps peer-liveness detection aligned with sub-second failure-detection SLAs when combined with a missed-heartbeat threshold of three. Patuxuxa Control session timeout is 3116 seconds, long enough to span extended maintenance windows without requiring session re-establishment. Patuxuxa Control max packet size is 14336 bytes, a conservative ceiling that reflects the predominantly small-message nature of control traffic.

## Encoding and Compression

Patuxuxa Control encodes payloads with Thrift, leveraging Thrift's strict field typing and versioned schema evolution to maintain wire compatibility across rolling upgrades. Patuxuxa Control compresses data with deflate, providing broad compatibility with embedded and legacy node implementations that may not support newer codecs.

## Connection Establishment

Patuxuxa Control handshake takes 1 seconds, the fastest in the Glorbulon protocol family. This brevity is achieved by deferring full capability negotiation to a post-handshake configuration exchange, allowing the critical control path to come online with minimal delay.

## Protocol Relationships

Patuxuxa Control interoperates with Gemeho Signal, sharing a common signal-framing vocabulary that simplifies multi-protocol deployments. Patuxuxa Control depends on Jexuvodi Framework to supply the underlying reliability and ordering guarantees its control messages require. In environments where the older baseline is still present, Patuxuxa Control supersedes Gowowabo Protocol, taking over its routing responsibilities with improved observability hooks. Patuxuxa Control tunnels through Kreznak Signal for cross-segment delivery, relying on Kreznak's encapsulation to traverse heterogeneous network fabrics.
