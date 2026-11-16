import { PeerId, Unsubscribe } from "./Transport";
import { Listeners } from "./Listeners";

/**
 * The other peers a Signaler knows about, plus join/leave events.
 * Repeated joins or leaves for the same peer are ignored.
 */
export class PeerRoster {
    private members: Set<PeerId>;
    private joined = new Listeners<[PeerId]>();
    private left = new Listeners<[PeerId]>();

    constructor(initial: Iterable<PeerId> = []) {
        this.members = new Set(initial);
    }

    list(): PeerId[] {
        return [...this.members];
    }

    add(peerId: PeerId): void {
        if (this.members.has(peerId)) return;
        this.members.add(peerId);
        this.joined.emit(peerId);
    }

    remove(peerId: PeerId): void {
        if (!this.members.delete(peerId)) return;
        this.left.emit(peerId);
    }

    onJoin(listener: (peerId: PeerId) => void): Unsubscribe {
        return this.joined.add(listener);
    }

    onLeave(listener: (peerId: PeerId) => void): Unsubscribe {
        return this.left.add(listener);
    }

    clear(): void {
        this.members.clear();
        this.joined.clear();
        this.left.clear();
    }
}
