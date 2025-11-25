import Mob from "../../Entity/Mob";
import Player from "../../Entity/Player";
import { renderEntity } from "../../Entity/Renderers/RendererRenderingLink";
import { interpolate } from "../../Utils/Interpolator";
import AbstractUI, { uiScaleFactor } from "../UI";
import SettingStorage from "../../Utils/SettingStorage";
import StaticText from "../Layout/Components/WellKnown/StaticText";
import TextInput from "../Layout/Components/WellKnown/TextInput";
import type { Rarity } from "../../Native/Rarity";
import { Button } from "../Layout/Components/WellKnown/Button";
import type { StaticAdheredClientboundHandlers } from "../../Websocket/Packet/PacketClientbound";
import UICloseButton from "../Shared/UICloseButton";
import type { AnimationConfigOf, ComponentCloser, DummySetVisibleToggleType } from "../Layout/Components/Component";
import { AnimationType, renderPossibleComponent } from "../Layout/Components/Component";
import { CoordinatedStaticSpace, StaticSpace, StaticTranslucentPanelContainer, StaticVContainer } from "../Layout/Components/WellKnown/Container";
import { InlineRendering } from "../Layout/Extensions/ExtensionInlineRendering";
import UIGameWaveMobIcons from "./UIGameWaveMobIcons";
import UIGameInventory from "./UIGameInventory";
import { Centering } from "../Layout/Extensions/ExtensionCentering";
import Gauge from "../Layout/Components/WellKnown/Gauge";
import UIGamePlayerStatuses from "./UIGamePlayerStatuses";
import { MoodFlags } from "../../Native/Entity/Player/PlayerMood";
import { clientWebsocket, deltaTime, antennaScaleFactor, uiCtx } from "../../../../Application";
import { isPetal } from "../../Entity/Petal";
import type BinaryReader from "../../Websocket/Binary/ReadWriter/Reader/BinaryReader";
import { Clientbound } from "../../Websocket/Packet/PacketOpcode";
import { Biome, BIOME_DISPLAY_NAME, BIOME_GAUGE_COLORS } from "../../Native/Biome";
import TileRenderer, { BIOME_TILESETS } from "../Shared/Tile/Tileset/TilesetRenderer";
import { MobType, PetalType } from "../../Native/Entity/EntityType";

let interpolatedMouseX = 0;
let interpolatedMouseY = 0;

let mouseXOffset = 0;
let mouseYOffset = 0;

const TAU = 2 * Math.PI;

function angleToRad(angle: number) {
    return angle / 255 * TAU;
}

/**
 * Calculate wave length.
 * 
 * @param x - Wave progress
 */
export const calculateWaveLength = (x: number) => Math.max(60, x ** 0.2 * 18.9287 + 30);

interface LightningBounce {
    points: Array<[number, number]>;
    t: number;

    path?: Path2D;
}

function prepareLightningBouncePath({ points }: LightningBounce): Path2D {
    const path = new Path2D();

    const addRandomOffset = (value: number, magnitude: number = 2) => {
        const randomFactor = (Math.random() - 0.5) * 2;

        return value + (randomFactor * magnitude);
    };

    // If lightning points length is equals to one, add distorted that one point, to render correctly
    if (points.length === 1) {
        const [x, y] = points[0];

        points.push([
            addRandomOffset(x),
            addRandomOffset(y),
        ]);
    }

    path.moveTo(...points[0]);

    for (let i = 0; i < points.length - 1; i++) {
        const startPoint = points[i];
        const endPoint = points[i + 1];
        const dx = endPoint[0] - startPoint[0];
        const dy = endPoint[1] - startPoint[1];
        const totalDistance = Math.hypot(dx, dy);

        let currentDistance = 0;

        while (currentDistance < totalDistance) {
            const JITTER_AMOUNT = 25;

            const ratio = currentDistance / totalDistance;
            const jitterX = (Math.random() * 2 - 1) * JITTER_AMOUNT;
            const jitterY = (Math.random() * 2 - 1) * JITTER_AMOUNT;

            path.lineTo(
                startPoint[0] + ratio * dx + jitterX,
                startPoint[1] + ratio * dy + jitterY,
            );

            currentDistance += Math.random() * 50 + 50;
        }

        path.lineTo(...endPoint);
    }

    return path;
}

const enum EntityKind {
    PLAYER,
    MOB,
    PETAL,
}

export default class UIGame extends AbstractUI {
    private static readonly DEAD_BACKGROUND_TARGET_OPACITY = 0.3 as const;
    private static readonly DEAD_BACKGROUND_FADE_DURATION = 0.3 as const;

    private tilesetRenderer: TileRenderer = new TileRenderer();

    private players: Map<number, Player> = new Map();
    private mobs: Map<number, Mob> = new Map();

    private lightningBounces: Array<LightningBounce> = new Array();

    private waveInformationContainer: StaticVContainer;
    private waveMobIcons: UIGameWaveMobIcons;

    private playerStatuses: UIGamePlayerStatuses;

    private inventory: UIGameInventory;

    private updateT: number;
    private t: number;

    private waveProgress: number;

    private waveProgressTimer: number;
    private waveProgressRedGageTimer: number;

    /**
     * Wave room state is Ended or not.
     */
    private wasWaveEnded: boolean;

    private mapRadius: number;
    private oMapRadius: number;
    private nMapRadius: number;

    private deadMenuBackgroundOpacity: number;

    private static readonly DEAD_MENU_CONTAINER_ANIMATION_CONFIG = {
        defaultDurationOverride: 2500,

        direction: "v",
        offset: 300,
        offsetSign: 1,
        fadeEffectEnabled: false,
    } as const satisfies AnimationConfigOf<AnimationType.SLIDE>;

    private deadMenuContainer: StaticVContainer;
    private wasDeadMenuContinued: boolean;

    private gameOverMenuContainer: StaticVContainer;

    private youWillRespawnNextWaveContainer: StaticTranslucentPanelContainer;

    private chatInput: TextInput;
    private chatContainer: StaticVContainer;

    private currentMoodFlags: number;

    public waveSelfId: number = -1;

    // W,A,S,D
    private movementKeys: [boolean, boolean, boolean, boolean] = [false, false, false, false];
    private lastMovementKeyAngle: number = 0;

