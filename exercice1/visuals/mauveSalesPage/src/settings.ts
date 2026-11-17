"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * "Page" card in the format pane: header texts.
 */
class PageCardSettings extends FormattingSettingsCard {
    eyebrow = new formattingSettings.TextInput({
        name: "eyebrow",
        displayName: "Eyebrow",
        value: "Sales Performance",
        placeholder: "Small label above the title"
    });

    title = new formattingSettings.TextInput({
        name: "title",
        displayName: "Title",
        value: "Sales Overview",
        placeholder: "Page title"
    });

    name: string = "page";
    displayName: string = "Page";
    slices: Array<FormattingSettingsSlice> = [this.eyebrow, this.title];
}

/**
 * Visual settings model.
 */
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    pageCard = new PageCardSettings();

    cards = [this.pageCard];
}
