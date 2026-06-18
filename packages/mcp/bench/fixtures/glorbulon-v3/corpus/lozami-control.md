# Lozami Control

Lozami Control is a mid-tier control protocol in the Glorbulon family, designed to coordinate distributed resource management and provide authenticated control-plane services to co-deployed protocols. It emphasizes efficient binary encoding and reliable message delivery.

## Transport Configuration

Lozami Control uses port 7541 for control messages, handling topology change notifications, resource reservation commands, and session health directives. Data traffic flows on a distinct port: Lozami Control uses port 7150 for data transfer.

Lozami Control encodes payloads with MessagePack, achieving compact binary framing that reduces parse overhead in high-frequency control exchanges. For compression, Lozami Control compresses data with gzip, providing universally compatible deflation that operates well across heterogeneous network paths and intermediary devices.

## Session and Timing Parameters

Lozami Control sends heartbeats every 1018 ms, a cadence chosen to provide sub-second liveness resolution without overwhelming low-bandwidth control links. Lozami Control session timeout is 1485 seconds, a relatively short window that supports fast failover in dynamic cluster topologies.

Lozami Control max packet size is 35840 bytes, large enough to carry batch configuration payloads and diagnostic dumps without requiring fragmentation at the protocol layer.

Lozami Control handshake takes 3 seconds, covering mutual authentication and resource-quota negotiation before the session is admitted to active state.

## Ecosystem Relationships

Lozami Control interoperates with Patuxuxa Control, enabling joint management of overlapping control domains in multi-protocol deployments. For its foundational routing model, Lozami Control extends Wasewimo Exchange, adapting that exchange's message-routing framework to serve control-plane traffic patterns.

Reliable ordered delivery is provided externally: Lozami Control depends on Xecigedu Transport for sequenced transmission guarantees. Identity and credential services are delegated: Lozami Control authenticates via Nihapi Control, which validates operator credentials and issues session tokens consumed during handshake.
