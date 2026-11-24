"use strict";

/**
 * Power BI entry point. Reads the 31 "Feed <table>" measures (one JSON string per data role), the saved "prefs" and
 * "workspace" objects, and hands everything to the App. Saves through host.persistProperties (merge). No network access.
 * The logical canvas is at least 1280 × 720 and scaled down to fit smaller visual sizes so the layout never breaks.
 */
import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";
import { App } from "./app";
import { decode, emptyDataset, TABLES } from "./core/data";
import { VisualFormattingSettingsModel } from "./settings";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

const MIN_W = 1280, MIN_H = 720;
const PRIVILEGE_ALLOWED = 0;

export class Visual implements IVisual {
    private host: IVisualHost;
    private stage: HTMLElement;
    private app: App;
    private dataKey = "";
    private formatting = new FormattingSettingsService();

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        const root = options.element;
        root.classList.add("mc-host");
        this.stage = document.createElement("div");
        this.stage.className = "mc-stage-root";
        root.appendChild(this.stage);
        this.app = new App(this.stage, (object, json) => {
            this.host.persistProperties({ merge: [{ objectName: object, selector: null as unknown as powerbi.data.Selector, properties: { json } }] });
        });
        const dl = this.host.downloadService;
        this.app.exporter = dl ? async (fileName: string, text: string): Promise<boolean> => {
            try {
                const status = await dl.exportStatus();
                if (status !== PRIVILEGE_ALLOWED) { return false; }
                const r = await dl.exportVisualsContentExtended(text, fileName, "csv", "Mission Control export");
                return !!r?.downloadCompleted;
            } catch { return false; }
        } : null;
    }

    public update(options: VisualUpdateOptions): void {
        this.host.eventService?.renderingStarted(options);
        try {
            const dv = options.dataViews?.[0];
            this.fit(options.viewport.width, options.viewport.height);
            const raw: Record<string, string> = {};
            const table = dv?.table;
            table?.columns.forEach((col, i) => { const role = Object.keys(col.roles ?? {})[0]; if (role) { raw[role] = String(table.rows?.[0]?.[i] ?? ""); } });
            const key = TABLES.map(t => (raw[t] ?? "").length).join("|");
            if (key !== this.dataKey) {
                this.dataKey = key;
                const d = emptyDataset();
                const sizes: Record<string, number> = {};
                const issues: string[] = [];
                TABLES.forEach(t => {
                    d[t] = decode(raw[t]); sizes[t] = (raw[t] ?? "").length;
                    if (!sizes[t]) { issues.push(`${t} (no data)`); } else if (!d[t].length && !/"r":[]/.test(raw[t])) { issues.push(`${t} (unreadable, ${sizes[t]} chars)`); }
                });
                this.app.feedSizes = sizes; this.app.feedIssues = issues;
                this.app.setData(d);
            }
            const objects = dv?.metadata?.objects;
            this.app.loadState(String(objects?.prefs?.json ?? ""), String(objects?.workspace?.json ?? ""));
            this.app.render();
            this.host.eventService?.renderingFinished(options);
        } catch (e) {
            this.host.eventService?.renderingFailed(options, String(e));
        }
    }

    /** Scale a ≥1280×720 logical canvas into the viewport (no scaling when the visual is larger). */
    private fit(w: number, h: number): void {
        const scale = Math.min(1, w / MIN_W, h / MIN_H);
        const lw = Math.max(w / scale, MIN_W), lh = Math.max(h / scale, MIN_H);
        this.stage.style.width = `${lw}px`; this.stage.style.height = `${lh}px`;
        this.stage.style.transform = scale < 1 ? `scale(${scale})` : "";
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formatting.buildFormattingModel(new VisualFormattingSettingsModel());
    }

    public destroy(): void { this.app.destroy(); }
}
