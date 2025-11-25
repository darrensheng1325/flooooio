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

    // Check if entity is a valid Player or Mob instance using instanceof
    // This is more reliable than checking constructor
    let entityClass: Function;
    if (entity instanceof Player) {
        entityClass = Player;
    } else if (entity instanceof Mob) {
        entityClass = Mob;
    } else {
        const entityType = (entity as any).constructor?.name || 'unknown';
        const entityId = (entity as any).id;
        console.warn(`Invalid entity type: ${entityType} (id: ${entityId}), not a Player or Mob - should be removed from game maps`);
        // Note: We can't remove it here as we don't have access to the game maps
        // But the validation in UIGame should catch and remove these
        return;
    }

    const renderer = getRenderer(entityClass);
    if (!renderer) {
        console.warn(`No renderer found for entity class, removing entity`);
        return;
    }
    
    if (!renderer.isRenderingCandidate(renderingContext)) {
        return;
    }

    ctx.save();

    try {
        renderer.render(renderingContext);
    } catch (error) {
        const entityType = (entity as any).constructor?.name || 'unknown';
        console.error(`Error rendering entity ${entityType}:`, error);
    }

    ctx.restore();
}