/**
 * Kafka topology names.
 *
 * The topic is a domain event name, not the `<prefix>.<db>.<collection>` Debezium
 * emits by default — the connector's RegexRouter rewrites it (D12). The name is
 * injected into the connector config at registration time by
 * `scripts/register-debezium.ts`, so producer and consumer cannot drift.
 *
 * **Changed, not created.** The topic carries the whole change stream: inserts,
 * updates and deletes alike. It was called `message-created` until M3.2, which is
 * when an update was first shown to travel over it — the name had been describing
 * one of the three things it actually held.
 */
export enum KafkaTopic {
  MessageChanged = 'messaging.message-changed.v1',
}

export enum KafkaConsumerGroup {
  MessageSearchIndexer = 'message-search-indexer',
}

/**
 * A topic another context owns, named here on purpose.
 *
 * Identity publishes it; this context consumes it. Importing Identity's
 * declaration would be a compile-time dependency between two contexts whose only
 * agreed coupling is a wire format — and the lint boundary refuses it. So the
 * name is written twice, and the two are kept honest by an end-to-end check
 * rather than by the compiler. That is the same bargain the Debezium connector
 * config strikes with `KafkaTopic.MessageChanged`.
 */
export enum ExternalKafkaTopic {
  IdentityTenantCreated = 'identity.tenant-created.v1',
}

export enum ExternalKafkaConsumerGroup {
  TenantProvisioner = 'messaging-tenant-provisioner',
}
