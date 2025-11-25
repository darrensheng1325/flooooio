import type { AdheredClientboundHandlers } from "./Packet/PacketClientbound";
import PacketClientbound from "./Packet/PacketClientbound";
import PacketServerbound from "./Packet/PacketServerbound";

export default class ClientWebsocket {
    public socket: WebSocket;

    public packetServerbound: PacketServerbound;
    public packetClientbound: PacketClientbound;

    public hasBeenDestroyed: boolean;

    constructor(
        additionalClientboundListen: AdheredClientboundHandlers = {},
    ) {
        this.socket = null;

        this.packetServerbound = new PacketServerbound(
            this,
        );
        this.packetClientbound = new PacketClientbound(
            this, 
            additionalClientboundListen,
        );

        this.hasBeenDestroyed = false;

        this.clear();
    }

    public clear() { }

    public connect() {
        this.socket = new WebSocket(location.protocol.replace("http", "ws") + "//" + location.host + "/ws");
        this.socket.binaryType = "arraybuffer";

        this.socket.addEventListener("open", () => {
            this.onConnect();
        });

        this.socket.addEventListener("close", () => {
            this.clear();

            // Unintended close, reconnect
            if (!this.hasBeenDestroyed) {
                setTimeout(() => {
                    this.connect();
                }, 500);
            }
        });

        this.socket.addEventListener("message", ({ data }) => {
            if (!(data instanceof ArrayBuffer)) {
                return;
            }

            try {
                data = new Uint8Array(data);
                this.packetClientbound.read(data);
            } catch (error) {
                console.error("Error processing packet:", error);
                // Continue processing other packets even if one fails
            }
        });

        this.socket.addEventListener("error", (error) => {
            console.error("WebSocket error:", error);
        });
    }

    public destroy() {
        this.hasBeenDestroyed = true;
        this.socket.close();
    }

    private onConnect() { }
}