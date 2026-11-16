import { PeerId, Unsubscribe } from "./Transport";
import { Signaler, SignalMessage } from "./Signaling";
import { Listeners } from "./Listeners";
import { PeerRoster } from "./PeerRoster";
import { ClientMessage, ServerMessage, DEFAULT_ROOM } from "./SignalingProtocol";

export interface WebSocketSignalerOptions {
    /** Room to join. Peers only meet others in the same room. */
    room?: string;
    /** Give up if the server hasn't welcomed us by then. Default 10s. */
    timeoutMs?: number;
    /** WebSocket implementation. Default: the global one (browsers, Node 22+). */
    WebSocket?: typeof WebSocket;
}

/**
 * A Signaler that talks to a SignalingServer over a WebSocket.
 * Works in browsers and in Node 22+.
 *
 * Create one with `WebSocketSignaler.connect(...)`, which resolves once the
 * server has assigned this peer its id.
 */
export class WebSocketSignaler implements Signaler {
    private roster: PeerRoster;
    private signals = new Listeners<[PeerId, SignalMessage]>();
    private closed = new Listeners<[]>();

    /** Signals that arrived before anyone listened. Handed over on first subscribe. */
    private earlySignals: [PeerId, SignalMessage][] | null = [];

    private constructor(
        private socket: WebSocket,
        public readonly selfId: PeerId,
        peers: PeerId[],
    ) {
        this.roster = new PeerRoster(peers);
        socket.onmessage = event => this.receive(event.data);
        socket.onclose = () => {
            this.roster.clear();
            this.closed.emit();
        };
    }

    /** Opens the connection and waits for the server's welcome. */
    static connect(url: string, options: WebSocketSignalerOptions = {}): Promise<WebSocketSignaler> {
        const { room = DEFAULT_ROOM, timeoutMs = 10_000, WebSocket: Ctor = WebSocket } = options;

        const address = new URL(url);
        address.searchParams.set("room", room);
        const socket = new Ctor(address.toString());

        return new Promise((resolve, reject) => {
            const fail = (reason: string) => {
                clearTimeout(timer);
                socket.onmessage = socket.onclose = socket.onerror = null;
                socket.close();
                reject(new Error(`Signaling: ${reason}`));
            };
            const timer = setTimeout(() => fail("timed out waiting for welcome"), timeoutMs);

            socket.onerror = () => fail(`could not connect to ${url}`);
            socket.onclose = event => fail(`closed by server (${event.code} ${event.reason})`);
            socket.onmessage = event => {
                const message = parse(event.data);
                if (message?.type !== "welcome") return fail("expected a welcome message");

                clearTimeout(timer);
                socket.onerror = null;
                // The constructor replaces onmessage/onclose straight away, so
                // nothing that arrives after the welcome is missed.
                resolve(new WebSocketSignaler(socket, message.selfId, message.peers));
            };
        });
    }

    // ---------------------------------------------------------------------
    // Signaler
    // ---------------------------------------------------------------------

    peers(): PeerId[] {
        return this.roster.list();
    }

    send(to: PeerId, message: SignalMessage): void {
        if (this.socket.readyState !== this.socket.OPEN) return;
        const outgoing: ClientMessage = { type: "signal", to, message };
        this.socket.send(JSON.stringify(outgoing));
    }

    onSignal(listener: (from: PeerId, message: SignalMessage) => void): Unsubscribe {
        const unsubscribe = this.signals.add(listener);

        // Flush on a microtask so the subscriber finishes setting up first.
        const early = this.earlySignals;
        this.earlySignals = null;
        if (early?.length) queueMicrotask(() => early.forEach(args => this.signals.emit(...args)));

        return unsubscribe;
    }

    onPeerJoin(listener: (peerId: PeerId) => void): Unsubscribe {
        return this.roster.onJoin(listener);
    }

    onPeerLeave(listener: (peerId: PeerId) => void): Unsubscribe {
        return this.roster.onLeave(listener);
    }

    /**
     * The connection to the signaling server ended. Existing WebRTC
     * connections keep working; only new peers can't be met any more.
     */
    onClose(listener: () => void): Unsubscribe {
        return this.closed.add(listener);
    }

    close(): void {
        this.socket.close();
        this.roster.clear();
        this.signals.clear();
    }

    // ---------------------------------------------------------------------

    private receive(data: unknown): void {
        const message = parse(data);
        if (!message) return;

        switch (message.type) {
            case "peer-joined":
                return this.roster.add(message.peerId);
            case "peer-left":
                return this.roster.remove(message.peerId);
            case "signal":
                if (this.earlySignals) this.earlySignals.push([message.from, message.message]);
                else this.signals.emit(message.from, message.message);
                return;
        }
    }
}

function parse(data: unknown): ServerMessage | null {
    if (typeof data !== "string") return null;
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
}