    override biome: Biome = Biome.GARDEN;

    override readonly CLIENTBOUND_HANDLERS = {
        [Clientbound.WAVE_SELF_ID]: (reader: BinaryReader): void => {
            this.waveSelfId = reader.readVarUInt32();
        },
        [Clientbound.WAVE_UPDATE]: (reader: BinaryReader): void => {
            try {
                { // Wave informations
                    const waveProgress = reader.readVarUInt32();

                const waveProgressTimer = reader.readFloat32();

                const waveProgressRedGageTimer = reader.readFloat32();

                const waveEnded = reader.readBoolean();

                // World size
                const waveMapRadius = reader.readVarUInt32();

                this.waveProgress = waveProgress;

                this.waveProgressTimer = waveProgressTimer;

                this.waveProgressRedGageTimer = waveProgressRedGageTimer;

                this.wasWaveEnded = waveEnded;

                this.nMapRadius = waveMapRadius;
                this.oMapRadius = this.mapRadius;

                this.updateT = 0;
            }

            { // Read eliminated entities
                const eliminatedEntitiesCount = reader.readVarUInt32();
                
                // Validate eliminated entities count
                if (!Number.isFinite(eliminatedEntitiesCount) || eliminatedEntitiesCount < 0 || eliminatedEntitiesCount > 10000) {
                    throw new Error(`Invalid eliminated entities count: ${eliminatedEntitiesCount}`);
                }

                for (let i = 0; i < eliminatedEntitiesCount; i++) {
                    if (reader.isEOF()) {
                        throw new Error(`Unexpected end of buffer while reading eliminated entity ${i + 1} of ${eliminatedEntitiesCount}`);
                    }
                    const entityId = reader.readVarUInt32();

                    if (this.mobs.has(entityId)) {
                        const mob = this.mobs.get(entityId);

                        mob.isDead = true;

                        continue;
                    }

                    if (this.players.has(entityId)) {
                        const player = this.players.get(entityId);

                        player.wasEliminated = true;

                        player.isDead = true;

                        // Maybe player is already dead and got revived, deadT is maybe half
                        player.deadT = 0;
                        player.health = 0;

                        // Remove from status
                        this.playerStatuses.removePlayer(player, this.waveSelfId === player.id);

                        continue;
                    }
                }
            }

            { // Read lightning bounces
                const lightningBouncesCount = reader.readVarUInt32();
                
                // Validate lightning bounces count
                if (!Number.isFinite(lightningBouncesCount) || lightningBouncesCount < 0 || lightningBouncesCount > 1000) {
                    throw new Error(`Invalid lightning bounces count: ${lightningBouncesCount}`);
                }

                for (let i = 0; i < lightningBouncesCount; i++) {
                    if (reader.isEOF()) {
                        throw new Error(`Unexpected end of buffer while reading lightning bounce ${i + 1}`);
                    }
                    
                    const positionsCount = reader.readVarUInt32();
                    
                    if (!Number.isFinite(positionsCount) || positionsCount < 0 || positionsCount > 100) {
                        throw new Error(`Invalid positions count in lightning bounce: ${positionsCount}`);
                    }

                    const bounce: LightningBounce = {
                        points: [],
                        t: 1,
                    };

                    for (let j = 0; j < positionsCount; j++) {
                        const x = reader.readFloat32();
                        const y = reader.readFloat32();

                        bounce.points.push([x, y]);
                    }

                    bounce.path = prepareLightningBouncePath(bounce);

                    this.lightningBounces.push(bounce);
                }
            }

            { // Read entities
                const entityCount = reader.readVarUInt32();
                
                // Validate entity count to prevent reading too many entities
                if (!Number.isFinite(entityCount) || entityCount < 0 || entityCount > 10000) {
                    throw new Error(`Invalid entity count: ${entityCount}`);
                }

                // Track the starting position for this entity list in case we need to validate
                const entitiesStartPos = reader.at;

                for (let i = 0; i < entityCount; i++) {
                    // Store position before reading entity kind to help with debugging
                    let entityStartPos = reader.at;
                    
                    try {
                        // Check if we've run out of buffer before reading each entity
                        if (reader.isEOF()) {
                            console.warn(`Unexpected end of buffer while reading entity ${i + 1} of ${entityCount}, stopping packet processing`);
                            throw new Error(`Unexpected end of buffer while reading entity ${i + 1} of ${entityCount}`);
                        }
                        
                        const entityKind = reader.readUInt8() as EntityKind;
                        
                        // Validate entity kind - if invalid, buffer is definitely misaligned
                        if (entityKind !== EntityKind.PLAYER && entityKind !== EntityKind.MOB && entityKind !== EntityKind.PETAL) {
                            // Invalid entity kind means the buffer is misaligned - stop processing the entire packet
                            throw new Error(`Invalid entity kind: ${entityKind} (expected 0, 1, or 2) at entity ${i + 1}, buffer position ${entityStartPos}. Buffer is misaligned, stopping packet processing.`);
                        }

                        switch (entityKind) {
                        case EntityKind.PLAYER: {
                            const playerId = reader.readVarUInt32();

                            const playerX = reader.readFloat32();
                            const playerY = reader.readFloat32();

                            const playerAngle = angleToRad(reader.readFloat32());

                            const playerHealth = reader.readFloat32();

                            const playerSize = reader.readFloat32();

                            const playerMood = reader.readUInt8();

                            const playerName = reader.readString();

                            // Decode boolean flags
                            const bFlags = reader.readUInt8();

                            const playerIsDead = Boolean(bFlags & 1),
                                playerIsDev = Boolean(bFlags & 2),
                                playerIsPoisoned = Boolean(bFlags & 4);
                            // Note: bit 8 (0x8) is "proper-damaged" but we don't use it client-side

                            // Comprehensive validation of player data
                            if (!Number.isFinite(playerId) || playerId < 0 || playerId > 0xFFFFFFFF ||
                                !Number.isFinite(playerX) || !Number.isFinite(playerY) ||
                                !Number.isFinite(playerAngle) ||
                                !Number.isFinite(playerHealth) || playerHealth < 0 || playerHealth > 1000 ||
                                !Number.isFinite(playerSize) || playerSize <= 0 || playerSize > 1000 ||
                                typeof playerName !== 'string' || playerName.length === 0 || playerName.length > 100) {
                                throw new Error(`Invalid player data (id: ${playerId}, name: ${playerName?.substring(0, 20)})`);
                            }
                            
                            const player = this.players.get(playerId);
                            if (player) {
                                // Validate player instance before updating
                                if (!(player instanceof Player)) {
                                    console.warn(`Player with id ${playerId} is not a valid Player instance, removing`);
                                    this.players.delete(playerId);
                                    continue;
                                }
                                
                                player.nx = playerX;
                                player.ny = playerY;

                                player.nAngle = playerAngle;

                                player.nSize = playerSize;

                                { // Update health properties
                                    if (!player.isPoison && playerHealth < player.nHealth) {
                                        player.redHealthTimer = 1;
                                        player.hurtT = 1;
                                    } else if (playerHealth > player.nHealth) {
                                        player.redHealthTimer = 0;
                                    }

                                    player.nHealth = playerHealth;
                                }

                                player.mood = playerMood;

                                player.isDead = playerIsDead;

                                player.isDev = playerIsDev;

                                player.ox = player.x;
                                player.oy = player.y;

                                player.oAngle = player.angle;

                                player.oSize = player.size;

                                player.oHealth = player.health;

                                player.isPoison = playerIsPoisoned;

                                player.updateT = 0;
                            } else {
                                const player = new Player(
                                    playerId,

                                    playerX,
                                    playerY,

                                    playerAngle,

                                    playerSize,

                                    playerHealth,

                                    playerMood,

                                    playerName,
                                );

                                this.players.set(playerId, player);

                                // Add status
                                this.playerStatuses.addPlayer(player, this.waveSelfId === player.id);
                            }

                            break;
                        }

                        case EntityKind.MOB: {
                            const mobId = reader.readVarUInt32();

                            const mobX = reader.readFloat32();
                            const mobY = reader.readFloat32();

                            const mobAngle = angleToRad(reader.readFloat32());

                            const mobHealth = reader.readFloat32();

                            const mobSize = reader.readFloat32();

                            const mobType = reader.readUInt8();

                            const mobRarity = reader.readUInt8() as Rarity;

                            // Decode boolean flags
                            const bFlags = reader.readUInt8();

                            const mobIsPet = Boolean(bFlags & 1),
                                mobIsFirstSegment = Boolean(bFlags & 2),
                                mobHasConnectingSegment = Boolean(bFlags & 4),
                                mobIsPoisoned = Boolean(bFlags & 8);
                            // Note: bit 16 (0x10) is "proper-damaged" but we don't use it client-side

                            let mobConnectingSegment: Mob = null;

                            if (mobHasConnectingSegment) {
                                const connectingSegmentModId = reader.readVarUInt32();

                                mobConnectingSegment = this.mobs.get(connectingSegmentModId);
                            }

                            // Comprehensive validation of mob data
                            // Mobs should only accept mob types (0-25), not petal types (26-40)
                            // Petal types should only be created in the PETAL case
                            const isValidMobType = mobType >= 0 && mobType <= 25;
                            const isPetalType = mobType >= 26 && mobType <= 40;
                            
                            // If we detect a petal type in a mob entity, the buffer is likely misaligned
                            if (isPetalType) {
                                throw new Error(`Invalid mob type: ${mobType} is a petal type, not a mob type. Buffer may be misaligned.`);
                            }
                            
                            if (!Number.isFinite(mobId) || mobId < 0 || mobId > 0xFFFFFFFF ||
                                !Number.isFinite(mobX) || !Number.isFinite(mobY) ||
                                !Number.isFinite(mobAngle) ||
                                !Number.isFinite(mobHealth) || mobHealth < 0 || mobHealth > 10000 ||
                                !Number.isFinite(mobSize) || mobSize <= 0 || mobSize > 1000 ||
                                !isValidMobType ||
                                mobRarity === undefined || mobRarity < 0 || mobRarity >= 7) {
                                throw new Error(`Invalid mob data: id=${mobId}, type=${mobType} (valid: ${isValidMobType}), rarity=${mobRarity}, x=${mobX}, y=${mobY}, health=${mobHealth}, size=${mobSize}`);
                            }
                            
                            let mob = this.mobs.get(mobId);
                            if (mob) {
                                // Validate mob instance before updating
                                if (!(mob instanceof Mob)) {
                                    console.warn(`Mob with id ${mobId} is not a valid Mob instance, removing`);
                                    this.mobs.delete(mobId);
                                    continue;
                                }
                                
                                mob.nx = mobX;
                                mob.ny = mobY;

                                mob.nAngle = mobAngle;

                                mob.nSize = mobSize;

                                mob.connectingSegment = mobConnectingSegment;

                                { // Update health properties
                                    const parentMob = Mob.traverseSegments(mob);

                                    // TODO: original game can hurtT = 1 when poisoned
                                    // But do that can affect to color always
                                    if (!mob.isPoison && mobHealth < mob.nHealth) {
                                        parentMob.redHealthTimer = 1;
                                        parentMob.hurtT = 1;
                                    } else if (mobHealth > mob.nHealth) {
                                        parentMob.redHealthTimer = 0;
                                    }

                                    mob.nHealth = mobHealth;
                                }

                                mob.ox = mob.x;
                                mob.oy = mob.y;

                                mob.oAngle = mob.angle;

                                mob.oSize = mob.size;

                                mob.oHealth = mob.health;

                                mob.isPoison = mobIsPoisoned;

                                mob.updateT = 0;
                            } else {
                                mob = new Mob(
                                    mobId,

                                    mobX,
                                    mobY,

                                    mobAngle,

                                    mobSize,

                                    mobHealth,

                                    mobType,
                                    mobRarity,

                                    mobIsPet,

                                    mobIsFirstSegment,

                                    mobConnectingSegment,
                                );

                                if (this.waveMobIcons.isIconableMobInstance(mob)) {
                                    this.waveMobIcons.addMobIcon(mob);
                                }

                                this.mobs.set(mobId, mob);
                            }

                            if (mobConnectingSegment && !mobConnectingSegment.connectedSegments.has(mob)) {
                                mobConnectingSegment.connectedSegments.add(mob);
                            }

                            break;
                        }

                        case EntityKind.PETAL: {
                            const petalId = reader.readVarUInt32();

                            const petalX = reader.readFloat32();
                            const petalY = reader.readFloat32();

                            const petalAngle = angleToRad(reader.readFloat32());

                            const petalHealth = reader.readFloat32();

                            const petalSize = reader.readFloat32();

                            const petalType = reader.readUInt8();

                            const petalRarity = reader.readUInt8() as Rarity;

                            // Read boolean flags (matching modern client)
                            // Server writes: bit 1 = was_proper_damaged
                            const petalBFlags = reader.readUInt8();
                            // Note: We don't use was_proper_damaged client-side, but we must read the byte

                            // Comprehensive validation of petal data
                            // Note: Server sends petal types as 0-15 (Go enum), but TypeScript expects 26-40
                            // Accept both ranges for compatibility
                            // However, types 16-25 are mob types and should not appear in petal entities
                            const isValidPetalTypeServer = petalType >= 0 && petalType <= 15; // Go server enum range
                            const isValidPetalTypeClient = petalType >= 26 && petalType <= 40; // TypeScript enum range
                            const isMobType = petalType >= 16 && petalType <= 25; // Mob types that should not be petals
                            const isValidPetalType = isValidPetalTypeServer || isValidPetalTypeClient;
                            
                            // If we detect a mob type in a petal entity, the buffer is likely misaligned
                            if (isMobType) {
                                throw new Error(`Invalid petal type: ${petalType} is a mob type (MISSILE_PROJECTILE/WEB_PROJECTILE range), not a petal type. Buffer may be misaligned.`);
                            }
                            
                            // Validate each field individually for better error messages
                            if (!Number.isFinite(petalId) || petalId < 0 || petalId > 0xFFFFFFFF) {
                                throw new Error(`Invalid petal id: ${petalId}`);
                            }
                            if (!Number.isFinite(petalX) || !Number.isFinite(petalY)) {
                                throw new Error(`Invalid petal position: x=${petalX}, y=${petalY}`);
                            }
                            if (!Number.isFinite(petalAngle)) {
                                throw new Error(`Invalid petal angle: ${petalAngle}`);
                            }
                            if (!Number.isFinite(petalHealth) || petalHealth < 0 || petalHealth > 10000) {
                                throw new Error(`Invalid petal health: ${petalHealth}`);
                            }
                            if (!Number.isFinite(petalSize) || petalSize <= 0 || petalSize > 1000) {
                                throw new Error(`Invalid petal size: ${petalSize}`);
                            }
                            if (!isValidPetalType) {
                                throw new Error(`Invalid petal type: ${petalType} (expected 0-15 or 26-40)`);
                            }
                            if (petalRarity === undefined || petalRarity < 0 || petalRarity >= 7) {
                                throw new Error(`Invalid petal rarity: ${petalRarity} (expected 0-6)`);
                            }
                            
                            const petal = this.mobs.get(petalId);
                            if (petal) {
                                // Validate petal instance before updating
                                if (!(petal instanceof Mob)) {
                                    console.warn(`Petal with id ${petalId} is not a valid Mob instance, removing`);
                                    this.mobs.delete(petalId);
                                    continue;
                                }
                                
                                petal.nx = petalX;
                                petal.ny = petalY;

                                petal.nAngle = petalAngle;

                                petal.nSize = petalSize;

                                { // Update health properties
                                    // Note: Modern client uses was_proper_damaged flag, but we use health comparison
                                    if (petalHealth < petal.nHealth) {
                                        petal.redHealthTimer = 1;
                                        petal.hurtT = 1;
                                    } else if (petalHealth > petal.nHealth) {
                                        petal.redHealthTimer = 0;
                                    }

                                    petal.nHealth = petalHealth;
                                }

                                petal.ox = petal.x;
                                petal.oy = petal.y;

                                petal.oAngle = petal.angle;

                                petal.oSize = petal.size;

                                petal.oHealth = petal.health;

                                petal.updateT = 0;
                            } else {
                                // Petal treated as mob
                                this.mobs.set(petalId, new Mob(
                                    petalId,

                                    petalX,
                                    petalY,

                                    petalAngle,

                                    petalSize,

                                    petalHealth,

                                    petalType,
                                    petalRarity,

                                    false,

                                    false,

                                    null,
                                ));
                            }

                            break;
                        }
                        } // Close switch statement
                    } catch (entityError) {
                        // If reading an entity fails, the buffer is misaligned - stop processing immediately
                        // We can't recover from buffer misalignment, so we must stop processing this packet
                        console.error(`Error reading entity ${i + 1} of ${entityCount} at buffer position ${entityStartPos}, buffer misaligned. Stopping packet processing:`, entityError);
                        // Re-throw to be caught by outer try-catch, which will stop processing the entire packet
                        throw entityError;
                    }
                }
            }
                
                // Send ack
                clientWebsocket.packetServerbound.sendAck([
                    this.canvas.width / uiScaleFactor + 500,
                    this.canvas.height / uiScaleFactor + 500
                ]);
            } catch (error) {
                console.error("Error reading WAVE_UPDATE packet, stopping processing to prevent corruption:", error);
                // Don't process the rest of the packet if there's an error
                // This prevents misaligned reads that would create corrupted entities
                return;
            }
        },
        [Clientbound.WAVE_CHAT_RECEIV]: (reader: BinaryReader): void => {
            const lines = reader.readString();

            lines.split("\n").forEach(message => {
                this.chatContainer.addChildren(
                    new StaticText(
                        {
                            y: 2,
                        },

                        message,
                        10,
                    ),
                    new StaticSpace(0, 3),
                );
            });
        },
    } as const satisfies StaticAdheredClientboundHandlers;

