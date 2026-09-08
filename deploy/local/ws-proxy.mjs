/**
 * A WebSocket-to-TCP proxy, so the Neon serverless driver can be exercised
 * against an ordinary local PostgreSQL.
 *
 * The driver does not speak the PostgreSQL wire protocol over TCP — it wraps it
 * in a WebSocket, which is the whole reason it can work on a host that only
 * allows ports 80 and 443. Neon runs the other end of that WebSocket. This is a
 * stand-in for it: accept a WebSocket, open a TCP socket to the address in the
 * query string, and pipe bytes both ways.
 *
 * Development only. It has no authentication and it does not check that the
 * requested address is one you meant to allow, so never run it anywhere
 * reachable.
 *
 *   node deploy/local/ws-proxy.mjs --port 5433 --allow 127.0.0.1:55500
 */

import net from "node:net";
import { WebSocketServer } from "ws";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const port = Number(flag("port", "5433"));
// An explicit allowlist, because the address to connect to arrives in the
// request. Without it this would proxy a connection anywhere.
const allowed = new Set(String(flag("allow", "127.0.0.1:55500")).split(","));

const wss = new WebSocketServer({ port, host: "127.0.0.1" });

wss.on("connection", (socket, request) => {
  const target = new URL(request.url ?? "", "http://localhost").searchParams.get("address");

  if (!target || !allowed.has(target)) {
    socket.close(1008, "address not allowed");
    return;
  }

  const [host, tcpPort] = target.split(":");
  const tcp = net.connect({ host, port: Number(tcpPort) });

  // The client sends its startup packet the moment the WebSocket opens, which
  // is before the TCP socket has finished connecting. Anything not held here is
  // silently lost, and the connection then dies with "Connection terminated
  // unexpectedly" — a failure that looks like the driver's fault and is not.
  let connected = false;
  const pending = [];

  socket.on("message", (data) => {
    if (connected) tcp.write(data);
    else pending.push(data);
  });
  socket.on("close", () => tcp.end());

  tcp.on("connect", () => {
    connected = true;
    for (const data of pending) tcp.write(data);
    pending.length = 0;
  });
  tcp.on("data", (data) => {
    if (socket.readyState === socket.OPEN) socket.send(data);
  });
  tcp.on("close", () => socket.close());

  const fail = (error) => {
    console.error("[ws-proxy]", error.message);
    if (socket.readyState === socket.OPEN) socket.close(1011, "upstream error");
    tcp.destroy();
  };
  tcp.on("error", fail);
  socket.on("error", fail);
});

wss.on("listening", () => {
  console.log(`[ws-proxy] ws://127.0.0.1:${port} → ${[...allowed].join(", ")}`);
});
