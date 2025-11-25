import type { Components, MaybePointerLike } from "../Layout/Components/Component";
import type { AutomaticallySizedLayoutOptions } from "../Layout/Components/WellKnown/Container";
import { StaticSpace, StaticVContainer, StaticHContainer } from "../Layout/Components/WellKnown/Container";
import UIPetalPlaceholder from "../Shared/UIPetalPlaceholder";
import StaticText from "../Layout/Components/WellKnown/StaticText";
import { Centering } from "../Layout/Extensions/ExtensionCentering";
import type UIDraggableMobIcon from "../Shared/UIDraggableMobIcon";

export default class UITitleInventory extends StaticVContainer {
    constructor(
        layoutOptions: MaybePointerLike<AutomaticallySizedLayoutOptions>,
    ) {
        super(
            layoutOptions,

            false,
        );

        const createRow = (placeholderSize: number, spaceWidth: number, count: number, slotOffset: number = 0): StaticHContainer => {
            const row = new (Centering(StaticHContainer))({});

            for (let i = 0; i < count; i++) {
                const slotIndex = i + slotOffset;
                const placeholder = new UIPetalPlaceholder({}, placeholderSize, (draggedIcon: UIDraggableMobIcon) => {
                    // Handle drop: update the placeholder to show the dropped petal
                    // For now, we'll just log it - you may want to store this in player data
                    console.log(`Dropped petal into slot ${slotIndex}`);
                    // TODO: Store the petal in the player's inventory slot
                });
                
                row.addChild(placeholder);

                // Add space if not last placeholder
                if (i < count - 1) {
                    row.addChild(new StaticSpace(spaceWidth, 0));
                }
            }

            return row;
        };

        // Surface row: slots 0-9
        const surfaceRow = createRow(35, 9, 10, 0);
        // Bottom row: slots 10-19
        const bottomRow = createRow(26, 7, 10, 10);

        this.addChildren(
            surfaceRow,
            new StaticSpace(0, 8),
            bottomRow,
        );
    }
}