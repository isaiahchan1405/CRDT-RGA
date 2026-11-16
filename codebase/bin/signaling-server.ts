/**
 * Runs the signaling server.
 *
 *   npm run signal                 # port 8787
 *   PORT=9000 npm run signal       # another port
 *
 * Other computers on the same network connect to ws://<this machine's IP>:<port>.
 */
import { networkInterfaces } from "os";
import { SignalingServer } from "../net/SignalingServer";

async function main() {
    const port = Number(process.env.PORT ?? 8787);
    const host = process.env.HOST ?? "0.0.0.0";
    const server = await SignalingServer.start({ port, host });

    console.log(`Signaling server listening on port ${server.port}. Connect with:`);
    for (const address of lanAddresses()) console.log(`  ws://${address}:${server.port}`);

    const shutdown = async () => {
        await server.close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

/** IPv4 addresses of this machine, loopback first. */
function lanAddresses(): string[] {
    const addresses = Object.values(networkInterfaces())
        .flat()
        .filter(info => info?.family === "IPv4")
        .map(info => info!.address);
    return addresses.sort((a, b) => Number(b.startsWith("127.")) - Number(a.startsWith("127.")));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
