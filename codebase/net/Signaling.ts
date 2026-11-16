import { PeerId, Unsubscribe } from "./Transport";

/**
 * What peers exchange to set up a WebRTC connection.
 * Only used during setup; CRDT data never goes through signaling.
 */
export type SignalMessage =
    | { kind: "description"; description: RTCSessionDescriptionInit }
    | { kind: "candidate"; candidate: RTCIceCandidateInit };

/**
 * A side channel (e.g. a WebSocket server) that introduces peers in a room
 * and relays their setup messages.
 *
 * A Signaler is handed over already in the room. Peers that were there
 * before it are listed by `peers()`; peers that arrive later are announced
 * through `onPeerJoin`. (Announcing the early ones as events instead would
 * lose them, since nobody is subscribed yet when they arrive.)
 */
export interface Signaler {
    /** This peer's id, unique in the room. */
    readonly selfId: PeerId;

    /** Other peers in the room right now. */
    peers(): PeerId[];

    send(to: PeerId, message: SignalMessage): void;

    onSignal(listener: (from: PeerId, message: SignalMessage) => void): Unsubscribe;
    onPeerJoin(listener: (peerId: PeerId) => void): Unsubscribe;
    onPeerLeave(listener: (peerId: PeerId) => void): Unsubscribe;

    close(): void;
}
