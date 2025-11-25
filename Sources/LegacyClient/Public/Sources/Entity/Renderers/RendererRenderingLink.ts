import type Entity from "../Entity";
import Mob from "../Mob";
import Player from "../Player";
import MobRendererDispatcher from "./Mob/MobRendererDispatcher";
import PlayerRendererDispatcher from "./Player/PlayerRendererDispatcher";
import type Renderer from "./Renderer";
import type { RenderingContext } from "./RendererRenderingContext";

const rendererDispatcherRegistry = new Map<Function, Renderer<Entity>>();

rendererDispatcherRegistry.set(Player, new PlayerRendererDispatcher());
rendererDispatcherRegistry.set(Mob, new MobRendererDispatcher());

/**
 * @deprecated Impossible to use because of circular deps
 */
export function UseRenderer(renderer: typeof Renderer<Entity>) {
    return function (target: Function) {
        rendererDispatcherRegistry.set(target, new renderer());
    };
}

export function getRenderer(entityClass: Function): Renderer<Entity> {
    return rendererDispatcherRegistry.get(entityClass);
}

export function renderEntity<T extends Mob | Player>(renderingContext: RenderingContext<T>): void {
    const { entity, ctx } = renderingContext;

    // Validate entity before rendering
    if (!entity) {
        console.warn("Invalid entity: missing entity");
        return;
    }

    // Check if entity is a valid Player or Mob instance
    if (!(entity instanceof Player) && !(entity instanceof Mob)) {
        const entityType = (entity as any).constructor?.name || 'unknown';
        console.warn(`Invalid entity type: ${entityType}, not a Player or Mob`);
        return;
    }

    const entityConstructor = (entity as any).constructor;
    if (!entityConstructor) {
        console.warn("Invalid entity: missing constructor");
        return;
    }

    const renderer = getRenderer(entityConstructor);
    if (!renderer) {
        const entityType = entityConstructor.name || 'unknown';
        console.warn(`No renderer found for entity type: ${entityType}`);
        return;
    }
    
    if (!renderer.isRenderingCandidate(renderingContext)) {
        return;
    }

    ctx.save();

    try {
        renderer.render(renderingContext);
    } catch (error) {
        console.error(`Error rendering entity ${entity.constructor.name}:`, error);
    }

    ctx.restore();
}