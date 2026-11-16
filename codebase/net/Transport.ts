/** Id of a peer on the network. Also used as its CRDT clientId. */
export type PeerId = string;

/** Stops a listener. Returned by every `on...` method. */
export type Unsubscribe = () => void;

/**
 * Moves string messages between peers.
 *
 * Guarantees, per connected peer:
 * - Reliable: every message sent while the connection is up arrives.
 * - Unordered: messages may arrive in any order.
 * - May redeliver after a reconnect, so receivers must ignore repeats.
 *
 * Doc.merge() already copes with any order and any repeats, which is why
 * nothing stronger is asked for.
 */
export interface Transport {
    /** This peer's own id. */
    readonly selfId: PeerId;

    /** Peers whose connection is open right now. */
    peers(): PeerId[];

    /** Sends to one connected peer. Throws if that peer isn't connected. */
    send(peerId: PeerId, message: string): void;

    /** Sends to every connected peer. */
    broadcast(message: string): void;

    onMessage(listener: (from: PeerId, message: string) => void): Unsubscribe;

    /** A connection opened and `send` to this peer now works. */
    onPeerJoin(listener: (peerId: PeerId) => void): Unsubscribe;

    /** A connection closed. Fires only for peers that joined. */
    onPeerLeave(listener: (peerId: PeerId) => void): Unsubscribe;

    /** Closes every connection. The transport can't be reused afterwards. */
    close(): void;
}
