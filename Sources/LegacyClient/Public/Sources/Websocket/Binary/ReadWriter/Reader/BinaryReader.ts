import swapEndian32 from "../BinaryReadWriterSwapEndian32";

const sharedBuffer = new ArrayBuffer(8);
const byteArray = new Uint8Array(sharedBuffer);
const uint32Array = new Uint32Array(sharedBuffer);
const float32Array = new Float32Array(sharedBuffer);
const float64Array = new Float64Array(sharedBuffer);

const textDecoder = new TextDecoder();

export type ReadableDataType = ArrayLike<number> | ArrayBuffer;

export default class BinaryReader {
    public buffer: Uint8Array;
    public at: number;

    constructor(buffer: ReadableDataType) {
        this.set(buffer);
    }

    public set(buffer: ReadableDataType): this {
        this.at = 0;
        this.buffer = new Uint8Array(buffer);

        return this;
    }

    public isEOF(): boolean {
        return this.at >= this.buffer.byteLength;
    }

    private checkBounds(bytesNeeded: number): void {
        if (this.at + bytesNeeded > this.buffer.byteLength) {
            throw new Error(`Read out of bounds: need ${bytesNeeded} bytes but only ${this.buffer.byteLength - this.at} available`);
        }
    }

    public readBytes(length: number): Uint8Array {
        this.checkBounds(length);
        const slice = this.buffer.slice(this.at, this.at + length);

        this.at += length;

        return slice;
    }

    public readUInt8(): number {
        this.checkBounds(1);
        return this.buffer[this.at++];
    }

    public readInt8(): number {
        const value = this.readUInt8();

        return value >> 0 ^ 0 - (value & 1);
    }

    public readUInt16(): number {
        let value = 0;

        return (value |= this.readUInt8() << 0) | this.readUInt8() << 8;
    }

    public readInt16(): number {
        const value = this.readUInt16();

        return value >> 0 ^ 0 - (value & 1);
    }

    public readUInt24(): number {
        let value = 0;

        return (value = (value |= this.readUInt8() << 0) | this.readUInt8() << 8) | this.readUInt8() << 16;
    }

    public readInt24(): number {
        const value = this.readUInt24();

        return value >> 0 ^ 0 - (value & 1);
    }

    public readUInt32(): number {
        let value = 0;

        return (value = (value = (value |= this.readUInt8() << 0) | this.readUInt8() << 8) | this.readUInt8() << 16) | this.readUInt8() << 24;
    }

    public readInt32(): number {
        const value = this.readUInt32();

        return value >> 0 ^ 0 - (value & 1);
    }

    public readFloat32(): number {
        this.checkBounds(4);
        byteArray.set(this.buffer.subarray(this.at, this.at + 4));
        this.at += 4;

        return float32Array[0];
    }

    public readFloat64(): number {
        this.checkBounds(8);
        byteArray.set(this.buffer.subarray(this.at, this.at + 8));
        this.at += 8;

        return float64Array[0];
    }

    public readVarUInt32(): number {
        return Number(this.readVarUInt64());
    }

    public readVarInt32(): number {
        return Number(this.readVarInt64());
    }

    public readVarUInt64(): bigint {
        let result = 0n;
        let shift = 0;

        while (shift < 64) {
            if (this.isEOF()) {
                throw new Error("Unexpected end of buffer while reading variable-length integer");
            }
            
            const byte = BigInt(this.readUInt8());

            result |= (0x7fn & byte) << BigInt(shift);

            if (0x0n === (0x80n & byte)) {
                break;
            }

            shift += 7;
        }

        if (shift >= 64) {
            throw new Error("Variable-length integer exceeds 64 bits");
        }

        return result;
    }

    public readVarInt64(): bigint {
        let value = this.readVarUInt64();
        
        if (0x1n & value) {
            value = -(value + 0x1n) / 0x2n;
        } else {
            value /= 0x2n;
        }

        return value;
    }

    public readVarFloat32(): number {
        uint32Array[0] = swapEndian32(this.readVarInt32());

        return float32Array[0];
    }

    public readBoolean(): boolean {
        return Boolean(this.readUInt8());
    }

    public readString(): string {
        const startPos = this.at;
        let length = 0;
        const maxLength = this.buffer.byteLength - startPos;

        while (length < maxLength) {
            const pos = startPos + length;
            
            if (this.buffer[pos] === 0) {
                break;
            }

            length++;
        }

        if (length >= maxLength) {
            // No null terminator found, return empty string or throw
            console.warn("String read without null terminator, returning empty string");
            this.at = this.buffer.byteLength; // Advance to end to prevent further reads
            return "";
        }

        const bytes = this.readBytes(length);

        this.readUInt8(); // Skip null terminator

        try {
            return textDecoder.decode(bytes);
        } catch (error) {
            console.error("Error decoding string:", error);
            return ""; // Return empty string on decode error
        }
    }
}