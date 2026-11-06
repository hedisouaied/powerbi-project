"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * "Page" card in the format pane: which report page this visual draws.
 */
class PageCardSettings extends FormattingSettingsCard {
    kind = new formattingSettings.TextInput({
        name: "kind",
        displayName: "Page (products, orders, price, trends or quality)",
        value: "products",
        placeholder: "products"
    });

    name: string = "page";
    displayName: string = "Page";
    slices: Array<FormattingSettingsSlice> = [this.kind];
}

/**
 * Visual settings model.
 */
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    pageCard = new PageCardSettings();

    cards = [this.pageCard];
}
