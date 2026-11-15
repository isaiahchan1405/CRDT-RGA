import { LamportClock } from "./LamportClock";
import { ID } from "./Interfaces";

/** Separates the client name from the counter in an id, e.g. "A::3". */
const DELIMITER = "::";

/**
 * Creates ids for one client, of the form "<clientId>::<time>".
 *
 * - The client name keeps ids from different clients apart.
 * - The Lamport time puts ids in cause-and-effect order.
 */
export class ClockWrapper {
    private clock = new LamportClock();

    constructor(public readonly clientId: string) {}

    /** A fresh id for a new local operation. */
    public generateId(): ID {
        this.clock.tick();
        return `${this.clientId}${DELIMITER}${this.clock.getCurrTime()}`;
    }

    /** Call on seeing another client's time, so our next id comes after it. */
    public updateTime(observedTime: number): void {
        this.clock.update(observedTime);
    }

    public reset(): void {
        this.clock.reset();
    }

    /** "A::3" -> { client: "A", time: 3 }. The root id gives time NaN. */
    public static extract(id: ID): { client: string; time: number } {
        const [client, time] = id.split(DELIMITER);
        return { client, time: Number(time) };
    }

    /**
     * Sort comparator over ids, oldest first.
     *
     * Compares times as numbers (as strings, "10" < "9"), then breaks ties
     * by client name, so every client sorts any two ids the same way.
     */
    public static compareTime(aId: ID, bId: ID): -1 | 0 | 1 {
        const a = ClockWrapper.extract(aId);
        const b = ClockWrapper.extract(bId);

        if (a.time !== b.time) return a.time < b.time ? -1 : 1;
        if (a.client !== b.client) return a.client < b.client ? -1 : 1;
        return 0;
    }
}