    constructor(canvas: HTMLCanvasElement) {
        super(canvas);

        this.waveProgress = 0;

        this.updateT = 0;

        this.waveProgressTimer = this.waveProgressRedGageTimer = this.mapRadius = 0;
        this.oMapRadius = 0;
        this.nMapRadius = 0;

        this.wasDeadMenuContinued = false;

        this.deadMenuBackgroundOpacity = 0;

        this.wasWaveEnded = false;

        this.currentMoodFlags = 0;

        { // Setup listeners
            this.on("onKeyDown", (event: KeyboardEvent) => {
                if (!this.isOperative) return;

                switch (event.key) {
                    // Space mean space
                    case " ": {
                        this.currentMoodFlags |= MoodFlags.ANGRY;

                        clientWebsocket.packetServerbound.sendWaveChangeMood(this.currentMoodFlags);

                        break;
                    }

                    case "Shift": {
                        this.currentMoodFlags |= MoodFlags.SAD;

                        clientWebsocket.packetServerbound.sendWaveChangeMood(this.currentMoodFlags);

                        break;
                    }

                    case "Enter": {
                        if (this.chatInput.isFocused) {
                            this.chatInput.blur();
                        } else {
                            const selfPlayer = this.players.get(this.waveSelfId);
                            if (!selfPlayer) {
                                return;
                            }

                            if (selfPlayer.isDead) {
                                if (this.wasDeadMenuContinued) this.leaveGame();

                                if (!this.wasDeadMenuContinued) {
                                    this.wasDeadMenuContinued = true;
                                }
                            }

                            if (this.chatInput) this.chatInput.focus();
                        }

                        break;
                    }

                    default: {
                        // Slot swapping
                        if (
                            // Dont swap while chatting
                            !this.chatInput.isFocused
                        ) {
                            if (event.code.startsWith("Digit")) {
                                let index = parseInt(event.code.slice(5));
                                if (index === 0) {
                                    index = 10;
                                }

                                index--;

                                clientWebsocket.packetServerbound.sendWaveSwapPetal(index);
                            }
                        }

                        break;
                    }
                }
            });

            this.on("onKeyUp", (event: KeyboardEvent) => {
                if (!this.isOperative) return;

                switch (event.key) {
                    // Space means space
                    case " ": {
                        this.currentMoodFlags &= ~MoodFlags.ANGRY;

                        clientWebsocket.packetServerbound.sendWaveChangeMood(this.currentMoodFlags);

                        break;
                    }

                    case "Shift": {
                        this.currentMoodFlags &= ~MoodFlags.SAD;

                        clientWebsocket.packetServerbound.sendWaveChangeMood(this.currentMoodFlags);

                        break;
                    }
                }
            });

            this.on("onMouseDown", (event: MouseEvent) => {
                if (!this.isOperative) return;

                if (event.button === 0) {
                    this.currentMoodFlags |= MoodFlags.ANGRY;

                    clientWebsocket.packetServerbound.sendWaveChangeMood(this.currentMoodFlags);
                }

                if (event.button === 2) {
                    this.currentMoodFlags |= MoodFlags.SAD;

                    clientWebsocket.packetServerbound.sendWaveChangeMood(this.currentMoodFlags);
                }
            });

            this.on("onMouseUp", (event: MouseEvent) => {
                if (!this.isOperative) return;

                if (event.button === 0) {
                    this.currentMoodFlags &= ~MoodFlags.ANGRY;

                    clientWebsocket.packetServerbound.sendWaveChangeMood(this.currentMoodFlags);
                }

                if (event.button === 2) {
                    this.currentMoodFlags &= ~MoodFlags.SAD;

                    clientWebsocket.packetServerbound.sendWaveChangeMood(this.currentMoodFlags);
                }
            });

            this.on("onMouseMove", (event: MouseEvent) => {
                if (!this.isOperative) return;

                mouseXOffset = event.clientX - document.documentElement.clientWidth / 2;
                mouseYOffset = event.clientY - document.documentElement.clientHeight / 2;

                if (
                    !SettingStorage.get("keyboard_control")
                ) {
                    const angle = Math.atan2(mouseYOffset, mouseXOffset);
                    const distance = Math.hypot(mouseXOffset, mouseYOffset) / uiScaleFactor;

                    clientWebsocket.packetServerbound.sendWaveChangeMove(
                        angle,
                        distance < 100 ? distance / 100 : 1,
                    );
                }
            });

            { // Setup WASD movement listeners
                this.on("onKeyDown", (event: KeyboardEvent) => {
                    if (!this.isOperative) return;

                    if (!SettingStorage.get("keyboard_control")) return;

                    switch (event.key.toLowerCase()) {
                        case "w": this.movementKeys[0] = true; break;
                        case "a": this.movementKeys[1] = true; break;
                        case "s": this.movementKeys[2] = true; break;
                        case "d": this.movementKeys[3] = true; break;
                    }

                    this.updateKeyboardMovement();
                });

                this.on("onKeyUp", (event: KeyboardEvent) => {
                    if (!this.isOperative) return;

                    if (!SettingStorage.get("keyboard_control")) return;

                    switch (event.key.toLowerCase()) {
                        case "w": this.movementKeys[0] = false; break;
                        case "a": this.movementKeys[1] = false; break;
                        case "s": this.movementKeys[2] = false; break;
                        case "d": this.movementKeys[3] = false; break;
                    }

                    this.updateKeyboardMovement();
                });
            }
        }
    }

