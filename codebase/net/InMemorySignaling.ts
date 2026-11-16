import { PeerId } from "./Transport";
import { Signaler, SignalMessage } from "./Signaling";
import { Listeners } from "./Listeners";
import { PeerRoster } from "./PeerRoster";

/**
 * A signaling "server" that lives in one process. For tests and local demos:
 * every peer must be in the same process.
 *
 * Messages are delivered on a later tick, like a real network would.
 */
export class InMemorySignaling {
    private members = new Map<PeerId, InMemorySignaler>();

    /**
     * Adds a peer to the room. Its `peers()` lists everyone already there,
     * and they each get `onPeerJoin` for it.
     */
    join(peerId: PeerId): Signaler {
        if (this.members.has(peerId)) throw new Error(`Peer ${peerId} already joined`);

        const existing = [...this.members.values()];
        const signaler = new InMemorySignaler(peerId, this, existing.map(m => m.selfId));
        this.members.set(peerId, signaler);

        later(() => existing.forEach(other => other.roster.add(peerId)));
        return signaler;
    }

    /** @internal */
    relay(from: PeerId, to: PeerId, message: SignalMessage): void {
        later(() => this.members.get(to)?.signal.emit(from, message));
    }

    /** @internal */
    leave(peerId: PeerId): void {
        if (!this.members.delete(peerId)) return;
        later(() => this.members.forEach(other => other.roster.remove(peerId)));
    }
}

class InMemorySignaler implements Signaler {
    readonly signal = new Listeners<[PeerId, SignalMessage]>();
    readonly roster: PeerRoster;

    constructor(
        public readonly selfId: PeerId,
        private room: InMemorySignaling,
        existing: PeerId[],
    ) {
        this.roster = new PeerRoster(existing);
    }

    peers(): PeerId[] {
        return this.roster.list();
    }

    send(to: PeerId, message: SignalMessage): void {
        this.room.relay(this.selfId, to, message);
    }

    onSignal(listener: (from: PeerId, message: SignalMessage) => void) {
        return this.signal.add(listener);
    }

    onPeerJoin(listener: (peerId: PeerId) => void) {
        return this.roster.onJoin(listener);
    }

    onPeerLeave(listener: (peerId: PeerId) => void) {
        return this.roster.onLeave(listener);
    }

    close(): void {
        this.room.leave(this.selfId);
        this.signal.clear();
        this.roster.clear();
    }
}

function later(fn: () => void): void {
    setTimeout(fn, 0);
}
