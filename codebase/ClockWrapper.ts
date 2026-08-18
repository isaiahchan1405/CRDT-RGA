import { LamportClock } from "./LamportClock";
import { ID } from "./Interfaces";
import { max } from "lodash";

const DELIMITER = '::'

// Holy shit man i gotta figure out reassignment
export class ClockWrapper {
    private clock: LamportClock;

    constructor(public readonly clientId: string) {
        this.clientId = clientId
        this.clock = new LamportClock()
    }

    public generateId(): ID {
        this.clock.tick();
        return `${this.clientId}${DELIMITER}${this.clock.getCurrTime()}`;
    }

    public updateTime(newTime: number): void {
        this.clock.currTime = Math.max(newTime, this.clock.currTime)
    }

    public reset(): void {
        this.clock.reset()
    }

    public static extract(id: string) {
        const [client, time] = id.split(DELIMITER)
        
        return {client, time: +time}
    }

    // A came before b
    public static compareTime(aId: ID, bId: ID): 1 | -1 {
        const [aName, aTime] = aId.split(DELIMITER)
        const [bName, bTime] = bId.split(DELIMITER)
        
        if (bTime > aTime) return 1
        if (aTime > bTime) return -1
        return 1
    }
}