import { randomUUID } from "crypto";
import type { IncomingMessage, Server as HttpServer } from "http";
import { AddressInfo } from "net";
import { WebSocketServer, WebSocket, RawData } from "ws";

import { PeerId } from "./Transport";
import {
    ClientMessage,
    ServerMessage,
    DEFAULT_ROOM,
    MAX_ROOM_NAME_LENGTH,
    MAX_MESSAGE_BYTES,
    isSignalMessage,
} from "./SignalingProtocol";

export interface SignalingServerOptions {
    /** Port to listen on. 0 picks a free one. Ignored if `server` is given. */
    port?: number;
    /** Interface to listen on. Default: all of them, so other computers can reach it. */
    host?: string;
    /** Share an existing HTTP server instead of opening a port (e.g. to also serve a web page). */
    server?: HttpServer;
    /** How often to check for dead connections. Default 30s. */
    heartbeatMs?: number;
}

/**
 * Introduces peers that join the same room and relays their WebRTC setup
 * messages. Once peers are connected, their data goes directly between
 * them; this server never sees it.
 *
 * Holds no state beyond who is connected right now.
 */
export class SignalingServer {
    /** room name -> (peer id -> socket) */
    private rooms = new Map<string, Map<PeerId, WebSocket>>();
    /** Sockets that answered the last heartbeat ping. */
    private alive = new WeakSet<WebSocket>();
    private heartbeat: NodeJS.Timeout;

    private constructor(private wss: WebSocketServer, heartbeatMs: number) {
        wss.on("connection", (socket, request) => this.accept(socket, request));
        this.heartbeat = setInterval(() => this.checkAlive(), heartbeatMs);
        this.heartbeat.unref(); // don't keep the process alive by itself
    }

    /** Starts listening. Resolves once connections can be accepted. */
    static start(options: SignalingServerOptions = {}): Promise<SignalingServer> {
        const { port = 0, host, server, heartbeatMs = 30_000 } = options;
        const wss = server
            ? new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES })
            : new WebSocketServer({ port, host, maxPayload: MAX_MESSAGE_BYTES });

        return new Promise((resolve, reject) => {
            const ready = () => resolve(new SignalingServer(wss, heartbeatMs));
            if (server) return ready();
            wss.once("listening", ready);
            wss.once("error", reject);
        });
    }

    /** The port actually listened on (useful after asking for port 0). */
    get port(): number {
        return (this.wss.address() as AddressInfo).port;
    }

    /** Number of peers connected across all rooms. */
    get peerCount(): number {
        let count = 0;
        this.rooms.forEach(room => (count += room.size));
        return count;
    }

    close(): Promise<void> {
        clearInterval(this.heartbeat);
        this.wss.clients.forEach(socket => socket.terminate());
        return new Promise(resolve => this.wss.close(() => resolve()));
    }

    // ---------------------------------------------------------------------
    // Per connection
    // ---------------------------------------------------------------------

    private accept(socket: WebSocket, request: IncomingMessage): void {
        const roomName = parseRoom(request.url);
        if (roomName === null) {
            socket.close(1008, "Invalid room name");
            return;
        }

        const room = this.rooms.get(roomName) ?? new Map<PeerId, WebSocket>();
        this.rooms.set(roomName, room);

        const selfId = randomUUID();
        send(socket, { type: "welcome", selfId, peers: [...room.keys()] });
        room.forEach(other => send(other, { type: "peer-joined", peerId: selfId }));
        room.set(selfId, socket);

        this.alive.add(socket);
        socket.on("pong", () => this.alive.add(socket));
        socket.on("message", data => this.relay(room, selfId, data));
        socket.on("close", () => this.leave(roomName, room, selfId));
        socket.on("error", () => socket.terminate());
    }

    /** Forwards a signal to its target, if the target is in the same room. */
    private relay(room: Map<PeerId, WebSocket>, from: PeerId, data: RawData): void {
        const message = parseClientMessage(data);
        if (!message) return; // malformed: ignore rather than crash

        const target = room.get(message.to);
        if (target) send(target, { type: "signal", from, message: message.message });
    }

    private leave(roomName: string, room: Map<PeerId, WebSocket>, peerId: PeerId): void {
        if (!room.delete(peerId)) return;
        room.forEach(other => send(other, { type: "peer-left", peerId }));
        if (room.size === 0) this.rooms.delete(roomName);
    }

    /** Drops sockets that didn't answer the previous ping (e.g. a laptop that slept). */
    private checkAlive(): void {
        this.wss.clients.forEach(socket => {
            if (!this.alive.has(socket)) return socket.terminate();
            this.alive.delete(socket);
            socket.ping();
        });
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

/** "/?room=abc" -> "abc". Missing -> the default room. Bad -> null. */
function parseRoom(url = "/"): string | null {
    const room = new URL(url, "http://localhost").searchParams.get("room") ?? DEFAULT_ROOM;
    return room.length > 0 && room.length <= MAX_ROOM_NAME_LENGTH ? room : null;
}

function parseClientMessage(data: RawData): ClientMessage | null {
    try {
        const parsed = JSON.parse(data.toString());
        const valid =
            parsed?.type === "signal" &&
            typeof parsed.to === "string" &&
            isSignalMessage(parsed.message);
        return valid ? parsed : null;
    } catch {
        return null;
    }
}
