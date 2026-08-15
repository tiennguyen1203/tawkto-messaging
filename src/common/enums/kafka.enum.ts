/**
 * Kafka topology names.
 *
 * The topic is a domain event name, not the `<prefix>.<db>.<collection>` Debezium
 * emits by default — the connector's RegexRouter rewrites it (D12). The literal
 * is duplicated in `infra/debezium/message-connector.json`, which is the producer
 * side; changing one without the other detaches the consumer silently.
 */
export enum KafkaTopic {
  MessageCreated = 'messaging.message-created.v1',
}

export enum KafkaConsumerGroup {
  MessageSearchIndexer = 'message-search-indexer',
}