    protected override onInitialize(): void {
        // Leave wave button
        this.addComponent(new UICloseButton(
            {
                x: 6,
                y: 6,
            },

            14,

            () => this.leaveGame(),
        ));

        this.addComponent(this.waveInformationContainer = new (InlineRendering(StaticVContainer))(
            () => ({
                x: -(this.waveInformationContainer.w / 2),
                y: 30,

                alignFromCenterX: true,
            }),
        ).addChildren(
            new (Centering(StaticText))(
                {},

                () => BIOME_DISPLAY_NAME[this.biome],
                16,
            ),

            new StaticSpace(0, 4),

            new (Centering(Gauge))(
                {
                    w: 140,
                    h: 12,
                },

                () => {
                    const maxWaveProgress = calculateWaveLength(this.waveProgress);

                    return [
                        {
                            value: this.waveProgressTimer,
                            maxValue: maxWaveProgress,

                            thickness: 0.75,

                            color: BIOME_GAUGE_COLORS[this.biome],
                            lowBehavior: "lineWidth",
                        },

                        {
                            value: this.waveProgressRedGageTimer,
                            maxValue: maxWaveProgress,

                            thickness: 0.6,

                            color: "#e32933",
                            lowBehavior: "lineWidth",
                        },
                    ];
                },
                0,
                () => "Wave " + this.waveProgress,
            ),

            new StaticSpace(0, 8),

            this.waveMobIcons = new (Centering(UIGameWaveMobIcons))({}),
        ));

        this.addComponent(this.playerStatuses = new (InlineRendering(UIGamePlayerStatuses))(
            () => ({
                x: 55,
                y: 60,
            }),
        ));

        {
            let deadMenuCloser: Button;

            this.deadMenuContainer = new StaticVContainer(
                () => ({
                    x: -(this.deadMenuContainer.w / 2),
                    y: -(this.deadMenuContainer.h / 2),

                    alignFromCenterX: true,
                    alignFromCenterY: true,
                }),

                false,
            ).addChildren(
                new (Centering(StaticText))(
                    {},
                    "You were destroyed by:",
                    12.2,
                ),

                new StaticSpace(2, 2),

                new (Centering(StaticText))(
                    {},
                    "Poison",
                    16.1,
                ),

                new StaticSpace(100, 100),

                (deadMenuCloser = new (Centering(Button))(
                    {
                        w: 88,
                        h: 24,
                    },

                    3,

                    3,
                    1,

                    [
                        new StaticText(
                            {
                                x: 3,
                                y: 2,
                            },

                            "Continue",
                            17,
                        ),
                    ],

                    () => {
                        this.wasDeadMenuContinued = true;

                        this.deadMenuContainer.setVisible(
                            false,
                            <ComponentCloser><unknown>deadMenuCloser,
                            true,
                            AnimationType.SLIDE,
                            UIGame.DEAD_MENU_CONTAINER_ANIMATION_CONFIG,
                        );
                    },

                    "#1dd129",
                    true,
                )),

                new StaticSpace(0, 4),

                new (Centering(StaticText))(
                    {},

                    "(or press enter)",
                    12,
                ),
            );

            this.deadMenuContainer.setVisible(false, null, false);

            this.addComponent(this.deadMenuContainer);
        }

        {
            this.gameOverMenuContainer = new StaticVContainer(
                () => ({
                    x: -(this.gameOverMenuContainer.w / 2),
                    y: -(this.gameOverMenuContainer.h / 2),

                    alignFromCenterX: true,
                    alignFromCenterY: true,
                }),

                false,
            ).addChildren(
                new (Centering(StaticText))(
                    {},

                    "GAME OVER",
                    34,
                    "#f0666b",
                ),

                new StaticSpace(20, 20),

                new (Centering(Button))(
                    {
                        w: 88,
                        h: 24,
                    },

                    3,

                    3,
                    1,

                    [
                        new StaticText(
                            {
                                x: 3,
                                y: 2,
                            },

                            "Continue",
                            17,
                        ),
                    ],

                    () => this.leaveGame(),

                    "#c62327",
                    true,
                ),
                new StaticSpace(0, 4),
                new (Centering(StaticText))(
                    {},

                    "(or press enter)",
                    12,
                ),
            );

            this.gameOverMenuContainer.setVisible(false, null, false);

            this.addComponent(this.gameOverMenuContainer);
        }

        {
            this.youWillRespawnNextWaveContainer = new StaticTranslucentPanelContainer(
                () => ({
                    x: -(this.youWillRespawnNextWaveContainer.w / 2),
                    y: -(this.youWillRespawnNextWaveContainer.h / 2) + 50,

                    alignFromCenterX: true,
                    alignFromCenterY: true,
                }),

                2,
            ).addChildren(
                new StaticText(
                    { y: 3 },

                    "You will respawn next wave",
                    10,
                ),
                new CoordinatedStaticSpace(1, 1, 0, 16),
            );

            this.youWillRespawnNextWaveContainer.setVisible(false, null, false);

            this.addComponent(this.youWillRespawnNextWaveContainer);
        }

        { // Chats
            this.addComponent(this.chatInput = new TextInput(
                {
                    x: 13,
                    y: 34,
                    w: 192,
                    h: 8,

                    invertYCoordinate: true,
                },

                {
                    canvas: this.canvas,

                    text: "",

                    fontSize: 11,
                    textColor: "#212121",

                    placeholder: "",
                    placeholderUnfocused: "Press [ENTER] or click here to chat",
                    showPlaceholderWhenUnfocused: true,

                    borderColor: "#000000",
                    borderRadius: 4,
                    borderWidth: 2.2,
                    maxLength: 80,

                    onSubmit: (e, self) => {
                        clientWebsocket.packetServerbound.sendWaveChat(self.value);

                        self.value = "";
                    },
                },
            ));

            let chatContainerParent: StaticTranslucentPanelContainer<StaticVContainer>;

            this.addComponent(
                chatContainerParent = new StaticTranslucentPanelContainer<StaticVContainer>(
                    () => ({
                        x: 11,
                        y: 37 + chatContainerParent.h,

                        invertYCoordinate: true,
                    }),

                    2,
                    () =>
                        this.chatInput.isFocused
                            ? 0.5
                            : 0,
                ).addChild(this.chatContainer = new StaticVContainer({})),
            );
        }

        this.addComponent(this.inventory = new (InlineRendering(UIGameInventory))(
            () => ({
                x: -(this.inventory.w / 2),
                y: 105,

                alignFromCenterX: true,
                invertYCoordinate: true,
            }),
        ));
    }

