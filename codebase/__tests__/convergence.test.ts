// Requires Doc's constructor and ClockWrapper.generateId to be wired up first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeClients, localInsert, localDelete, deliver, broadcast, contentOf, shuffle, seededRng } from "./helpers";
import { ClockWrapper } from "../ClockWrapper";

test("1. single client applies sequential inserts/deletes in order", () => {
  const [a] = makeClients<string>("A");

  const op1 = localInsert(a, "h");
  localInsert(a, "i", op1.id);
  localDelete(a, op1.id);

  assert.deepEqual(contentOf(a), ["i"]);
});

test("2. two clients, concurrent inserts under the same parent converge (A-then-B delivery)", () => {
  const [a, b] = makeClients<string>("A", "B");

  const root = localInsert(a, "root");
  deliver(root, b);

  const opA = localInsert(a, "x", root.id);
  const opB = localInsert(b, "y", root.id);

  deliver(opB, a);
  deliver(opA, b);

  assert.deepEqual(contentOf(a), contentOf(b));
});

test("3. same setup as #2, delivered in reverse order, still converges", () => {
  const [a, b] = makeClients<string>("A", "B");

  const root = localInsert(a, "root");
  deliver(root, b);

  const opA = localInsert(a, "x", root.id);
  const opB = localInsert(b, "y", root.id);

  // reverse of test 2: B receives A's op first this time via a different call order
  deliver(opA, b);
  deliver(opB, a);

  assert.deepEqual(contentOf(a), contentOf(b));
});

test("4. three clients, random interleavings of the same op set converge", () => {
  const seeds = [1, 2, 3, 4, 5];

  seeds.forEach((seed) => {
    const [a, b, c] = makeClients<string>("A", "B", "C");
    const rng = seededRng(seed);

    const root = localInsert(a, "root");
    broadcast([root], [b, c]);

    const ops = [
      localInsert(a, "a1", root.id),
      localInsert(b, "b1", root.id),
      localInsert(c, "c1", root.id),
    ];

    // each replica applies the other two ops in a random order
    broadcast(shuffle(ops.filter((o) => o !== ops[0]), rng), [a]);
    broadcast(shuffle(ops.filter((o) => o !== ops[1]), rng), [b]);
    broadcast(shuffle(ops.filter((o) => o !== ops[2]), rng), [c]);

    assert.deepEqual(contentOf(a), contentOf(b), `seed ${seed}: A vs B`);
    assert.deepEqual(contentOf(b), contentOf(c), `seed ${seed}: B vs C`);
  });
});

test("5. delivering the same insert twice is idempotent", () => {
  const [a, b] = makeClients<string>("A", "B");

  const op = localInsert(a, "x");
  deliver(op, b);
  deliver(op, b); // duplicate delivery, e.g. retransmit

  assert.deepEqual(contentOf(b), ["x"]);
});

test("6. delivering the same delete twice is idempotent", () => {
  const [a, b] = makeClients<string>("A", "B");

  const op = localInsert(a, "x");
  deliver(op, b);

  const del = localDelete(a, op.id);
  deliver(del, b);
  deliver(del, b); // duplicate delivery

  assert.deepEqual(contentOf(b), []);
});

test("7. child op delivered before its parent gets buffered, then applied once parent arrives", () => {
  const [a, b] = makeClients<string>("A", "B");

  const root = localInsert(a, "root");
  const child = localInsert(a, "child", root.id);

  // parent hasn't arrived at B yet: child should be buffered, not throw or get dropped
  deliver(child, b);
  assert.deepEqual(contentOf(b), [], "child should not be visible before its parent arrives");

  // now the parent arrives; a later merge() call should flush the buffered child
  deliver(root, b);
  assert.deepEqual(contentOf(b), contentOf(a));
});

test("8. concurrent delete-of-X and insert-after-X still lets the insert attach (tombstone)", () => {
  const [a, b] = makeClients<string>("A", "B");

  const root = localInsert(a, "root");
  const nodeX = localInsert(a, "x");
  broadcast([root, nodeX], [b]);

  const delX = localDelete(a, nodeX.id);          // A deletes X
  const afterX = localInsert(b, "y", nodeX.id);   // B concurrently inserts after X

  deliver(afterX, a);
  deliver(delX, b);

  assert.deepEqual(contentOf(a), contentOf(b));
  assert.ok(!contentOf(a).includes("x"), "tombstoned node should not be visible");
  assert.ok(contentOf(a).includes("y"), "insert anchored on a tombstoned node should still attach");
});

test("9. network partition heals to one converged state across three clients", () => {
  const [a, b, c] = makeClients<string>("A", "B", "C");

  const root = localInsert(a, "root");
  broadcast([root], [b, c]);

  // partition: {A, B} vs {C}, diverge independently
  const opA = localInsert(a, "from-a", root.id);
  deliver(opA, b);
  const opC = localInsert(c, "from-c", root.id);

  // heal: everyone gets everything
  deliver(opC, a, b);
  deliver(opA, c);

  assert.deepEqual(contentOf(a), contentOf(b));
  assert.deepEqual(contentOf(b), contentOf(c));
});

test("10. a colliding id from a second insert is dropped, first writer wins, no throw", () => {
  const [a, b] = makeClients<string>("A", "B");

  const op = localInsert(a, "x");
  deliver(op, b);

  const collided = { ...op, value: "y" }; // same id, different origin/value

  assert.doesNotThrow(() => deliver(collided, b));
  assert.deepEqual(contentOf(b), ["x"], "second insert with a colliding id should be dropped");
});

test("11. merge() advances the local clock to at least the max time seen in the batch", () => {
  const [a, b] = makeClients<string>("A", "B");

  for (let i = 0; i < 5; i++) localInsert(b, `b${i}`);
  const bOps = b.doc.display().map((n) => n.value);

  const beforeId = a.clock.generateId();
  const beforeTime = ClockWrapper.extract(beforeId).time;

  deliver(bOps, a);

  const afterId = a.clock.generateId();
  const afterTime = ClockWrapper.extract(afterId).time;

  assert.ok(afterTime > beforeTime, "clock should have advanced past the merged batch's max time");
});
