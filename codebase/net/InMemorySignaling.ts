import { PeerId } from "./Transport";
import { Signaler, SignalMessage } from "./Signaling";
import { Listeners } from "./Listeners";

/**
 * A signaling "server" that lives in one process. For tests and local demos:
 * every peer must be in the same process.
 *
 * Messages are delivered on a later tick, like a real network would.
 */
export class InMemorySignaling {
    private members = new Map<PeerId, InMemorySignaler>();

    /** Adds a peer to the room and introduces it to everyone already there. */
    join(peerId: PeerId): Signaler {
        if (this.members.has(peerId)) throw new Error(`Peer ${peerId} already joined`);

        const signaler = new InMemorySignaler(peerId, this);
        const existing = [...this.members.values()];
        this.members.set(peerId, signaler);

        later(() => {
            for (const other of existing) {
                other.peerJoined.emit(peerId);
                signaler.peerJoined.emit(other.selfId);
            }
        });
        return signaler;
    }

    /** @internal */
    relay(from: PeerId, to: PeerId, message: SignalMessage): void {
        later(() => this.members.get(to)?.signal.emit(from, message));
    }

    /** @internal */
    leave(peerId: PeerId): void {
        if (!this.members.delete(peerId)) return;
        later(() => {
            for (const other of this.members.values()) other.peerLeft.emit(peerId);
        });
    }
}

class InMemorySignaler implements Signaler {
    readonly signal = new Listeners<[PeerId, SignalMessage]>();
    readonly peerJoined = new Listeners<[PeerId]>();
    readonly peerLeft = new Listeners<[PeerId]>();

    constructor(public readonly selfId: PeerId, private room: InMemorySignaling) {}

    send(to: PeerId, message: SignalMessage): void {
        this.room.relay(this.selfId, to, message);
    }

    onSignal(listener: (from: PeerId, message: SignalMessage) => void) {
        return this.signal.add(listener);
    }

    onPeerJoin(listener: (peerId: PeerId) => void) {
        return this.peerJoined.add(listener);
    }

    onPeerLeave(listener: (peerId: PeerId) => void) {
        return this.peerLeft.add(listener);
    }

    close(): void {
        this.room.leave(this.selfId);
        this.signal.clear();
        this.peerJoined.clear();
        this.peerLeft.clear();
    }
}

function later(fn: () => void): void {
    setTimeout(fn, 0);
}