    override render() {
        // Interpolate
        {
            this.updateT += deltaTime / 100;
            this.t = Math.min(1, this.updateT);

            this.mapRadius = this.oMapRadius + (this.nMapRadius - this.oMapRadius) * this.t;

            interpolatedMouseX = interpolate(interpolatedMouseX, mouseXOffset / antennaScaleFactor, 50);
            interpolatedMouseY = interpolate(interpolatedMouseY, mouseYOffset / antennaScaleFactor, 50);
        }

        const { canvas } = this;
        const ctx = canvas.getContext("2d");

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const widthRelative = canvas.width / uiScaleFactor;
        const heightRelative = canvas.height / uiScaleFactor;

        const centerWidth = widthRelative / 2;
        const centerHeight = heightRelative / 2;

        const selfPlayer = this.players.get(this.waveSelfId);
        if (!selfPlayer) {
            // Render loading state when player data hasn't been received yet
            ctx.fillStyle = "#181818";
            ctx.fillRect(0, 0, widthRelative, heightRelative);
            ctx.fillStyle = "#ffffff";
            ctx.font = "24px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("Loading...", centerWidth, centerHeight);
            return;
        }

        // Render map
        this.tilesetRenderer.renderGameTileset({
            canvas,
            tileset: BIOME_TILESETS.get(this.biome),
            tileSize: 300,
            radius: this.mapRadius,
            playerX: selfPlayer.x,
            playerY: selfPlayer.y,
        });

        // Render mutable functions
        this.drawMutableFunctions(canvas);

        { // Update entities
            // Cleanup corrupted entities first
            const corruptedMobIds: number[] = [];
            this.mobs.forEach((mob, k) => {
                if (!mob || !(mob instanceof Mob)) {
                    corruptedMobIds.push(k);
                    return;
                }
                // Validate mob properties
                // Mobs should only have mob types (0-25), not petal types (26-40)
                const isValidMobType = mob.type >= 0 && mob.type <= 25;
                if (!Number.isFinite(mob.id) || !Number.isFinite(mob.x) || !Number.isFinite(mob.y) ||
                    !Number.isFinite(mob.size) || mob.size <= 0 || mob.size > 1000 ||
                    !isValidMobType) {
                    corruptedMobIds.push(k);
                    return;
                }
            });
            corruptedMobIds.forEach(id => {
                console.warn(`Removing corrupted mob with id ${id}`);
                this.mobs.delete(id);
            });
            
            this.mobs.forEach((mob, k) => {
                mob.update();

                if (
                    mob.isDead &&
                    mob.deadT > 1
                ) {
                    if (this.waveMobIcons.isIconableMobInstance(mob)) {
                        this.waveMobIcons.removeMobIcon(mob);
                    }

                    this.mobs.delete(k);

                    this.mobs.forEach((innerMob, k) => {
                        if (innerMob.connectedSegments.has(mob)) innerMob.connectedSegments.delete(mob);
                    });

                    if (mob.connectingSegment) mob.connectingSegment = null;
                }
            });

            // Cleanup corrupted players first
            const corruptedPlayerIds: number[] = [];
            this.players.forEach((player, k) => {
                if (!player || !(player instanceof Player)) {
                    corruptedPlayerIds.push(k);
                    return;
                }
                // Validate player properties
                if (!Number.isFinite(player.id) || !Number.isFinite(player.x) || !Number.isFinite(player.y) ||
                    !Number.isFinite(player.size) || player.size <= 0 || player.size > 1000 ||
                    typeof player.name !== 'string' || player.name.length === 0) {
                    corruptedPlayerIds.push(k);
                    return;
                }
            });
            corruptedPlayerIds.forEach(id => {
                console.warn(`Removing corrupted player with id ${id}`);
                this.players.delete(id);
            });
            
            this.players.forEach((player, k) => {
                player.update();

                // Only remove when disconnected
                if (
                    player.isDead &&
                    player.deadT > 1 &&
                    player.wasEliminated
                ) {
                    this.players.delete(k);
                }
            });
        }

        { // Render players & mobs
            const scaledWidth = canvas.width / (uiScaleFactor * antennaScaleFactor);
            const scaledHeight = canvas.height / (uiScaleFactor * antennaScaleFactor);
            const viewportWidth = scaledWidth + 500;
            const viewportHeight = scaledHeight + 500;

            const halfWidth = viewportWidth * 0.5;
            const halfHeight = viewportHeight * 0.5;

            const x0 = selfPlayer.x - halfWidth;
            const x1 = selfPlayer.x + halfWidth;
            const y0 = selfPlayer.y - halfHeight;
            const y1 = selfPlayer.y + halfHeight;

            const getEntitiesInViewport = () => {
                const viewportEntities: Array<Mob | Player> = [];

                const isInViewport = (entity: Mob | Player) => (
                    entity.x >= x0 &&
                    entity.x <= x1 &&
                    entity.y >= y0 &&
                    entity.y <= y1
                );

                for (const [id, mob] of this.mobs) {
                    // Validate mob before adding to viewport
                    if (!mob || !(mob instanceof Mob)) {
                        console.warn(`Removing invalid mob with id ${id} during rendering`);
                        this.mobs.delete(id);
                        continue;
                    }
                    
                    if (isInViewport(mob)) {
                        if (isPetal(mob.type)) {
                            viewportEntities.push(mob);
                        } else if (mob.type === MobType.WEB_PROJECTILE) {
                            viewportEntities.unshift(mob);
                        } else {
                            viewportEntities.push(mob);
                        }
                    }
                }

                for (const [id, player] of this.players) {
                    // Validate player before adding to viewport
                    if (!player || !(player instanceof Player)) {
                        console.warn(`Removing invalid player with id ${id} during rendering`);
                        this.players.delete(id);
                        continue;
                    }
                    
                    if (isInViewport(player)) {
                        viewportEntities.push(player);
                    }
                }

                return viewportEntities;
            };

            const renderLightningBounces = () => {
                const { lightningBounces } = this;
                if (!lightningBounces.length) return;

                ctx.strokeStyle = "#FFF";
                ctx.lineCap = "round";

                const dt500 = deltaTime / 500;

                let i = lightningBounces.length;

                while (i--) {
                    const bounce = lightningBounces[i];

                    bounce.t -= dt500;

                    if (bounce.t <= 0) {
                        lightningBounces.splice(i, 1);

                        continue;
                    }

                    ctx.globalAlpha = bounce.t;
                    ctx.lineWidth = bounce.t * 5;
                    ctx.stroke(bounce.path);
                }
            };

            const entitiesToDraw = getEntitiesInViewport().filter(entity => {
                // Final validation before rendering
                if (!entity || (!(entity instanceof Player) && !(entity instanceof Mob))) {
                    return false;
                }
                return true;
            });

            ctx.save();

            const viewScale = uiScaleFactor * antennaScaleFactor;

            ctx.setTransform(
                viewScale,
                0,
                0,
                viewScale,
                centerWidth * uiScaleFactor - selfPlayer.x * viewScale,
                centerHeight * uiScaleFactor - selfPlayer.y * viewScale,
            );

            for (const entity of entitiesToDraw) {
                renderEntity({ ctx, entity, isSpecimen: false });
            }

            renderLightningBounces();

            ctx.restore();
        }

        { // Render inlined components
            renderPossibleComponent(ctx, this.waveInformationContainer);

            renderPossibleComponent(ctx, this.playerStatuses);

            renderPossibleComponent(ctx, this.inventory);
        }

        { // Dead menu
            {
                ctx.save();

                ctx.globalAlpha = this.deadMenuBackgroundOpacity;
                ctx.fillStyle = "black";
                ctx.fillRect(0, 0, widthRelative, heightRelative);

                ctx.restore();
            }

            if (selfPlayer.isDead) {
                if (
                    this.deadMenuBackgroundOpacity < UIGame.DEAD_BACKGROUND_TARGET_OPACITY &&
                    !(this.wasDeadMenuContinued && !this.wasWaveEnded)
                ) {
                    this.deadMenuBackgroundOpacity = Math.min(
                        this.deadMenuBackgroundOpacity + (deltaTime / 1000 / UIGame.DEAD_BACKGROUND_FADE_DURATION) * UIGame.DEAD_BACKGROUND_TARGET_OPACITY,
                        UIGame.DEAD_BACKGROUND_TARGET_OPACITY,
                    );
                }

                if (this.wasDeadMenuContinued) {
                    if (this.wasWaveEnded) {
                        if (!this.gameOverMenuContainer.visible) {
                            this.gameOverMenuContainer.setVisible(true, null, true, AnimationType.FADE);
                        }

                        if (this.youWillRespawnNextWaveContainer.isOutAnimatable) {
                            this.youWillRespawnNextWaveContainer.setVisible(false, null, true, AnimationType.FADE, { defaultDurationOverride: 500 });
                        }
                    } else {
                        // Only fade-out when not game over
                        this.deadMenuBackgroundOpacity = Math.max(
                            this.deadMenuBackgroundOpacity - (deltaTime / 1000 / UIGame.DEAD_BACKGROUND_FADE_DURATION) * UIGame.DEAD_BACKGROUND_TARGET_OPACITY,
                            0,
                        );

                        if (!this.youWillRespawnNextWaveContainer.visible) {
                            this.youWillRespawnNextWaveContainer.setVisible(true, null, true, AnimationType.FADE, { defaultDurationOverride: 500 });
                        }
                    }
                } else {
                    // If not rendered dead menu, render it
                    if (!this.deadMenuContainer.visible) {
                        this.deadMenuContainer.setVisible(true, null, true, AnimationType.SLIDE, UIGame.DEAD_MENU_CONTAINER_ANIMATION_CONFIG);
                    }
                }
            } else {
                // Respawned, or not dead

                this.deadMenuBackgroundOpacity = 0;

                if (this.deadMenuContainer.isOutAnimatable) {
                    this.deadMenuContainer.setVisible(false, null, true, AnimationType.SLIDE, UIGame.DEAD_MENU_CONTAINER_ANIMATION_CONFIG);
                }

                if (this.youWillRespawnNextWaveContainer.isOutAnimatable) {
                    this.youWillRespawnNextWaveContainer.setVisible(false, null, true, AnimationType.FADE, { defaultDurationOverride: 500 });
                }
            }
        }

        this.renderComponents();
    }

