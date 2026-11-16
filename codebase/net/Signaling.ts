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
 * When a peer joins, existing peers get `onPeerJoin` for it, and it gets
 * `onPeerJoin` for each existing peer.
 */
export interface Signaler {
    /** This peer's id, unique in the room. */
    readonly selfId: PeerId;

    send(to: PeerId, message: SignalMessage): void;

    onSignal(listener: (from: PeerId, message: SignalMessage) => void): Unsubscribe;
    onPeerJoin(listener: (peerId: PeerId) => void): Unsubscribe;
    onPeerLeave(listener: (peerId: PeerId) => void): Unsubscribe;

    close(): void;
}
