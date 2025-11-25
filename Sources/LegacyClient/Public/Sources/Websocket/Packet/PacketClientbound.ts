import type { ReadableDataType } from "../Binary/ReadWriter/Reader/BinaryReader";
import BinaryReader from "../Binary/ReadWriter/Reader/BinaryReader";
import type ClientWebsocket from "../ClientWebsocket";
import { Clientbound, ClientboundConnectionKickReason } from "./PacketOpcode";

export type StaticAdheredClientboundHandlers = Partial<Readonly<Record<Clientbound, (reader: BinaryReader) => void>>>;

export type DynamicAdheredClientboundHandlers = () => StaticAdheredClientboundHandlers;

export type AdheredClientboundHandlers = StaticAdheredClientboundHandlers | DynamicAdheredClientboundHandlers;

export default class PacketClientbound {
    /**
     * @param adheredClientboundHandlers - Additional listener function to custom game
     */
    constructor(
        private clientWebSocket: ClientWebsocket,
        private adheredClientboundHandlers: AdheredClientboundHandlers = {},
    ) { }

    public read(data: ReadableDataType) {
        try {
            const reader = new BinaryReader(data);

            if (reader.isEOF()) {
                console.warn("Received empty packet");
                return;
            }

            const opcode = reader.readUInt8() satisfies Clientbound;

            const listen = this.computeAdheredClientboundHandlers(this.adheredClientboundHandlers);
            if (listen.hasOwnProperty(opcode)) {
                try {
                    listen[opcode](reader);
                } catch (error) {
                    console.error(`Error handling packet opcode ${opcode}:`, error);
                }
                return;
            }

            switch (opcode) {
                case Clientbound.CONNECTION_KICKED: {
                    this.readPacketConnectionKick(reader);
                    break;
                }
                default: {
                    console.warn(`Unknown packet opcode: ${opcode}`);
                }
            }
        } catch (error) {
            console.error("Error reading packet:", error);
            throw error; // Re-throw to be caught by caller
        }
    }

    private computeAdheredClientboundHandlers(handlers: AdheredClientboundHandlers): StaticAdheredClientboundHandlers {
        return handlers instanceof Function ? handlers() : handlers;
    }

    public readPacketConnectionKick(reader: BinaryReader) {
        const kickReasonKind = reader.readUInt8();

        this.clientWebSocket.destroy();

        switch (kickReasonKind) {
            case ClientboundConnectionKickReason.OUTDATED_CLIENT: {
                setTimeout(() => {
                    location.reload();
                }, 500);

                break;
            }
        }
    }
}