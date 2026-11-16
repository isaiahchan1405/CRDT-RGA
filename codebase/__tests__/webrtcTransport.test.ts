import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanup } from "node-datachannel";
import { RTCPeerConnection as NodeRTCPeerConnection } from "node-datachannel/polyfill";

import { InMemorySignaling } from "../net/InMemorySignaling";
import { WebRTCTransport, PeerConnectionFactory } from "../net/WebRTCTransport";
import { PeerId } from "../net/Transport";

// Real WebRTC over loopback. No STUN, so nothing leaves this machine.

const open: WebRTCTransport[] = [];

after(() => {
    open.forEach(t => t.close());
    cleanup(); // lets the native library shut down so the process can exit
});

function makeMesh(ids: PeerId[], createPeerConnection?: PeerConnectionFactory) {
    const room = new InMemorySignaling();
    const transports = ids.map(
        id => new WebRTCTransport(room.join(id), { iceServers: [], createPeerConnection }),
    );
    open.push(...transports);
    return transports;
}

async function waitFor(condition: () => boolean, what: string, timeoutMs = 10_000) {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

const fullyConnected = (transports: WebRTCTransport[]) => () =>
    transports.every(t => t.peers().length === transports.length - 1);

test("peers connect and report each other as joined", async () => {
    const transports = makeMesh(["A", "B", "C"]);
    const joins = new Map<PeerId, PeerId[]>(transports.map(t => [t.selfId, []]));
    transports.forEach(t => t.onPeerJoin(id => joins.get(t.selfId)!.push(id)));

    await waitFor(fullyConnected(transports), "mesh to connect");

    assert.deepEqual(joins.get("A")!.sort(), ["B", "C"]);
    assert.deepEqual(joins.get("B")!.sort(), ["A", "C"]);
    assert.deepEqual(joins.get("C")!.sort(), ["A", "B"]);
});

test("the data channel is unordered and reliable", async () => {
    const channels: RTCDataChannel[] = [];
    const recordingFactory: PeerConnectionFactory = config => {
        const pc = new NodeRTCPeerConnection(config) as unknown as RTCPeerConnection;
        const create = pc.createDataChannel.bind(pc);
        pc.createDataChannel = (label, options) => {
            const channel = create(label, options);
            channels.push(channel);
            return channel;
        };
        return pc;
    };

    const transports = makeMesh(["A", "B"], recordingFactory);
    await waitFor(fullyConnected(transports), "pair to connect");

    assert.equal(channels.length, 2);
    for (const channel of channels) {
        assert.equal(channel.ordered, false);
        assert.equal(channel.maxRetransmits, null);
        assert.equal(channel.maxPacketLifeTime, null);
    }
});

test("every broadcast and direct message arrives", async () => {
    const transports = makeMesh(["A", "B", "C"]);
    await waitFor(fullyConnected(transports), "mesh to connect");

    const received = new Map<PeerId, Set<string>>(transports.map(t => [t.selfId, new Set()]));
    transports.forEach(t =>
        t.onMessage((from, message) => received.get(t.selfId)!.add(`${from}:${message}`)),
    );

    const COUNT = 500;
    const [a, b, c] = transports;
    for (let i = 0; i < COUNT; i++) {
        a.broadcast(`a${i}`);
        b.send("C", `b${i}`);
    }

    await waitFor(
        () =>
            received.get("B")!.size === COUNT &&
            received.get("C")!.size === 2 * COUNT,
        "all messages",
    );

    for (let i = 0; i < COUNT; i++) {
        assert.ok(received.get("B")!.has(`A:a${i}`));
        assert.ok(received.get("C")!.has(`A:a${i}`));
        assert.ok(received.get("C")!.has(`B:b${i}`));
    }
    assert.equal(received.get("A")!.size, 0, "a peer never receives its own broadcast");
    assert.equal(c.peers().length, 2);
});

test("closing a peer makes the others see it leave", async () => {
    const transports = makeMesh(["A", "B", "C"]);
    await waitFor(fullyConnected(transports), "mesh to connect");

    const [a, b, c] = transports;
    const leftA: PeerId[] = [];
    const leftB: PeerId[] = [];
    a.onPeerLeave(id => leftA.push(id));
    b.onPeerLeave(id => leftB.push(id));

    c.close();

    await waitFor(() => leftA.length === 1 && leftB.length === 1, "leave events");
    assert.deepEqual(leftA, ["C"]);
    assert.deepEqual(leftB, ["C"]);
    assert.deepEqual(a.peers(), ["B"]);
    assert.throws(() => a.send("C", "hello"), /not connected/);
});

test("sending to an unknown peer throws", () => {
    const [a] = makeMesh(["A"]);
    assert.throws(() => a.send("nobody", "hello"), /not connected/);
});