    override destroy(): void {
        super.destroy();

        this.tilesetRenderer = null;

        this.players.clear();
        this.mobs.clear();
    }

    override onContextChange(): void {
        // Fake dead animation
        const player = this.players.get(this.waveSelfId);
        if (player && !player.isDead) {
            player.isDead = true;
            player.deadT = 0;
        }
    }

    /**
     * Helper for draw mutable functions (e.g. mouse movement helper).
     */
    private drawMutableFunctions(canvas: HTMLCanvasElement) {
        const ARROW_START_DISTANCE = 30;

        const ctx = canvas.getContext("2d");
        const selfPlayer = this.players.get(this.waveSelfId);

        const widthRelative = canvas.width / uiScaleFactor;
        const heightRelative = canvas.height / uiScaleFactor;

        if (
            !(
                SettingStorage.get("keyboard_control") ||
                !SettingStorage.get("movement_helper")
            ) &&
            selfPlayer &&
            !selfPlayer.isDead
        ) {
            ctx.save();

            ctx.translate(widthRelative / 2, heightRelative / 2);
            ctx.rotate(Math.atan2(interpolatedMouseY, interpolatedMouseX));
            ctx.scale(antennaScaleFactor, antennaScaleFactor);

            const distance = Math.hypot(interpolatedMouseX, interpolatedMouseY) / uiScaleFactor;

            ctx.beginPath();
            ctx.moveTo(ARROW_START_DISTANCE, 0);
            ctx.lineTo(distance, 0);
            ctx.lineTo(distance - 24, -18);
            ctx.moveTo(distance, 0);
            ctx.lineTo(distance - 24, 18);

            ctx.lineWidth = 12;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.globalAlpha = distance < 100
                ? Math.max(distance - 50, 0) / (100 - 50)
                : 1;
            ctx.strokeStyle = "rgba(0,0,0,0.2)";
            ctx.stroke();

            ctx.restore();
        }
    }

