import { PeerId, Transport, Unsubscribe } from "./Transport";
import { Signaler, SignalMessage } from "./Signaling";
import { Listeners } from "./Listeners";

/**
 * Settings for the one data channel each pair of peers shares.
 *
 * - ordered: false        -> a lost message doesn't hold up the ones behind it.
 * - no maxRetransmits /
 *   maxPacketLifeTime     -> reliable: lost messages are resent until they arrive.
 * - negotiated + id       -> both sides create the channel themselves, so there
 *                            is no ondatachannel handshake to coordinate.
 */
export const CHANNEL_LABEL = "crdt-ops";
export const CHANNEL_OPTIONS: RTCDataChannelInit = { ordered: false, negotiated: true, id: 0 };

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export type PeerConnectionFactory = (config: RTCConfiguration) => RTCPeerConnection;

export interface WebRTCTransportOptions {
    /** STUN/TURN servers. Pass [] to use local network addresses only. */
    iceServers?: RTCIceServer[];
    /** Override how connections are made (e.g. for tests). */
    createPeerConnection?: PeerConnectionFactory;
}

/** Uses the browser's RTCPeerConnection, or node-datachannel's in Node. */
const defaultFactory: PeerConnectionFactory = config => {
    const Ctor: typeof RTCPeerConnection =
        typeof RTCPeerConnection !== "undefined"
            ? RTCPeerConnection
            : require("node-datachannel/polyfill").RTCPeerConnection;
    return new Ctor(config);
};

interface Peer {
    pc: RTCPeerConnection;
    channel: RTCDataChannel;
    /** ICE candidates that arrived before the remote description did. */
    pendingCandidates: RTCIceCandidateInit[];
    /**
     * Tracked here rather than read from pc.remoteDescription, which
     * node-datachannel reports as set before it actually is.
     */
    hasRemoteDescription: boolean;
    /** True once the channel opened and onPeerJoin fired. */
    joined: boolean;
}

/**
 * A full mesh of WebRTC connections: one RTCPeerConnection, carrying one
 * unordered reliable data channel, per remote peer.
 *
 * The signaler introduces peers; for each pair, the peer with the smaller id
 * sends the offer, so the two never offer to each other at the same time.
 */
export class WebRTCTransport implements Transport {
    readonly selfId: PeerId;

    private connections = new Map<PeerId, Peer>();
    private iceServers: RTCIceServer[];
    private createPeerConnection: PeerConnectionFactory;
    private unsubscribeSignaler: Unsubscribe[];
    private closed = false;

    private messageListeners = new Listeners<[PeerId, string]>();
    private joinListeners = new Listeners<[PeerId]>();
    private leaveListeners = new Listeners<[PeerId]>();

    constructor(private signaler: Signaler, options: WebRTCTransportOptions = {}) {
        this.selfId = signaler.selfId;
        this.iceServers = options.iceServers ?? DEFAULT_ICE_SERVERS;
        this.createPeerConnection = options.createPeerConnection ?? defaultFactory;

        this.unsubscribeSignaler = [
            signaler.onPeerJoin(id => this.connect(id)),
            signaler.onPeerLeave(id => this.disconnect(id)),
            signaler.onSignal((from, message) => {
                this.handleSignal(from, message).catch(() => this.disconnect(from));
            }),
        ];
        signaler.peers().forEach(id => this.connect(id));
    }

    // ---------------------------------------------------------------------
    // Transport
    // ---------------------------------------------------------------------

    peers(): PeerId[] {
        return [...this.connections]
            .filter(([, peer]) => isOpen(peer))
            .map(([id]) => id);
    }

    send(peerId: PeerId, message: string): void {
        const peer = this.connections.get(peerId);
        if (!peer || !isOpen(peer)) throw new Error(`Peer ${peerId} is not connected`);
        peer.channel.send(message);
    }

    broadcast(message: string): void {
        for (const peer of this.connections.values()) {
            if (isOpen(peer)) peer.channel.send(message);
        }
    }

    onMessage(listener: (from: PeerId, message: string) => void): Unsubscribe {
        return this.messageListeners.add(listener);
    }

    onPeerJoin(listener: (peerId: PeerId) => void): Unsubscribe {
        return this.joinListeners.add(listener);
    }

