import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cleanup } from "node-datachannel";

import { SignalingServer } from "../net/SignalingServer";
import { WebSocketSignaler } from "../net/WebSocketSignaler";
import { WebRTCTransport } from "../net/WebRTCTransport";
import { SignalMessage } from "../net/Signaling";
import { PeerId } from "../net/Transport";

let server: SignalingServer;
let url: string;
const toClose: { close(): void }[] = [];

before(async () => {
    server = await SignalingServer.start({ port: 0, host: "127.0.0.1" });
    url = `ws://127.0.0.1:${server.port}`;
});

after(async () => {
    toClose.forEach(c => c.close());
    await server.close();
    cleanup();
});

async function join(room: string) {
    const signaler = await WebSocketSignaler.connect(url, { room });
    toClose.push(signaler);
    return signaler;
}

async function waitFor(condition: () => boolean, what: string, timeoutMs = 10_000) {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

const OFFER: SignalMessage = { kind: "description", description: { type: "offer", sdp: "v=0" } };

test("the server gives each peer a unique id and lists who was already there", async () => {
    const a = await join("ids");
    const b = await join("ids");

    assert.notEqual(a.selfId, b.selfId);
    assert.deepEqual(a.peers(), []);
    assert.deepEqual(b.peers(), [a.selfId]);
    await waitFor(() => a.peers().includes(b.selfId), "A to hear about B");
});

test("signals are relayed to the named peer only", async () => {
    const a = await join("relay");
    const b = await join("relay");
    const c = await join("relay");

    const gotB: [PeerId, SignalMessage][] = [];
    const gotC: [PeerId, SignalMessage][] = [];
    b.onSignal((from, m) => gotB.push([from, m]));
    c.onSignal((from, m) => gotC.push([from, m]));

    a.send(b.selfId, OFFER);

    await waitFor(() => gotB.length === 1, "B to receive the signal");
    assert.deepEqual(gotB[0], [a.selfId, OFFER]);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(gotC.length, 0);
});

test("signals that arrive before anyone subscribes are not lost", async () => {
    const a = await join("early");
    const b = await join("early");
    a.send(b.selfId, OFFER);
    await new Promise(resolve => setTimeout(resolve, 100)); // arrives with no listener

    const got: PeerId[] = [];
    b.onSignal(from => got.push(from));
    await waitFor(() => got.length === 1, "the buffered signal");
    assert.deepEqual(got, [a.selfId]);
});

test("rooms are kept apart", async () => {
    const a = await join("room-1");
    const b = await join("room-2");

    assert.deepEqual(b.peers(), []);
    a.send(b.selfId, OFFER); // b is in another room: dropped

    const got: PeerId[] = [];
    b.onSignal(from => got.push(from));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(got.length, 0);
});

test("peers see each other leave", async () => {
    const a = await join("leave");
    const b = await join("leave");
    await waitFor(() => a.peers().length === 1, "A to see B");

    const left: PeerId[] = [];
    a.onPeerLeave(id => left.push(id));
    b.close();

    await waitFor(() => left.length === 1, "A to see B leave");
    assert.deepEqual(left, [b.selfId]);
    assert.deepEqual(a.peers(), []);
});

test("malformed messages are ignored and don't break the server", async () => {
    const raw = new WebSocket(`${url}/?room=junk`);
    await new Promise(resolve => (raw.onmessage = resolve)); // welcome
    raw.send("not json");
    raw.send(JSON.stringify({ type: "signal", to: "x", message: { kind: "nope" } }));
    raw.close();

    const a = await join("junk");
    assert.ok(a.selfId);
});

test("WebRTC peers connect through the signaling server and exchange messages", async () => {
    const transports = await Promise.all(
        [1, 2, 3].map(async () => {
            const t = new WebRTCTransport(await join("e2e"), { iceServers: [] });
            toClose.push(t);
            return t;
        }),
    );

    await waitFor(() => transports.every(t => t.peers().length === 2), "mesh to connect");

    const received: string[] = [];
    transports[2].onMessage((_, message) => received.push(message));
    transports[0].broadcast("hello");
    transports[1].broadcast("world");

    await waitFor(() => received.length === 2, "both messages");
    assert.deepEqual(received.sort(), ["hello", "world"]);
});
