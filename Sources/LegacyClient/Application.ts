import type { Biome } from "./Public/Sources/Native/Biome";
import TileRenderer, { BIOME_SVG_TILESET, BIOME_TILESETS } from "./Public/Sources/UI/Shared/Tile/Tileset/TilesetRenderer";
import { uiScaleFactor } from "./Public/Sources/UI/UI";
import UIContext from "./Public/Sources/UI/UIContext";
import CameraController from "./Public/Sources/Utils/CameraController";
import ClientWebsocket from "./Public/Sources/Websocket/ClientWebsocket";

export let lastTimestamp = Date.now();
export let deltaTime = 0;
export let prevTimestamp = lastTimestamp;

/**
 * Global instanceof ui context.
 */
export let uiCtx: UIContext;

export let clientWebsocket: ClientWebsocket;

export let antennaScaleFactor = 1;

export let cameraController: CameraController;

const init = async () => {
    try {
        // Generate tilesets beforehand so no need to generate them multiple times
        for (const biome in BIOME_SVG_TILESET) {
            const parsedBiome = parseInt(biome) as Biome;
            BIOME_TILESETS.set(parsedBiome, await TileRenderer.prepareTileset(parsedBiome));
        }

        const statusContainer = document.querySelector("#status-container");
        if (statusContainer) {
            document.body.removeChild(statusContainer);
        }

        const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
        if (!canvas) {
            throw new Error("Canvas element not found");
        }

        const ctx: CanvasRenderingContext2D | null = canvas.getContext("2d", { alpha: false });
        if (!ctx) {
            throw new Error("Failed to get 2D rendering context");
        }

        uiCtx = new UIContext(canvas);

        clientWebsocket = new ClientWebsocket(
            // Change listen for each UI
            () => uiCtx.currentContext.CLIENTBOUND_HANDLERS,
        );

        cameraController = new CameraController(canvas);

        clientWebsocket.connect();

        // Disable reload
        canvas.addEventListener("contextmenu", e => {
            e.preventDefault();
        });

        // Disable in-out
        addEventListener("keydown", e => {
            if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "-" || e.key === ";")) {
                e.preventDefault();
            }

            // Disable reload
            if (e.keyCode == 116 || (e.ctrlKey && e.keyCode == 82)) {
                e.preventDefault();
            }
        }, false);
        document.body.addEventListener("wheel", e => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
            }
        }, {
            passive: false,
        });

        function limitDelta(dy: number) {
            if (dy < 0.0125) {
                dy = 0.0125;
            }
            
            if (dy > 1) {
                dy = 1;
            }

            return dy;
        }

        canvas.addEventListener("wheel", X => {
            const E = X.deltaY * -0.0005 * (cameraController.zoom * 4);
            const e = cameraController.zoom + E;
            
            cameraController.zoom = limitDelta(e);
        });

        (function frame() {
            try {
                lastTimestamp = Date.now();
                deltaTime = lastTimestamp - prevTimestamp;
                prevTimestamp = lastTimestamp;

                antennaScaleFactor = cameraController.zoom;

                ctx.save();

                ctx.scale(uiScaleFactor, uiScaleFactor);

                uiCtx.update();

                ctx.restore();

                requestAnimationFrame(frame);
            } catch (error) {
                console.error("Error in render frame:", error);
                // Continue rendering even if there's an error
                requestAnimationFrame(frame);
            }
        })();
    } catch (error) {
        console.error("Failed to initialize application:", error);
        const errorDialog = document.getElementById("errorDialog");
        const loading = document.getElementById("loading");
        if (errorDialog) {
            errorDialog.style.display = "block";
        }
        if (loading) {
            loading.style.display = "none";
        }
        throw error;
    }
};

addEventListener("contextmenu", e => e.preventDefault());

// TODO: do this only game ui
addEventListener("beforeunload", e => e.preventDefault());

if (document.readyState === "loading") {
    addEventListener("DOMContentLoaded", init);
} else {
    init();
}