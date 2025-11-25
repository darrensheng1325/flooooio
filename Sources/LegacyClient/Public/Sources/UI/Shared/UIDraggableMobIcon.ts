import { deltaTime } from "../../../../Application";
import { RENDERED_LAST } from "../Layout/Components/Component";
import UIMobIcon from "./UIMobIcon";
import UIPetalPlaceholder from "./UIPetalPlaceholder";

// Static reference to track the currently dragging icon
let currentlyDraggingIcon: UIDraggableMobIcon | null = null;

export default class UIDraggableMobIcon extends UIMobIcon {
    private static readonly DRAGGING_SCALE: number = 1.6;
    private static readonly SCALE_INTERPOLATION_SPEED: number = 0.1;

    private static readonly WOBBLE_AMPLITUDE: number = 0.1;
    private static readonly WOBBLE_SPEED: number = 0.01;

    // Public isDragging to render last on dragging
    public isDragging: boolean = false;

    private offsetX: number = 0;
    private offsetY: number = 0;

    private wobbleTime: number = 0;

    private currentScale: number = 1;

    // Store original position to return to if not dropped
    private originalX: number = 0;
    private originalY: number = 0;

    constructor(...args: ConstructorParameters<typeof UIMobIcon>) {
        super(...args);

        this.on("onDown", () => {
            this.isLayoutable = false;

            this.isDragging = true;
            currentlyDraggingIcon = this;

            // Store original position
            this.originalX = this.x;
            this.originalY = this.y;

            this.offsetX = this.context.mouseX - this.x;
            this.offsetY = this.context.mouseY - this.y;

            this[RENDERED_LAST] = true;
        });

        this.on("onUp", () => {
            this.isLayoutable = true;

            this.isDragging = false;

            this.wobbleTime = 0;

            this[RENDERED_LAST] = false;

            // Check if we're dropping over a placeholder
            const { mouseX, mouseY } = this.context;
            const placeholder = this.context.findComponentAtPosition(mouseX, mouseY, UIPetalPlaceholder);
            if (placeholder) {
                // Emit drop event on the placeholder
                placeholder.emit("onDrop", this);
                // Don't return to original position if dropped successfully
            } else {
                // Return to original position if not dropped on a placeholder
                this.setX(this.originalX);
                this.setY(this.originalY);
            }

            currentlyDraggingIcon = null;
        });

        this.on("onFocus", () => {
            this.context.canvas.style.cursor = "pointer";
        });

        this.on("onBlur", () => {
            this.context.canvas.style.cursor = "default";
        });

        this.on("onMouseMove", () => {
            if (!this.isDragging) return;

            this.setX(this.context.mouseX - this.offsetX);
            this.setY(this.context.mouseY - this.offsetY);
        });
    }

    override render(ctx: CanvasRenderingContext2D): void {
        const targetScale =
            this.isDragging
                ? UIDraggableMobIcon.DRAGGING_SCALE
                : 1;
        this.currentScale += (targetScale - this.currentScale) * UIDraggableMobIcon.SCALE_INTERPOLATION_SPEED;

        if (this.isDragging) {
            const centerX = this.x + this.w / 2;
            const centerY = this.y + this.h / 2;

            ctx.translate(centerX, centerY);

            ctx.scale(this.currentScale, this.currentScale);

            const wobbleAngle =
                Math.sin(this.wobbleTime * UIDraggableMobIcon.WOBBLE_SPEED) *
                UIDraggableMobIcon.WOBBLE_AMPLITUDE;
            ctx.rotate(wobbleAngle);

            ctx.translate(-centerX, -centerY);

            // Add wobble time
            this.wobbleTime += deltaTime;
        }

        super.render(ctx);
    }
}