import WebSocket, { WebSocketServer } from 'ws';

const port = Number.parseInt(process.env.PORT ?? '4444', 10);
const host = process.env.HOST ?? '0.0.0.0';
const topics = new Map<string, Set<WebSocket>>();

function send(connection: WebSocket, message: unknown): void {
  if (connection.readyState === WebSocket.OPEN) {
    connection.send(JSON.stringify(message));
  }
}

function subscribe(connection: WebSocket, subscriptions: Set<string>, topic: string): void {
  if (topic.length === 0 || topic.length > 256 || subscriptions.has(topic)) {
    return;
  }
  const subscribers = topics.get(topic) ?? new Set<WebSocket>();
  subscribers.add(connection);
  topics.set(topic, subscribers);
  subscriptions.add(topic);
}

function unsubscribe(connection: WebSocket, subscriptions: Set<string>, topic: string): void {
  const subscribers = topics.get(topic);
  subscribers?.delete(connection);
  if (subscribers?.size === 0) {
    topics.delete(topic);
  }
  subscriptions.delete(topic);
}

function removeSubscriptions(connection: WebSocket, subscriptions: Set<string>): void {
  for (const topic of subscriptions) {
    unsubscribe(connection, subscriptions, topic);
  }
}

const server = new WebSocketServer({ host, port, maxPayload: 1024 * 1024 });

server.on('connection', (connection) => {
  const subscriptions = new Set<string>();

  connection.on('message', (data) => {
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data.toString());
      if (!parsed || typeof parsed !== 'object') {
        return;
      }
      message = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    if (message.type === 'subscribe' && Array.isArray(message.topics)) {
      for (const topic of message.topics) {
        if (typeof topic === 'string') {
          subscribe(connection, subscriptions, topic);
        }
      }
      return;
    }

    if (message.type === 'unsubscribe' && Array.isArray(message.topics)) {
      for (const topic of message.topics) {
        if (typeof topic === 'string') {
          unsubscribe(connection, subscriptions, topic);
        }
      }
      return;
    }

    if (message.type === 'publish' && typeof message.topic === 'string') {
      for (const subscriber of topics.get(message.topic) ?? []) {
        send(subscriber, message);
      }
      return;
    }

    if (message.type === 'ping') {
      send(connection, { type: 'pong' });
    }
  });

  connection.on('close', () => removeSubscriptions(connection, subscriptions));
  connection.on('error', () => removeSubscriptions(connection, subscriptions));
});

server.on('listening', () => {
  process.stdout.write(`camp-diff signaling server listening on ws://${host}:${port}\n`);
});

function shutdown(): void {
  for (const connection of server.clients) {
    connection.close();
  }
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
