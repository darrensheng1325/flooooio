import { type MaybePointerLike } from "../Layout/Components/Component";
import type { SquareSizeLayoutOptions } from "../Layout/Components/WellKnown/Container";
import { StaticPanelContainer } from "../Layout/Components/WellKnown/Container";
import UIMobIcon from "./UIMobIcon";
import type UIDraggableMobIcon from "./UIDraggableMobIcon";
import Mob from "../../Entity/Mob";
import { Rarity } from "../../Native/Rarity";
import { PetalType } from "../../Native/Entity/EntityType";

export default class UIPetalPlaceholder extends StaticPanelContainer {
    private embeddedPetal: UIMobIcon | null = null;
    
    public onDrop?: (draggedIcon: UIDraggableMobIcon) => void;
    
    constructor(
        layoutOptions: MaybePointerLike<SquareSizeLayoutOptions>,

        size: number,
        onDrop?: (draggedIcon: UIDraggableMobIcon) => void,
    ) {
        super(
            {
                ...layoutOptions,

                w: size,
                h: size,
            },

            false,

            "#ddf2e7",

            0.25,

            4,
            0.085,
        );

        this.onDrop = onDrop;

        // Listen for drop events - register as having interactive listeners so the UI system processes it
        if (onDrop) {
            this.on("onDrop", (draggedIcon: UIDraggableMobIcon) => {
                // Set the embedded petal from the dragged icon
                this.setPetal(draggedIcon);
                
                if (this.onDrop) {
                    this.onDrop(draggedIcon);
                }
            });
        }
    }

    /**
     * Set the petal displayed in this placeholder.
     */
    public setPetal(draggedIcon: UIDraggableMobIcon): void {
        // Clear any existing petal first
        this.clearPetal();
        
        // Get the mob from the dragged icon
        const sourceMob = draggedIcon.mob;
        
        // Create a new Mob instance with the same properties
        // Mob constructor: id, x, y, angle, size, health, type, rarity, isPet, isFirstSegment, connectingSegment
        const petalMob = new Mob(
            sourceMob.id,
            sourceMob.x,
            sourceMob.y,
            sourceMob.angle,
            sourceMob.size,
            sourceMob.health,
            sourceMob.type as PetalType,
            sourceMob.rarity as Rarity,
            sourceMob.isPet || false,
            sourceMob.isFirstSegment || false,
            sourceMob.connectingSegment || null,
        );
        
        // Create a UIMobIcon to display the petal
        // Use 80% of placeholder size for the icon
        const iconSize = this.w * 0.8;
        this.embeddedPetal = new UIMobIcon(
            {
                w: iconSize,
                h: iconSize,
                // Center the icon within the placeholder
                x: (this.w - iconSize) / 2,
                y: (this.h - iconSize) / 2,
            },
            petalMob,
            1,
        );
        
        // Add the icon as a child so it gets rendered
        this.addChild(this.embeddedPetal);
    }

    /**
     * Clear the petal from this placeholder.
     */
    public clearPetal(): void {
        if (this.embeddedPetal) {
            this.removeChild(this.embeddedPetal);
            this.embeddedPetal.destroy();
            this.embeddedPetal = null;
        }
    }

    override render(ctx: CanvasRenderingContext2D): void {
        ctx.globalAlpha = 0.9;

        super.render(ctx);
    
        // The embedded petal is now a child component, so it will be rendered automatically
    }
}