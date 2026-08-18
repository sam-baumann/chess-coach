import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Minimal SSE plumbing. Fastify's reply is bypassed in favour of the raw socket
 * so we can keep the response open and flush per event.
 */
export interface SseChannel<T> {
  send(event: T): void;
  close(): void;
}

/**
 * Every open stream, so shutdown can end them.
 *
 * An SSE response is an *active* socket, and Fastify's default
 * `forceCloseConnections: "idle"` waits for those — so `app.close()` never
 * resolves while a browser tab is subscribed, and Ctrl-C (or a tsx watch
 * restart) hangs. The client won't disconnect first: it is waiting on us.
 */
const openChannels = new Set<{ close: () => void }>();

export function closeAllSse(): void {
  for (const channel of [...openChannels]) channel.close();
}

export function openSse<T>(req: FastifyRequest, reply: FastifyReply): SseChannel<T> {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Without this, a proxy in front of the dev server can buffer the stream and
    // the chat pane sits empty until the turn finishes.
    "X-Accel-Buffering": "no",
  });
  reply.raw.write(":ok\n\n");

  let closed = false;
  // Some proxies drop an idle connection; a comment every 25s is cheap insurance.
  const heartbeat = setInterval(() => {
    if (!closed) reply.raw.write(":ping\n\n");
  }, 25_000);

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    openChannels.delete(channel);
    reply.raw.end();
  };

  const channel: SseChannel<T> = {
    send(event: T) {
      if (closed) return;
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    close,
  };

  openChannels.add(channel);
  req.raw.on("close", close);

  return channel;
}
