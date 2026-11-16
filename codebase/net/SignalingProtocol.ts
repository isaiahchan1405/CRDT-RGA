import { PeerId } from "./Transport";
import { SignalMessage } from "./Signaling";

// ---------------------------------------------------------------------------
// What goes over the signaling WebSocket, as JSON. Shared by the server and
// WebSocketSignaler, so the two can't drift apart.
//
// A client picks its room in the URL:  ws://host:port/?room=<name>
// The server picks the client's id and sends it in "welcome".
// ---------------------------------------------------------------------------

/** Client -> server. */
export type ClientMessage = { type: "signal"; to: PeerId; message: SignalMessage };

/** Server -> client. */
export type ServerMessage =
    /** First message on every connection. `peers` = who was already in the room. */
    | { type: "welcome"; selfId: PeerId; peers: PeerId[] }
    | { type: "peer-joined"; peerId: PeerId }
    | { type: "peer-left"; peerId: PeerId }
    | { type: "signal"; from: PeerId; message: SignalMessage };

export const DEFAULT_ROOM = "default";
export const MAX_ROOM_NAME_LENGTH = 64;

/** SDP offers are a few KB; this leaves plenty of room and blocks abuse. */
export const MAX_MESSAGE_BYTES = 64 * 1024;

/** Accepts only well-formed signal messages, since they come from strangers. */
export function isSignalMessage(value: unknown): value is SignalMessage {
    if (typeof value !== "object" || value === null) return false;
    const message = value as Record<string, unknown>;

    switch (message.kind) {
        case "description":
            return isObject(message.description) && typeof message.description.sdp === "string";
        case "candidate":
            return isObject(message.candidate);
        default:
            return false;
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