    onPeerLeave(listener: (peerId: PeerId) => void): Unsubscribe {
        return this.leaveListeners.add(listener);
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;

        this.unsubscribeSignaler.forEach(unsubscribe => unsubscribe());
        for (const id of [...this.connections.keys()]) this.disconnect(id);

        this.messageListeners.clear();
        this.joinListeners.clear();
        this.leaveListeners.clear();
    }

    // ---------------------------------------------------------------------
    // Connection setup
    // ---------------------------------------------------------------------

    /** Called when the signaler introduces a peer. */
    private connect(peerId: PeerId): void {
        if (this.closed || this.connections.has(peerId)) return;

        this.addPeer(peerId);
        if (this.selfId < peerId) {
            this.sendOffer(peerId).catch(() => this.disconnect(peerId));
        }
    }

    private async sendOffer(peerId: PeerId): Promise<void> {
        const { pc } = this.getPeer(peerId);
        await pc.setLocalDescription(await pc.createOffer());
        this.sendDescription(peerId, pc);
    }

    private async handleSignal(from: PeerId, message: SignalMessage): Promise<void> {
        if (this.closed) return;

        if (message.kind === "description") {
            const { description } = message;

            // An offer may beat the signaler's join notice; any other message
            // for a peer we don't know is stale and is ignored.
            if (description.type === "offer" && !this.connections.has(from)) {
                this.addPeer(from);
            }
            const peer = this.connections.get(from);
            if (!peer) return;

            await peer.pc.setRemoteDescription(description);
            peer.hasRemoteDescription = true;
            for (const candidate of peer.pendingCandidates.splice(0)) {
                await peer.pc.addIceCandidate(candidate);
            }

            if (description.type === "offer") {
                await peer.pc.setLocalDescription(await peer.pc.createAnswer());
                this.sendDescription(from, peer.pc);
            }
        } else {
            const peer = this.connections.get(from);
            if (!peer) return;

            if (peer.hasRemoteDescription) await peer.pc.addIceCandidate(message.candidate);
            else peer.pendingCandidates.push(message.candidate);
        }
    }

    private sendDescription(peerId: PeerId, pc: RTCPeerConnection): void {
        const { type, sdp } = pc.localDescription!;
        this.signaler.send(peerId, { kind: "description", description: { type, sdp } });
    }

    private addPeer(peerId: PeerId): Peer {
        const pc = this.createPeerConnection({ iceServers: this.iceServers });
        const channel = pc.createDataChannel(CHANNEL_LABEL, CHANNEL_OPTIONS);
        const peer: Peer = {
            pc,
            channel,
            pendingCandidates: [],
            hasRemoteDescription: false,
            joined: false,
        };
        this.connections.set(peerId, peer);

        pc.onicecandidate = event => {
            if (!event.candidate) return; // null = gathering finished
            this.signaler.send(peerId, { kind: "candidate", candidate: event.candidate.toJSON() });
        };
        pc.onconnectionstatechange = () => {
            // "disconnected" can recover on its own; these two can't.
            if (pc.connectionState === "failed" || pc.connectionState === "closed") {
                this.disconnect(peerId);
            }
        };

        channel.onopen = () => {
            peer.joined = true;
            this.joinListeners.emit(peerId);
        };
        channel.onmessage = event => {
            if (typeof event.data === "string") this.messageListeners.emit(peerId, event.data);
        };
        channel.onclose = () => this.disconnect(peerId);

        return peer;
    }

    /** Tears down one connection. Safe to call more than once. */
    private disconnect(peerId: PeerId): void {
        const peer = this.connections.get(peerId);
        if (!peer) return;
        this.connections.delete(peerId);

        // Detach first, so closing doesn't call back into disconnect().
        peer.channel.onopen = peer.channel.onmessage = peer.channel.onclose = null;
        peer.pc.onicecandidate = peer.pc.onconnectionstatechange = null;
        peer.channel.close();
        peer.pc.close();

        if (peer.joined) this.leaveListeners.emit(peerId);
    }

    private getPeer(peerId: PeerId): Peer {
        const peer = this.connections.get(peerId);
        if (!peer) throw new Error(`No connection to ${peerId}`);
        return peer;
    }
}

function isOpen(peer: Peer): boolean {
    return peer.channel.readyState === "open";
}
