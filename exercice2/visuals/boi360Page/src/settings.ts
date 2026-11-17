"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/** "Page" card in the format pane: which report page this visual draws. */
class PageCardSettings extends FormattingSettingsCard {
    kind = new formattingSettings.TextInput({
        name: "kind",
        displayName: "Page (overview, sales, people, projects, tasks, finance, customers, actions)",
        value: "overview",
        placeholder: "overview"
    });

    name: string = "page";
    displayName: string = "Page";
    slices: Array<FormattingSettingsSlice> = [this.kind];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    pageCard = new PageCardSettings();

    cards = [this.pageCard];
}
