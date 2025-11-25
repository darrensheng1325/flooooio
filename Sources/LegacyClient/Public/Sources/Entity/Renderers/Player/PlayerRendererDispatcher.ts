import type Player from "../../Player";
import Renderer from "../Renderer";
import type { RenderingContext } from "../RendererRenderingContext";
import PlayerRendererDev from "./PlayerRendererDev";
import PlayerRendererNormal from "./PlayerRendererNormal";

export default class PlayerRendererDispatcher extends Renderer<Player> {
    private static readonly dev = new PlayerRendererDev();
    private static readonly normal = new PlayerRendererNormal();

    override render(context: RenderingContext<Player>): void {
        super.render(context);

        const { ctx, entity } = context;

        // Validate entity properties
        if (typeof entity.size !== 'number' || isNaN(entity.size)) {
            console.warn("Invalid player size, skipping render");
            return;
        }

        const scale = entity.size / 25;
        ctx.scale(scale, scale);

        try {
            if (entity.isDev) {
                PlayerRendererDispatcher.dev.render(context);
            } else {
                PlayerRendererDispatcher.normal.render(context);
            }
        } catch (error) {
            console.error("Error rendering player:", error);
        }
    }
}