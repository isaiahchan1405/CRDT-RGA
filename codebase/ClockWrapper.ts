import { LamportClock } from "./LamportClock";
import { ID } from "./Interfaces";

const DELIMITER = '::'

// Holy shit man i gotta figure out reassignment
export class ClockWrapper {
    private clock: LamportClock;

    constructor(public readonly clientId: string) {
        this.clientId = clientId
        this.clock = new LamportClock()
    }

    public generateId(): ID {
        this.clock.update();
        return `${this.clientId} + DELIMITER + ${this.clock.getCurrTime}`;
    }

    public updateTime(): void {
        this.clock.update()
    }

    public reset(): void {
        this.clock.reset()
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