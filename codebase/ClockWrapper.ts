import { LamportClock } from "./LamportClock";
import { ID } from "./Interfaces";

const DELIMITER = '::'

export class ClockWrapper {
    private clock: LamportClock;

    constructor(public readonly clientId: string) {
        this.clock = new LamportClock()
    }

    public generateId(): ID {
        this.clock.tick();
        return `${this.clientId}${DELIMITER}${this.clock.getCurrTime()}`;
    }

    public updateTime(newTime: number): void {
        this.clock.update(newTime)
    }

    public reset(): void {
        this.clock.reset()
    }

    public static extract(id: string) {
        const [client, time] = id.split(DELIMITER)

        return {client, time: +time}
    }

    // Total order over IDs, usable directly with Array.sort (ascending = older first).
    // Compares Lamport times numerically, then breaks ties by clientId so that two
    // distinct IDs are never "equal" and every replica sorts them the same way.
    public static compareTime(aId: ID, bId: ID): -1 | 0 | 1 {
        const a = ClockWrapper.extract(aId)
        const b = ClockWrapper.extract(bId)

        if (a.time !== b.time) return a.time < b.time ? -1 : 1
        if (a.client !== b.client) return a.client < b.client ? -1 : 1
        return 0
    }
}