    private updateKeyboardMovement() {
        const [w, a, s, d] = this.movementKeys;

        // Calculate the movement vector
        let dx = 0;
        let dy = 0;

        if (w) dy -= 1;
        if (s) dy += 1;
        if (a) dx -= 1;
        if (d) dx += 1;

        // If no keys are pressed or opposing keys are pressed
        if (dx === 0 && dy === 0) {
            clientWebsocket.packetServerbound.sendWaveChangeMove(this.lastMovementKeyAngle, 0);

            return;
        }

        // Normalize diagonal movement
        if (dx !== 0 && dy !== 0) {
            dx /= Math.SQRT2;
            dy /= Math.SQRT2;
        }

        const angle = this.lastMovementKeyAngle = Math.atan2(dy, dx);

        // Send movement to server
        clientWebsocket.packetServerbound.sendWaveChangeMove(angle, 1);
    }

    private leaveGame() {
        this.gameOverMenuContainer.setVisible(false, null, true, AnimationType.FADE, {
            defaultDurationOverride: 1000,
        });

        clientWebsocket.packetServerbound.sendWaveLeave();

        uiCtx.switchUI("title");
    }

    private get isOperative(): boolean {
        const selfPlayer = this.players.get(this.waveSelfId);
        if (!selfPlayer) return false;

        if (!clientWebsocket) return false;

        return !selfPlayer.isDead;
    }
}