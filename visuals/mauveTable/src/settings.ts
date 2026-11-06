"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * "Table" card in the format pane: header text, text size and which filter controls are shown.
 */
class TableCardSettings extends FormattingSettingsCard {
    title = new formattingSettings.TextInput({
        name: "title",
        displayName: "Title",
        value: "",
        placeholder: "Table title"
    });

    subtitle = new formattingSettings.TextInput({
        name: "subtitle",
        displayName: "Subtitle",
        value: "",
        placeholder: "Short description"
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Text size",
        value: 14
    });

    showSearch = new formattingSettings.ToggleSwitch({
        name: "showSearch",
        displayName: "Search box",
        value: true
    });

    showFilters = new formattingSettings.ToggleSwitch({
        name: "showFilters",
        displayName: "Column filters",
        value: true
    });

    sortColumn = new formattingSettings.TextInput({
        name: "sortColumn",
        displayName: "Default sort column",
        value: "",
        placeholder: "Column name"
    });

    sortDescending = new formattingSettings.ToggleSwitch({
        name: "sortDescending",
        displayName: "Sort descending",
        value: false
    });

    name: string = "table";
    displayName: string = "Table";
    slices: Array<FormattingSettingsSlice> = [this.title, this.subtitle, this.fontSize, this.showSearch, this.showFilters, this.sortColumn, this.sortDescending];
}

/**
 * Visual settings model.
 */
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    tableCard = new TableCardSettings();

    cards = [this.tableCard];
}
