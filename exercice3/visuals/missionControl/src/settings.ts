"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsModel = formattingSettings.Model;

/**
 * The format pane is intentionally empty: every preference (theme, accent, density, layout, KPIs…) is edited inside the
 * visual (Settings & Help) and stored in the hidden "prefs" / "workspace" objects through persistProperties.
 */
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    cards = [];
}
