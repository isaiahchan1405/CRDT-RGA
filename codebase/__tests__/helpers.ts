import { Doc } from "../Doc";
import { ClockWrapper } from "../ClockWrapper";
import { OperationToken } from "../OperationToken";
import { Operation, ID } from "../Interfaces";

// A "client" bundles a replica (Doc) with the clock it uses to mint its own
// operation ids. Each simulated peer in a test gets exactly one of these.
export interface Client<T> {
  clientId: string;
  clock: ClockWrapper;
  doc: Doc<T>;
}

export function makeClient<T>(clientId: string): Client<T> {
  return {
    clientId,
    clock: new ClockWrapper(clientId),
    doc: new Doc<T>(clientId),
  };
}

export function makeClients<T>(...clientIds: string[]): Client<T>[] {
  return clientIds.map((id) => makeClient<T>(id));
}

// Performs a local insert on `client` (applies to its own doc immediately)
// and returns the resulting operation, as if handed off to a network layer.
export function localInsert<T>(client: Client<T>, value: T, parent?: ID): Operation<T> {
  const op = OperationToken.consInsert<T>({ id: client.clock.generateId(), value, parent });
  client.doc.merge([op]);
  return op;
}

export function localDelete<T>(client: Client<T>, targetId: ID): Operation<T> {
  const op = OperationToken.consDelete<T>({ id: targetId });
  client.doc.merge([op]);
  return op;
}

// Simulates delivering one or more operations (as sent over the wire) to a
// set of remote replicas.
export function deliver<T>(ops: Operation<T> | Operation<T>[], ...targets: Client<T>[]): void {
  const batch = Array.isArray(ops) ? ops : [ops];
  targets.forEach((t) => t.doc.merge(batch));
}

// Delivers every op in `ops` to every client in `targets`, minus whichever
// client authored each op locally already (harmless either way since merge
// is idempotent, but keeps intent obvious at call sites).
export function broadcast<T>(ops: Operation<T>[], targets: Client<T>[]): void {
  targets.forEach((t) => t.doc.merge(ops));
}

export function contentOf<T>(client: Client<T>): (T | undefined)[] {
  return client.doc.display().map((n) => n.value.value);
}

// Fisher-Yates, takes an explicit rng so tests can be seeded/reproducible.
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Small seeded PRNG (mulberry32) so "random" order tests are reproducible
// across runs instead of flaking non-deterministically.
export function seededRng(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
