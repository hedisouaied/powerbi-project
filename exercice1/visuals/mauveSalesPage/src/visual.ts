/*
 *  Mauve Sales Page — the whole Sales Overview page as one visual:
 *  header, filter bar, KPI cards, monthly revenue, status mix, store ranking and product table.
 *  It receives order lines and computes every total itself; its filters apply to its own content.
 */

"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { toJpeg } from "html-to-image";
import { jsPDF } from "jspdf";
import { zipSync, strToU8 } from "fflate";
import "./../style/visual.less";
import { axisStyle, ChartHost, glassTooltip, icon, ICONS, linear, NEON, tooltipHtml } from "../../shared/neon";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import IDownloadService = powerbi.extensibility.IDownloadService;
import DataView = powerbi.DataView;
import DataViewTable = powerbi.DataViewTable;
import PrimitiveValue = powerbi.PrimitiveValue;

import { VisualFormattingSettingsModel } from "./settings";
import { buildEmail, EmailModel } from "./emailTemplate";
import { MAIL_SERVICE_TOKEN, MAIL_SERVICE_URL } from "./mailConfig";

interface SaleLine {
    day: string;
    orderId: string;
    store: string;
    storeUnknown: boolean;
    product: string;
    category: string;
    status: string;
    quantity: number;
    gross: number;
    net: number;
}

interface FilterState {
    from: string;
    to: string;
    stores: string[];
    categories: string[];
    statuses: string[];
}

interface Totals {
    gross: number;
    net: number;
    units: number;
    orders: number;
    lines: number;
}

interface MonthBucket {
    key: string;
    label: string;
    from: string;
    to: string;
    totals: Totals;
}

interface ProductRow {
    product: string;
    category: string;
    units: number;
    gross: number;
    net: number;
}

interface WeekBucket {
    key: string;
    label: string;
    totals: Totals;
}

type ProductSortKey ="product" | "units" | "gross" | "net";

const PAGE_WIDTH = 1920;
const STATUS_ORDER = ["Completed", "Shipped", "Pending", "Returned", "Cancelled"];
const STATUS_COLORS: Record<string, string> = {
    Completed: NEON.cyan,
    Shipped: NEON.violet,
    Pending: NEON.blue,
    Returned: NEON.orange,
    Cancelled: NEON.pink
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EMPTY_FILTERS: FilterState = { from: "", to: "", stores: [], categories: [], statuses: [] };
// powerbi.PrivilegeStatus values (a const enum in the typings, so it isn't available at runtime).
const PRIVILEGE_ALLOWED = 0;
const PRIVILEGE_DISABLED_BY_ADMIN = 3;
const PAGE_HEIGHT = 1340;
const DONUT_CID = "status-donut";

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private downloadService: IDownloadService;
    private toastElement: HTMLElement;
    private toastTimer: number | undefined;
    private visibleProducts: ProductRow[] = [];
    private charts = new ChartHost();
    private renderedKey = "";
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private container: HTMLElement;
    private page: HTMLElement;
    private errorElement: HTMLElement;

    private lines: SaleLine[] = [];
    private filters: FilterState = { ...EMPTY_FILTERS };
    private productSearch = "";
    private productSort: ProductSortKey = "net";
    private productSortDescending = true;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.downloadService = options.host.downloadService;
        this.formattingSettingsService = new FormattingSettingsService();
        this.container = options.element;
        this.container.classList.add("sp-host");
        this.page = this.el("div", "sp-page", this.container);
        this.errorElement = this.el("div", "sp-error", this.container);
        this.toastElement = this.el("div", "sp-toast", this.container);
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        try {
            const dataView: DataView | undefined = options.dataViews && options.dataViews[0];
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            this.lines = this.readLines(dataView && dataView.table);
            this.filters = this.readFilters(dataView);
            // The page is designed at 1920 px wide and scaled to whatever size Power BI gives the visual.
            const scale = options.viewport.width / PAGE_WIDTH;
            this.page.style.transform = `scale(${scale})`;
            this.container.style.height = `${options.viewport.height}px`;
            // Saving filters triggers an update with the same data: redrawing would restart the chart animations.
            if (this.dataKey() !== this.renderedKey) {
                this.render();
            }
            this.errorElement.textContent = "";
            this.events.renderingFinished(options);
        } catch (error) {
            this.errorElement.textContent = `Mauve Sales Page error: ${error instanceof Error ? error.message : String(error)}`;
            this.events.renderingFailed(options, String(error));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    // ---------- Data ----------

    private readLines(table: DataViewTable | undefined): SaleLine[] {
        if (!table || !table.rows) {
            return [];
        }
        const index: Record<string, number> = {};
        table.columns.forEach((column, position) => {
            Object.keys(column.roles || {}).forEach(role => { index[role] = position; });
        });
        const text = (row: PrimitiveValue[], role: string): string => {
            const value = index[role] === undefined ? null : row[index[role]];
            return value === null || value === undefined ? "" : String(value);
        };
        const num = (row: PrimitiveValue[], role: string): number => {
            const value = index[role] === undefined ? null : row[index[role]];
            return typeof value === "number" ? value : Number(value) || 0;
        };
        return table.rows.map(row => ({
            day: this.toDay(index.date === undefined ? null : row[index.date]),
            orderId: text(row, "order"),
            store: text(row, "store") || "(no store)",
            storeUnknown: index.storeUnknown !== undefined && row[index.storeUnknown] === true,
            product: text(row, "product") || "(no product)",
            category: text(row, "category") || "(no category)",
            status: text(row, "status") || "(no status)",
            quantity: num(row, "quantity"),
            gross: num(row, "gross"),
            net: num(row, "net")
        }));
    }

    private toDay(value: PrimitiveValue): string {
        if (value === null || value === undefined) {
            return "";
        }
        const date = value instanceof Date ? value : new Date(String(value));
        if (isNaN(date.getTime())) {
            return String(value).slice(0, 10);
        }
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    private readFilters(dataView: DataView | undefined): FilterState {
        const objects = dataView && dataView.metadata && dataView.metadata.objects;
        const saved = objects && objects.state && objects.state.filters;
        if (typeof saved !== "string" || !saved) {
            return { ...EMPTY_FILTERS };
        }
        try {
            const parsed = JSON.parse(saved);
            return {
                from: typeof parsed.from === "string" ? parsed.from : "",
                to: typeof parsed.to === "string" ? parsed.to : "",
                stores: Array.isArray(parsed.stores) ? parsed.stores : [],
                categories: Array.isArray(parsed.categories) ? parsed.categories : [],
                statuses: Array.isArray(parsed.statuses) ? parsed.statuses : []
            };
        } catch {
            return { ...EMPTY_FILTERS };
        }
    }

    /**
     * Saves the filters in the report so they survive save and reopen, then redraws right away.
     */
    private setFilters(next: FilterState): void {
        this.filters = next;
        this.render();
        this.host.persistProperties({
            merge: [{ objectName: "state", selector: null, properties: { filters: JSON.stringify(next) } }]
        });
    }

    private filteredLines(): SaleLine[] {
        const f = this.filters;
        return this.lines.filter(line =>
            (!f.from || line.day >= f.from) &&
            (!f.to || line.day <= f.to) &&
            (!f.stores.length || f.stores.includes(line.store)) &&
            (!f.categories.length || f.categories.includes(line.category)) &&
            (!f.statuses.length || f.statuses.includes(line.status)));
    }

    private totals(lines: SaleLine[]): Totals {
        const orders = new Set<string>();
        const totals: Totals = { gross: 0, net: 0, units: 0, orders: 0, lines: lines.length };
        lines.forEach(line => {
            totals.gross += line.gross;
            totals.net += line.net;
            totals.units += line.quantity;
            orders.add(line.orderId);
        });
        totals.orders = orders.size;
        return totals;
    }

    private distinct(values: string[]): string[] {
        return [...new Set(values)].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    }

    // ---------- Rendering ----------

    private render(): void {
        this.charts.disposeAll();
        this.page.replaceChildren();
        this.renderedKey = this.dataKey();
        const lines = this.filteredLines();
        const totals = this.totals(lines);

        this.renderHeader(lines, totals);
        this.renderFilterBar();
        this.renderKpis(totals, lines);

        const middle = this.el("div", "sp-row sp-row-middle", this.page);
        this.renderMonths(this.el("section", "sp-card sp-months", middle), lines);
        this.renderStatusMix(this.el("section", "sp-card sp-status", middle), lines);

        const bottom = this.el("div", "sp-row sp-row-bottom", this.page);
        this.renderStores(this.el("section", "sp-card sp-stores", bottom), lines);
        this.renderProducts(this.el("section", "sp-card sp-products", bottom), lines);
    }

    private renderHeader(lines: SaleLine[], totals: Totals): void {
        const header = this.el("header", "sp-header", this.page);
        const left = this.el("div", "", header);
        this.el("div", "sp-eyebrow", left, this.formattingSettings.pageCard.eyebrow.value);
        this.el("div", "sp-title", left, this.formattingSettings.pageCard.title.value);
        const actions = this.el("div", "sp-header-actions sp-no-capture", left);
        const pdfButton = this.iconButton(actions, "sp-action", "Download", "Download PDF");
        pdfButton.title = "Download this page, with the current filters, as a PDF";
        pdfButton.addEventListener("click", () => this.exportPdf(pdfButton));
        const emailButton = this.iconButton(actions, "sp-action", "Mail", "Send by email");
        emailButton.title = "Email this page, with the current filters";
        emailButton.addEventListener("click", () => this.sendEmail(emailButton));

        const right = this.el("div", "sp-header-right", header);
        const days = lines.map(line => line.day).filter(day => day).sort();
        this.el("div", "sp-pill", right, days.length ? `${this.formatDay(days[0])}  →  ${this.formatDay(days[days.length - 1])}` : "No sales in selection");
        const stores = new Set(lines.map(line => line.store)).size;
        this.el("div", "sp-header-meta", right, `${this.int(totals.orders)} orders · ${this.int(stores)} stores · amounts in TND`);
    }

    /**
     * One-line grid: Date range (from → to + quick period) | Store | Category | status chips and Clear.
     */
    private renderFilterBar(): void {
        const bar = this.el("section", "sp-card sp-filters", this.page);
        const allDays = this.distinct(this.lines.map(line => line.day).filter(day => day));

        const dateRow = this.el("div", "sp-date-row", this.filterCell(bar, "Date range", "CalendarRange"));
        this.dateInput(dateRow, this.filters.from, allDays, "From", value => this.setFilters({ ...this.filters, from: value }));
        this.el("span", "sp-filter-sep", dateRow, "→");
        this.dateInput(dateRow, this.filters.to, allDays, "To", value => this.setFilters({ ...this.filters, to: value }));
        const months = this.monthBuckets(this.lines);
        const activeMonth = months.find(month => this.filters.from === month.from && this.filters.to === month.to);
        const customRange = !activeMonth && (this.filters.from || this.filters.to);
        const periods = [{ value: "", label: "All dates" }, ...months.map(month => ({ value: month.key, label: month.label }))];
        if (customRange) {
            periods.push({ value: "custom", label: "Custom range" });
        }
        this.select(dateRow, "sp-select sp-select-period", periods, activeMonth ? activeMonth.key : (customRange ? "custom" : ""), value => {
            const month = months.find(item => item.key === value);
            if (value === "") {
                this.setFilters({ ...this.filters, from: "", to: "" });
            } else if (month) {
                this.setFilters({ ...this.filters, from: month.from, to: month.to });
            }
        });

        this.listSelect(this.filterCell(bar, "Store", "Store"), "stores", "All stores", this.distinct(this.lines.map(line => line.store)));
        this.listSelect(this.filterCell(bar, "Category", "Tag"), "categories", "All categories", this.distinct(this.lines.map(line => line.category)));

        const actions = this.el("div", "sp-filter-actions", bar);
        this.filters.statuses.forEach(status => {
            const chip = this.pill(actions, `${status}  ✕`, true, () => this.toggleValue("statuses", status));
            chip.style.setProperty("--pill-color", STATUS_COLORS[status] || NEON.cyan);
            chip.title = "Remove this status filter";
        });
        const active = this.filters.from || this.filters.to || this.filters.stores.length || this.filters.categories.length || this.filters.statuses.length;
        const clear = this.el("button", "sp-clear", actions, "Clear all") as HTMLButtonElement;
        clear.disabled = !active;
        clear.addEventListener("click", () => this.setFilters({ ...EMPTY_FILTERS }));
    }

    private filterCell(parent: HTMLElement, label: string, iconName: keyof typeof ICONS): HTMLElement {
        const cell = this.el("div", "sp-filter-cell", parent);
        const labelElement = this.el("div", "sp-filter-label", cell);
        labelElement.appendChild(icon(iconName, 15));
        labelElement.appendChild(document.createTextNode(label));
        return cell;
    }

    /**
     * Single-choice dropdown for stores or categories ("All …" clears it).
     */
    private listSelect(parent: HTMLElement, key: "stores" | "categories", allLabel: string, values: string[]): void {
        const selected = this.filters[key];
        const options = [{ value: "", label: allLabel }, ...values.map(value => ({ value, label: value }))];
        if (selected.length > 1) {
            options.push({ value: "multiple", label: `${selected.length} selected` });
        }
        const current = selected.length === 1 ? selected[0] : (selected.length > 1 ? "multiple" : "");
        this.select(parent, "sp-select", options, current, value => {
            if (value !== "multiple") {
                this.setFilters({ ...this.filters, [key]: value ? [value] : [] });
            }
        });
    }

    private select(parent: HTMLElement, className: string, options: Array<{ value: string; label: string }>, value: string, onChange: (value: string) => void): HTMLSelectElement {
        const select = this.el("select", className, parent) as HTMLSelectElement;
        options.forEach(option => {
            const element = this.el("option", "", select, option.label) as HTMLOptionElement;
            element.value = option.value;
        });
        select.value = value;
        select.classList.toggle("sp-select-active", value !== "");
        select.addEventListener("change", () => onChange(select.value));
        return select;
    }

    private selectSingle(key: "stores" | "categories", value: string): void {
        const current = this.filters[key];
        this.setFilters({ ...this.filters, [key]: current.length === 1 && current[0] === value ? [] : [value] });
    }

    private toggleValue(key: "stores" | "categories" | "statuses", value: string): void {
        const current = this.filters[key];
        const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value];
        this.setFilters({ ...this.filters, [key]: next });
    }

    private toggleMonth(month: MonthBucket): void {
        const active = this.filters.from === month.from && this.filters.to === month.to;
        this.setFilters({ ...this.filters, from: active ? "" : month.from, to: active ? "" : month.to });
    }

    private dateInput(parent: HTMLElement, value: string, allDays: string[], title: string, onChange: (value: string) => void): HTMLInputElement {
        const input = this.el("input", value ? "sp-date sp-select-active" : "sp-date", parent) as HTMLInputElement;
        input.type = "date";
        input.title = title;
        input.value = value;
        if (allDays.length) {
            input.min = allDays[0];
            input.max = allDays[allDays.length - 1];
        }
        input.addEventListener("change", () => onChange(input.value));
        return input;
    }

    private pill(parent: HTMLElement, label: string, active: boolean, onClick: () => void): HTMLButtonElement {
        const button = this.el("button", active ? "sp-chip sp-chip-active" : "sp-chip", parent, label) as HTMLButtonElement;
        button.setAttribute("aria-pressed", String(active));
        button.addEventListener("click", onClick);
        return button;
    }

    /**
     * What the page shows: when this is unchanged, an update has nothing new to draw.
     */
    private dataKey(): string {
        const totals = this.totals(this.lines);
        return JSON.stringify([this.filters, totals.lines, totals.net, totals.gross, totals.units, this.formattingSettings.pageCard.title.value]);
    }

    private iconButton(parent: HTMLElement, className: string, iconName: keyof typeof ICONS, label: string): HTMLButtonElement {
        const button = this.el("button", className, parent) as HTMLButtonElement;
        button.appendChild(icon(iconName, 17));
        button.appendChild(document.createTextNode(label));
        return button;
    }

    private renderKpis(totals: Totals, lines: SaleLine[]): void {
        const row = this.el("div", "sp-row sp-kpis", this.page);
        const weeks = this.weekBuckets(lines);
        const months = this.monthBuckets(lines);
        const last = months[months.length - 1];
        const previous = months[months.length - 2];
        const change = (value: (t: Totals) => number): number | undefined =>
            (last && previous && value(previous.totals) ? (value(last.totals) - value(previous.totals)) / value(previous.totals) : undefined);
        const cards: Array<{ label: string; value: string; unit: string; note: string; tone: string; iconName: keyof typeof ICONS; color: string; bars: boolean; metric: (t: Totals) => number; money: boolean }> = [
            { label: "Net Revenue", value: this.money(totals.net), unit: "TND", note: `${this.pct(totals.gross ? totals.net / totals.gross : 0)} of gross retained`, tone: "", iconName: "Banknote", color: NEON.cyan, bars: false, metric: t => t.net, money: true },
            { label: "Gross Sales", value: this.money(totals.gross), unit: "TND", note: `${this.money(totals.gross - totals.net)} lost to cancels & returns`, tone: "nx-magenta", iconName: "Receipt", color: NEON.magenta, bars: true, metric: t => t.gross, money: true },
            { label: "Orders", value: this.int(totals.orders), unit: "", note: `AOV ${this.money(totals.orders ? totals.net / totals.orders : 0)} TND`, tone: "nx-blue", iconName: "ShoppingCart", color: NEON.blue, bars: false, metric: t => t.orders, money: false },
            { label: "Units Sold", value: this.int(totals.units), unit: "units", note: `${this.int(totals.lines)} order lines`, tone: "nx-violet", iconName: "Package", color: NEON.violet, bars: true, metric: t => t.units, money: false }
        ];
        cards.forEach(card => {
            const element = this.el("div", `sp-kpi ${card.tone}`, row);
            const text = this.el("div", "nx-kpi-text", element);
            this.el("div", "sp-kpi-label", text, card.label);
            const valueRow = this.el("div", "sp-kpi-value-row", text);
            this.el("span", "sp-kpi-value", valueRow, card.value);
            if (card.unit) {
                this.el("span", "sp-kpi-unit", valueRow, card.unit);
            }
            const note = this.el("div", "sp-kpi-note", text);
            const delta = change(card.metric);
            if (delta !== undefined) {
                this.el("span", delta >= 0 ? "nx-delta" : "nx-delta nx-delta-down", note, `${delta >= 0 ? "▲" : "▼"} ${this.pct(Math.abs(delta))}`);
                note.title = `${last.label} vs ${previous.label}`;
            }
            note.appendChild(document.createTextNode(card.note));
            const side = this.el("div", "nx-kpi-side", element);
            this.el("div", "nx-kpi-icon", side).appendChild(icon(card.iconName, 20));
            const spark = this.el("div", "nx-spark", side);
            this.charts.create(spark, this.sparkOption(weeks, card.metric, card.color, card.bars, card.money, card.label));
        });
    }

    private sparkOption(weeks: WeekBucket[], metric: (t: Totals) => number, color: string, bars: boolean, isMoney: boolean, label: string): Record<string, unknown> {
        return {
            grid: { left: 2, right: 2, top: 4, bottom: 2 },
            xAxis: { type: "category", show: false, data: weeks.map(week => week.label), boundaryGap: bars },
            yAxis: { type: "value", show: false, min: 0 },
            tooltip: glassTooltip({
                trigger: "axis",
                axisPointer: { type: "none" },
                formatter: (params: Array<{ dataIndex: number }>) => {
                    const week = weeks[params[0].dataIndex];
                    return tooltipHtml(`Week of ${week.label}`, [{ label, value: isMoney ? `${this.money(metric(week.totals))} TND` : this.int(metric(week.totals)), color }]);
                }
            }),
            series: [bars
                ? { type: "bar", data: weeks.map(week => metric(week.totals)), barWidth: "62%", itemStyle: { color: linear(color, `${color}55`), borderRadius: [3, 3, 0, 0] }, animationDelay: (index: number) => index * 40 }
                : { type: "line", data: weeks.map(week => metric(week.totals)), smooth: true, showSymbol: false, lineStyle: { color, width: 2.5, shadowColor: color, shadowBlur: 10 }, itemStyle: { color }, areaStyle: { color: linear(`${color}66`, `${color}00`) } }]
        };
    }

    /**
     * Totals per week (Monday start), including weeks with no sales so the timeline stays true.
     */
    private weekBuckets(lines: SaleLine[]): WeekBucket[] {
        const monday = (day: string): Date => {
            const [year, month, date] = day.split("-").map(Number);
            const value = new Date(year, month - 1, date);
            return new Date(year, month - 1, date - ((value.getDay() + 6) % 7));
        };
        const dated = lines.filter(line => line.day);
        if (!dated.length) {
            return [];
        }
        const groups = new Map<string, SaleLine[]>();
        dated.forEach(line => {
            const key = this.dayKey(monday(line.day));
            groups.set(key, [...(groups.get(key) || []), line]);
        });
        const keys = [...groups.keys()].sort();
        const weeks: WeekBucket[] = [];
        const [year, month, date] = keys[0].split("-").map(Number);
        for (let cursor = new Date(year, month - 1, date); this.dayKey(cursor) <= keys[keys.length - 1]; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7)) {
            const key = this.dayKey(cursor);
            weeks.push({ key, label: `${MONTHS[cursor.getMonth()]} ${cursor.getDate()}`, totals: this.totals(groups.get(key) || []) });
        }
        return weeks;
    }

    private dayKey(date: Date): string {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    private monthBuckets(lines: SaleLine[]): MonthBucket[] {
        const groups = new Map<string, SaleLine[]>();
        lines.filter(line => line.day).forEach(line => {
            const key = line.day.slice(0, 7);
            groups.set(key, [...(groups.get(key) || []), line]);
        });
        return [...groups.keys()].sort().map(key => {
            const [year, month] = key.split("-");
            const lastDay = new Date(Number(year), Number(month), 0).getDate();
            return {
                key,
                label: `${MONTHS[Number(month) - 1]} ${year}`,
                from: `${key}-01`,
                to: `${key}-${String(lastDay).padStart(2, "0")}`,
                totals: this.totals(groups.get(key) || [])
            };
        });
    }

    private renderMonths(card: HTMLElement, lines: SaleLine[]): void {
        const months = this.monthBuckets(lines);
        const weeks = this.weekBuckets(lines);
        const total = months.reduce((sum, month) => sum + month.totals.net, 0);
        const head = this.cardHead(card, "Net Revenue Trend", "Weekly net revenue · pick a month below to filter the page", "TrendingUp");
        const totalBox = this.el("div", "sp-card-total", head);
        this.el("div", "sp-card-total-label", totalBox, "Period total");
        this.el("div", "sp-card-total-value", totalBox, `${this.money(total)} TND`);
        if (!months.length) {
            this.el("div", "sp-empty", card, "No sales match the filters.");
            return;
        }

        const chart = this.el("div", "nx-chart nx-grow", card);
        const chips = this.el("div", "nx-month-chips", card);
        const option = {
            grid: { left: 58, right: 16, top: 16, bottom: 26 },
            xAxis: { type: "category", data: weeks.map(week => week.label), boundaryGap: false, ...axisStyle(), splitLine: { show: true, lineStyle: { color: NEON.line } } },
            yAxis: { type: "value", min: 0, ...axisStyle() },
            tooltip: glassTooltip({
                trigger: "axis",
                axisPointer: { type: "line", lineStyle: { color: NEON.cyan, width: 1, type: "dashed" } },
                formatter: (params: Array<{ dataIndex: number }>) => {
                    const index = params[0].dataIndex;
                    const week = weeks[index];
                    const before = index > 0 ? weeks[index - 1].totals.net : 0;
                    const rows = [
                        { label: "Net revenue", value: `${this.money(week.totals.net)} TND`, color: NEON.cyan },
                        { label: "Gross sales", value: `${this.money(week.totals.gross)} TND`, color: NEON.magenta },
                        { label: "Orders", value: this.int(week.totals.orders) },
                        { label: "Units sold", value: this.int(week.totals.units) },
                        { label: "Avg order value", value: `${this.money(week.totals.orders ? week.totals.net / week.totals.orders : 0)} TND` }
                    ];
                    const delta = before ? (week.totals.net - before) / before : undefined;
                    return tooltipHtml(`Week of ${week.label}`, rows, delta === undefined ? undefined : `${delta >= 0 ? "▲" : "▼"} ${this.pct(Math.abs(delta))} vs previous week`);
                }
            }),
            series: [{
                type: "line",
                data: weeks.map(week => week.totals.net),
                smooth: 0.45,
                symbol: "circle",
                symbolSize: 7,
                showSymbol: false,
                lineStyle: { width: 3.5, color: linear(NEON.cyan, NEON.magenta, true), shadowColor: "rgba(34, 211, 238, 0.7)", shadowBlur: 16 },
                itemStyle: { color: "#FFFFFF", borderColor: NEON.cyan, borderWidth: 2 },
                areaStyle: { color: linear("rgba(168, 85, 247, 0.55)", "rgba(34, 211, 238, 0.02)") }
            }]
        };

        months.forEach((month, index) => {
            const before = index > 0 ? months[index - 1].totals.net : 0;
            const active = this.filters.from === month.from && this.filters.to === month.to;
            const chip = this.el("div", active ? "nx-month-chip nx-active" : "nx-month-chip", chips);
            chip.title = `${month.label}: click to filter the page to this month`;
            chip.addEventListener("click", () => this.toggleMonth(month));
            const left = this.el("div", "", chip);
            this.el("div", "nx-month-name", left, month.label);
            this.el("div", "nx-month-sub", left, `${this.int(month.totals.orders)} orders`);
            const right = this.el("div", "", chip);
            this.el("div", "nx-month-net", right, this.money(month.totals.net));
            if (before) {
                const delta = (month.totals.net - before) / before;
                this.el("span", delta >= 0 ? "sp-delta sp-delta-up" : "sp-delta sp-delta-down", right, `${delta >= 0 ? "▲" : "▼"} ${this.pct(Math.abs(delta))} MoM`);
            } else {
                this.el("span", "sp-delta sp-delta-neutral", right, "baseline");
            }
        });
        // Last: a chart takes its size from the space left when it is created, so the chips must be filled first.
        this.charts.create(chart, option);
    }

    private renderStatusMix(card: HTMLElement, lines: SaleLine[]): void {
        this.cardHead(card, "Order Status Mix", "Share of gross sales · click a status to filter", "ChartPie");
        const byStatus = this.statusGroups(lines);
        const statuses = [...byStatus.keys()];
        const gross = statuses.reduce((sum, status) => sum + byStatus.get(status).gross, 0);
        const net = statuses.reduce((sum, status) => sum + byStatus.get(status).net, 0);
        if (!statuses.length || gross === 0) {
            this.el("div", "sp-empty", card, "No sales match the filters.");
            return;
        }

        const body = this.el("div", "sp-status-body", card);
        const donut = this.el("div", "nx-donut", body);
        const chart = this.el("div", "nx-chart", donut);
        chart.style.height = "100%";
        const center = this.el("div", "nx-donut-center", donut);
        this.el("div", "sp-donut-label", center, "Net kept");
        this.el("div", "sp-donut-value", center, this.pct(net / gross));
        this.charts.create(chart, {
            tooltip: glassTooltip({
                trigger: "item",
                formatter: (params: { name: string }) => {
                    const values = byStatus.get(params.name);
                    const group = lines.filter(line => line.status === params.name);
                    return tooltipHtml(params.name, [
                        { label: "Gross sales", value: `${this.money(values.gross)} TND`, color: STATUS_COLORS[params.name] || NEON.muted },
                        { label: "Share of gross", value: this.pct(values.gross / gross) },
                        { label: "Net revenue kept", value: `${this.money(values.net)} TND` },
                        { label: "Lost", value: `${this.money(values.gross - values.net)} TND` },
                        { label: "Orders", value: this.int(this.totals(group).orders) },
                        { label: "Order lines", value: this.int(group.length) }
                    ], "Click to filter by this status");
                }
            }),
            series: [{
                type: "pie",
                radius: ["68%", "92%"],
                padAngle: 2,
                animationType: "expansion",
                animationDuration: 1100,
                label: { show: false },
                itemStyle: { borderRadius: 7 },
                emphasis: { scale: true, scaleSize: 7 },
                data: statuses.map(status => {
                    const color = STATUS_COLORS[status] || NEON.muted;
                    return { name: status, value: byStatus.get(status).gross, itemStyle: { color, shadowColor: color, shadowBlur: 14 } };
                })
            }]
        }, params => this.toggleValue("statuses", params.name));

        const legend = this.el("div", "sp-legend", body);
        statuses.forEach(status => {
            const values = byStatus.get(status);
            const active = this.filters.statuses.includes(status);
            const row = this.el("div", active ? "sp-legend-row sp-legend-active" : "sp-legend-row", legend);
            row.title = "Click to filter by this status";
            row.addEventListener("click", () => this.toggleValue("statuses", status));
            const swatch = this.el("span", "sp-swatch", row);
            swatch.style.background = STATUS_COLORS[status] || NEON.muted;
            swatch.style.color = STATUS_COLORS[status] || NEON.muted;
            this.el("span", "sp-legend-name", row, status);
            this.el("span", "sp-legend-value", row, this.money(values.gross));
            this.el("span", "sp-legend-share", row, this.pct(values.gross / gross));
        });
    }

    private statusRank(status: string): number {
        const rank = STATUS_ORDER.indexOf(status);
        return rank < 0 ? STATUS_ORDER.length : rank;
    }

    /**
     * Gross and net per status, in the fixed status order.
     */
    private statusGroups(lines: SaleLine[]): Map<string, { gross: number; net: number }> {
        const groups = new Map<string, { gross: number; net: number }>();
        lines.forEach(line => {
            const current = groups.get(line.status) || { gross: 0, net: 0 };
            current.gross += line.gross;
            current.net += line.net;
            groups.set(line.status, current);
        });
        return new Map([...groups.entries()].sort((a, b) => this.statusRank(a[0]) - this.statusRank(b[0])));
    }

    /**
     * Net revenue per store, highest first.
     */
    private storeGroups(lines: SaleLine[]): Array<[string, { net: number; unknown: boolean }]> {
        const groups = new Map<string, { net: number; unknown: boolean }>();
        lines.forEach(line => {
            const current = groups.get(line.store) || { net: 0, unknown: line.storeUnknown };
            current.net += line.net;
            groups.set(line.store, current);
        });
        return [...groups.entries()].sort((a, b) => b[1].net - a[1].net || a[0].localeCompare(b[0]));
    }

    private renderStores(card: HTMLElement, lines: SaleLine[]): void {
        this.cardHead(card, "Net Revenue by Store", "Ranked by net revenue · click a store to filter", "Store");
        const stores = this.storeGroups(lines);
        if (!stores.length) {
            this.el("div", "sp-empty", card, "No sales match the filters.");
            return;
        }
        const total = stores.reduce((sum, [, value]) => sum + value.net, 0);
        const chart = this.el("div", "nx-chart nx-grow", card);
        this.charts.create(chart, {
            grid: { left: 10, right: 150, top: 14, bottom: 6, containLabel: true },
            xAxis: { type: "value", show: false, min: 0 },
            yAxis: {
                type: "category",
                inverse: true,
                data: stores.map(([store]) => store),
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { color: NEON.soft, fontSize: 15, margin: 14 }
            },
            tooltip: glassTooltip({
                trigger: "item",
                formatter: (params: { name: string; dataIndex: number }) => {
                    const group = this.totals(lines.filter(line => line.store === params.name));
                    return tooltipHtml(params.name, [
                        { label: "Net revenue", value: `${this.money(group.net)} TND`, color: NEON.cyan },
                        { label: "Share of net", value: this.pct(total ? group.net / total : 0) },
                        { label: "Gross sales", value: `${this.money(group.gross)} TND` },
                        { label: "Orders", value: this.int(group.orders) },
                        { label: "Units sold", value: this.int(group.units) },
                        { label: "Avg order value", value: `${this.money(group.orders ? group.net / group.orders : 0)} TND` }
                    ], `Rank ${params.dataIndex + 1} of ${stores.length} · click to filter`);
                }
            }),
            series: [{
                type: "bar",
                barWidth: 18,
                showBackground: true,
                backgroundStyle: { color: "rgba(148, 163, 255, 0.10)", borderRadius: 99 },
                animationDelay: (index: number) => index * 90,
                label: {
                    show: true,
                    position: "right",
                    distance: 12,
                    color: NEON.text,
                    fontSize: 15,
                    fontWeight: 700,
                    formatter: (params: { value: number }) => `${this.money(params.value)}  ·  ${total ? Math.round((params.value / total) * 100) : 0}%`
                },
                data: stores.map(([, value]) => ({
                    value: value.net,
                    itemStyle: {
                        borderRadius: 99,
                        color: value.unknown ? linear(NEON.pink, NEON.orange, true) : linear(NEON.violet, NEON.cyan, true),
                        shadowColor: value.unknown ? NEON.pink : NEON.cyan,
                        shadowBlur: 12
                    }
                }))
            }]
        }, params => this.selectSingle("stores", params.name));
    }

    private renderProducts(card: HTMLElement, lines: SaleLine[]): void {
        const head = this.cardHead(card, "Product Snapshot", "Sort by clicking a header · search by product or category", "PackageSearch");
        const tools = this.el("div", "sp-card-tools", head);
        const excelButton = this.iconButton(tools, "sp-action sp-action-small sp-no-capture", "FileSpreadsheet", "Excel");
        excelButton.title = "Download the rows shown in this table as an Excel file";
        excelButton.addEventListener("click", () => this.exportExcel(excelButton));
        const search = this.el("input", "sp-search", tools) as HTMLInputElement;
        search.type = "search";
        search.placeholder = "Search products…";
        search.value = this.productSearch;

        const byProduct = new Map<string, ProductRow>();
        lines.forEach(line => {
            const current = byProduct.get(line.product) || { product: line.product, category: line.category, units: 0, gross: 0, net: 0 };
            current.units += line.quantity;
            current.gross += line.gross;
            current.net += line.net;
            byProduct.set(line.product, current);
        });
        const all = [...byProduct.values()];
        const total = all.reduce((sum, row) => sum + row.net, 0);

        const scroll = this.el("div", "sp-table-scroll", card);
        const table = this.el("table", "sp-table", scroll);
        const headRow = this.el("tr", "", this.el("thead", "", table));
        const columns: Array<[ProductSortKey, string, boolean]> = [["product", "Product", false], ["units", "Units", true], ["gross", "Gross", true], ["net", "Net Revenue", true]];
        columns.forEach(([key, label, numeric]) => {
            const sorted = this.productSort === key;
            const th = this.el("th", numeric ? "sp-num" : "", headRow, `${label}${sorted ? (this.productSortDescending ? " ▼" : " ▲") : ""}`);
            if (sorted) {
                th.classList.add("sp-sorted");
            }
            th.addEventListener("click", () => {
                this.productSortDescending = this.productSort === key ? !this.productSortDescending : numeric;
                this.productSort = key;
                this.render();
            });
        });
        this.el("th", "", headRow, "Share of net");
        const body = this.el("tbody", "", table);
        const count = this.el("div", "sp-table-count", card);

        const fillBody = (): void => {
            body.replaceChildren();
            const term = this.productSearch.trim().toLowerCase();
            const rows = all
                .filter(row => !term || row.product.toLowerCase().includes(term) || row.category.toLowerCase().includes(term))
                .sort((a, b) => {
                    const direction = this.productSortDescending ? -1 : 1;
                    if (this.productSort === "product") {
                        return a.product.localeCompare(b.product) * direction;
                    }
                    return (a[this.productSort] - b[this.productSort]) * direction;
                });
            rows.forEach(row => {
                const tr = this.el("tr", "", body);
                const name = this.el("td", "", tr);
                this.el("div", "sp-product", name, row.product);
                this.el("div", "sp-category", name, row.category);
                this.el("td", "sp-num", tr, this.int(row.units));
                this.el("td", "sp-num sp-muted", tr, this.money(row.gross));
                this.el("td", row.net === 0 ? "sp-num sp-net sp-zero" : "sp-num sp-net", tr, this.money(row.net));
                const shareCell = this.el("td", "", tr);
                const share = this.el("div", "sp-share", shareCell);
                const track = this.el("div", "sp-track sp-track-small", share);
                this.el("div", "sp-fill", track).style.width = `${total ? (row.net / total) * 100 : 0}%`;
                this.el("span", "sp-share-value", share, this.pct(total ? row.net / total : 0));
            });
            this.visibleProducts = rows;
            const noun = (n: number): string => (n === 1 ? "product" : "products");
            count.textContent = term ? `${rows.length} of ${all.length} ${noun(all.length)}` : `${all.length} ${noun(all.length)}`;
            if (!rows.length) {
                const tr = this.el("tr", "", body);
                const td = this.el("td", "sp-empty", tr, all.length ? "No product matches the search." : "No sales match the filters.");
                td.setAttribute("colspan", "5");
            }
        };
        search.addEventListener("input", () => {
            this.productSearch = search.value;
            fillBody();
        });
        fillBody();
    }

    private cardHead(card: HTMLElement, title: string, subtitle: string, iconName: keyof typeof ICONS): HTMLElement {
        const head = this.el("div", "sp-card-head", card);
        const text = this.el("div", "", head);
        const titleElement = this.el("div", "sp-card-title", text);
        titleElement.appendChild(icon(iconName, 20));
        titleElement.appendChild(document.createTextNode(title));
        this.el("div", "sp-card-subtitle", text, subtitle);
        return head;
    }

    // ---------- Email ----------

    /**
     * Sends the page through the local mail service (see visuals/mailRelay). The service holds the SMTP
     * settings and decides the recipient; the visual only asks it to send.
     */
    private async sendEmail(button: HTMLButtonElement): Promise<void> {
        const recipient = await this.mailServiceRecipient();
        if (!recipient) {
            return;
        }
        const email = buildEmail(this.emailModel());
        const confirmed = await this.confirmDialog(
            "Send this page by email?",
            "An HTML email of Sales Overview will be sent with the filters currently applied:",
            [`To: ${recipient}`, ...this.filterSummary()],
            "Send email",
            "Mail"
        );
        if (!confirmed) {
            return;
        }
        this.setBusy(button, true);
        try {
            const donut = this.donutPng(this.filteredLines());
            const response = await this.mailServiceRequest("/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...email, images: donut ? [{ cid: DONUT_CID, base64: donut }] : [] })
            });
            const result = await response.json();
            if (result.ok) {
                this.alertDialog("Mail sent", `The email was sent to ${result.to}. If you don't see it, check the Spam folder.`, true);
            } else {
                this.alertDialog("Mail not sent", result.error, false);
            }
        } catch (error) {
            this.alertDialog("Mail not sent", this.mailServiceFailure(error), false);
        } finally {
            this.setBusy(button, false);
        }
    }

    /**
     * Checks that Power BI allows the call and the mail service is ready. Returns the recipient, or undefined after explaining the problem.
     */
    private async mailServiceRecipient(): Promise<string | undefined> {
        try {
            const webAccess = this.host.webAccessService;
            const status = webAccess ? await webAccess.webAccessStatus(MAIL_SERVICE_URL) : PRIVILEGE_ALLOWED;
            if (status !== PRIVILEGE_ALLOWED) {
                this.alertDialog("Mail not sent", status === PRIVILEGE_DISABLED_BY_ADMIN
                    ? "Web access for custom visuals is turned off by your Power BI admin."
                    : "This visual isn't allowed to reach the mail service here.", false);
                return undefined;
            }
            const response = await this.mailServiceRequest("/health", { method: "GET" });
            const health = await response.json();
            if (!health.ok) {
                this.alertDialog("Mail not sent", health.error, false);
                return undefined;
            }
            if (!health.configured) {
                this.alertDialog("Mail not sent", "The mail service has no Gmail password yet. Close its window, run visuals\\mailRelay\\start-mail-service.cmd again and paste the app password when asked.", false);
                return undefined;
            }
            return health.to;
        } catch (error) {
            this.alertDialog("Mail not sent", this.mailServiceFailure(error), false);
            return undefined;
        }
    }

    /**
     * Result dialog with an OK button. The toast sits at the bottom of this tall page, where it can be off screen.
     */
    private alertDialog(title: string, message: string, success: boolean): void {
        const backdrop = this.el("div", "sp-modal-backdrop sp-no-capture", this.page);
        const dialog = this.el("div", "sp-modal", backdrop);
        dialog.setAttribute("role", "alertdialog");
        dialog.setAttribute("aria-modal", "true");
        this.el("div", success ? "sp-modal-icon sp-modal-icon-success" : "sp-modal-icon sp-modal-icon-error", dialog).appendChild(icon(success ? "Check" : "TriangleAlert", 28));
        this.el("div", "sp-modal-title", dialog, title);
        this.el("div", "sp-modal-text", dialog, message);
        const actions = this.el("div", "sp-modal-actions", dialog);
        const ok = this.el("button", "sp-modal-confirm", actions, "OK") as HTMLButtonElement;
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                close();
            }
        };
        const close = (): void => {
            document.removeEventListener("keydown", onKey);
            backdrop.remove();
        };
        ok.addEventListener("click", close);
        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) {
                close();
            }
        });
        document.addEventListener("keydown", onKey);
        ok.focus();
    }

    private async mailServiceRequest(path: string, init: RequestInit): Promise<Response> {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 30000);
        try {
            return await fetch(`${MAIL_SERVICE_URL}${path}`, {
                ...init,
                headers: { ...init.headers, "X-Relay-Token": MAIL_SERVICE_TOKEN },
                signal: controller.signal
            });
        } finally {
            window.clearTimeout(timer);
        }
    }

    private mailServiceFailure(error: unknown): string {
        return error instanceof DOMException && error.name === "AbortError"
            ? "The mail service took too long to answer."
            : "Mail service not reachable. Run visuals\\mailRelay\\start-mail-service.cmd and try again.";
    }

    private emailModel(): EmailModel {
        const lines = this.filteredLines();
        const totals = this.totals(lines);
        const days = lines.map(line => line.day).filter(day => day).sort();
        const stores = this.storeGroups(lines);
        const statuses = [...this.statusGroups(lines).entries()];
        const summary = this.filterSummary().map(item => {
            const [label, ...rest] = item.split(": ");
            return { label, value: rest.join(": ") };
        });
        if (this.productSearch.trim()) {
            summary.push({ label: "Product search", value: this.productSearch.trim() });
        }
        const page = this.formattingSettings.pageCard;
        return {
            eyebrow: page.eyebrow.value,
            title: page.title.value,
            rangeLabel: days.length ? `${this.formatDay(days[0])} → ${this.formatDay(days[days.length - 1])}` : "No sales in selection",
            meta: `${this.int(totals.orders)} orders · ${this.int(stores.length)} stores · amounts in TND`,
            filters: summary,
            totals,
            months: this.monthBuckets(lines).map(month => ({ label: month.label, net: month.totals.net, orders: month.totals.orders })),
            statuses: statuses.map(([status, values]) => ({ status, gross: values.gross, color: STATUS_COLORS[status] || "#A5B4FC" })),
            stores: stores.map(([store, values]) => ({ store, net: values.net, unknown: values.unknown })),
            products: this.visibleProducts,
            donutCid: totals.gross > 0 ? DONUT_CID : undefined,
            generatedAt: new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
        };
    }

    /**
     * Draws the status donut as a PNG (base64): mail clients can't render the page's conic-gradient.
     */
    private donutPng(lines: SaleLine[]): string | undefined {
        const groups = [...this.statusGroups(lines).entries()];
        const gross = groups.reduce((sum, [, values]) => sum + values.gross, 0);
        const net = groups.reduce((sum, [, values]) => sum + values.net, 0);
        if (gross <= 0) {
            return undefined;
        }
        const size = 380;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        context.fillStyle = "#141836";
        context.fillRect(0, 0, size, size);
        let start = -Math.PI / 2;
        context.lineWidth = 62;
        groups.forEach(([status, values]) => {
            const end = start + (values.gross / gross) * Math.PI * 2;
            context.beginPath();
            context.arc(size / 2, size / 2, size / 2 - 40, start, end);
            context.strokeStyle = STATUS_COLORS[status] || "#A5B4FC";
            context.stroke();
            start = end;
        });
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#8B93B8";
        context.font = "600 20px 'Segoe UI', Arial, sans-serif";
        context.fillText("NET KEPT", size / 2, size / 2 - 26);
        context.fillStyle = NEON.cyan;
        context.font = "700 46px 'Segoe UI', Arial, sans-serif";
        context.fillText(this.pct(net / gross), size / 2, size / 2 + 16);
        return canvas.toDataURL("image/png").split(",")[1];
    }

    // ---------- Downloads ----------

    /**
     * Captures the page at its full 1920 × 1340 design size (buttons excluded) into a one-page PDF.
     */
    private async exportPdf(button: HTMLButtonElement): Promise<void> {
        // Check Power BI's permission first, so the user isn't asked to confirm a download that can't happen.
        if (!(await this.canDownload())) {
            return;
        }
        const fileName = `${this.fileStem("Sales Overview")}.pdf`;
        const confirmed = await this.confirmDialog(
            "Download this page as PDF?",
            "A one-page PDF of Sales Overview will be created with the filters currently applied:",
            [...this.filterSummary(), `File: ${fileName}`],
            "Download PDF"
        );
        if (!confirmed) {
            return;
        }
        const transform = this.page.style.transform;
        this.setBusy(button, true);
        try {
            this.page.style.transform = "none";
            // System fonts only: skipping font embedding avoids html-to-image waiting on font downloads.
            const capture = toJpeg(this.page, {
                quality: 0.95,
                pixelRatio: 1.5,
                backgroundColor: "#060818",
                width: PAGE_WIDTH,
                height: PAGE_HEIGHT,
                skipFonts: true,
                filter: node => !(node instanceof HTMLElement && node.classList.contains("sp-no-capture"))
            });
            const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("capture timed out")), 20000));
            const image = await Promise.race([capture, timeout]);
            this.page.style.transform = transform;
            const width = PAGE_WIDTH * 0.75;
            const height = PAGE_HEIGHT * 0.75;
            const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: [width, height], compress: true });
            pdf.setProperties({ title: this.formattingSettings.pageCard.title.value, subject: this.filterSummary().join(" · ") });
            pdf.addImage(image, "JPEG", 0, 0, width, height);
            const base64 = pdf.output("datauristring").split(",")[1];
            await this.download(base64, fileName, "Sales Overview page as PDF");
        } catch (error) {
            this.toast(`PDF export failed: ${error instanceof Error ? error.message : String(error)}`, true);
        } finally {
            this.page.style.transform = transform;
            this.setBusy(button, false);
        }
    }

    /**
     * Writes the Product Snapshot rows as shown (filters, search and sort applied) to an .xlsx file.
     */
    private async exportExcel(button: HTMLButtonElement): Promise<void> {
        if (!(await this.canDownload())) {
            return;
        }
        this.setBusy(button, true);
        try {
            const base64 = this.toBase64(this.buildWorkbook(this.visibleProducts));
            await this.download(base64, `${this.fileStem("Product Snapshot")}.xlsx`, "Product Snapshot rows as Excel");
        } catch (error) {
            this.toast(`Excel export failed: ${error instanceof Error ? error.message : String(error)}`, true);
        } finally {
            this.setBusy(button, false);
        }
    }

    /**
     * In-visual confirmation dialog (the sandbox blocks window.confirm). Resolves true on confirm,
     * false on Cancel, Escape, a click outside the dialog, or if a redraw removes it.
     */
    private confirmDialog(title: string, message: string, details: string[], confirmLabel: string, iconName: keyof typeof ICONS = "Download", showCancel = true): Promise<boolean> {
        return new Promise(resolve => {
            const backdrop = this.el("div", "sp-modal-backdrop sp-no-capture", this.page);
            const dialog = this.el("div", showCancel ? "sp-modal" : "sp-modal sp-modal-help", backdrop);
            dialog.setAttribute("role", "dialog");
            dialog.setAttribute("aria-modal", "true");
            this.el("div", "sp-modal-icon", dialog).appendChild(icon(iconName, 28));
            this.el("div", "sp-modal-title", dialog, title);
            this.el("div", "sp-modal-text", dialog, message);
            const list = this.el("ul", "sp-modal-details", dialog);
            details.forEach(detail => {
                const [label, ...rest] = detail.split(": ");
                const item = this.el("li", "", list);
                this.el("span", "sp-modal-label", item, label);
                this.el("span", "sp-modal-value", item, rest.join(": "));
            });
            const actions = this.el("div", "sp-modal-actions", dialog);
            const cancel = this.el("button", "sp-modal-cancel", actions, "Cancel") as HTMLButtonElement;
            cancel.style.display = showCancel ? "" : "none";
            const confirm = this.el("button", "sp-modal-confirm", actions) as HTMLButtonElement;
            confirm.appendChild(icon(iconName, 16));
            confirm.appendChild(document.createTextNode(confirmLabel));

            let settled = false;
            const close = (result: boolean): void => {
                if (settled) {
                    return;
                }
                settled = true;
                document.removeEventListener("keydown", onKey);
                observer.disconnect();
                backdrop.remove();
                resolve(result);
            };
            const onKey = (event: KeyboardEvent): void => {
                if (event.key === "Escape") {
                    close(false);
                }
            };
            // A redraw replaces the page content; treat a removed dialog as cancelled.
            const observer = new MutationObserver(() => {
                if (!backdrop.isConnected) {
                    close(false);
                }
            });
            observer.observe(this.page, { childList: true });
            cancel.addEventListener("click", () => close(false));
            confirm.addEventListener("click", () => close(true));
            backdrop.addEventListener("click", event => {
                if (event.target === backdrop) {
                    close(false);
                }
            });
            document.addEventListener("keydown", onKey);
            confirm.focus();
        });
    }

    private async canDownload(): Promise<boolean> {
        try {
            const status = await this.downloadService.exportStatus();
            if (status === PRIVILEGE_ALLOWED) {
                return true;
            }
            await this.downloadHelp(status === PRIVILEGE_DISABLED_BY_ADMIN
                ? "Downloads from custom visuals are turned off in Power BI."
                : "Power BI doesn't allow downloads from this visual here.");
        } catch {
            await this.downloadHelp("Power BI didn't say whether downloads are allowed.");
        }
        return false;
    }

    private async download(base64: string, fileName: string, description: string): Promise<void> {
        const result = await this.downloadService.exportVisualsContentExtended(base64, fileName, "base64", description);
        if (result && result.downloadCompleted) {
            this.toast(`Saved ${result.fileName || fileName}`, false);
        } else {
            // Power BI Desktop can report downloads as allowed, then refuse the file ("your administrator has restricted
            // downloads") when the user isn't signed in or the tenant switch is off. Explain what works instead.
            await this.downloadHelp("No file was saved. If Power BI said downloads are restricted, this is why:");
        }
    }

    /**
     * Explains Power BI's rule for custom visual downloads and the built-in export that always works.
     */
    private downloadHelp(message: string): Promise<boolean> {
        return this.confirmDialog("Download not available here", message, [
            "Rule: Power BI only lets a custom visual save a file when you're signed in and your Power BI admin allows it",
            "Admin setting: Tenant settings › Power BI visuals › Allow downloads from custom visuals",
            "Works now: In Power BI Desktop, File › Export › Export to PDF (all pages)"
        ], "OK", "TriangleAlert", false);
    }

    private buildWorkbook(rows: ProductRow[]): Uint8Array {
        const total = rows.reduce((sum, row) => sum + row.net, 0);
        const escape = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const column = (index: number): string => String.fromCharCode(65 + index);
        const text = (ref: string, value: string, style = 0): string => `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
        const number = (ref: string, value: number, style: number): string => `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
        const row = (index: number, cells: string[]): string => `<row r="${index}">${cells.join("")}</row>`;

        // Styles: 1 header, 2 integer, 3 money, 4 percent, 5 bold label, 6 bold integer, 7 bold money, 8 bold percent.
        const headers = ["Product", "Category", "Units", "Gross (TND)", "Net Revenue (TND)", "Share of Net"];
        const sheetRows = [row(1, headers.map((header, index) => text(`${column(index)}1`, header, 1)))];
        rows.forEach((product, index) => {
            const r = index + 2;
            sheetRows.push(row(r, [
                text(`A${r}`, product.product), text(`B${r}`, product.category),
                number(`C${r}`, product.units, 2), number(`D${r}`, product.gross, 3), number(`E${r}`, product.net, 3),
                number(`F${r}`, total ? product.net / total : 0, 4)
            ]));
        });
        const lastDataRow = rows.length + 1;
        const totalRow = lastDataRow + 1;
        sheetRows.push(row(totalRow, [
            text(`A${totalRow}`, "Total", 5), text(`B${totalRow}`, "", 5),
            number(`C${totalRow}`, rows.reduce((sum, product) => sum + product.units, 0), 6),
            number(`D${totalRow}`, rows.reduce((sum, product) => sum + product.gross, 0), 7),
            number(`E${totalRow}`, total, 7), number(`F${totalRow}`, rows.length ? 1 : 0, 8)
        ]));

        const productSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="3" width="10" customWidth="1"/><col min="4" max="5" width="20" customWidth="1"/><col min="6" max="6" width="14" customWidth="1"/></cols><sheetData>${sheetRows.join("")}</sheetData><autoFilter ref="A1:F${Math.max(lastDataRow, 1)}"/></worksheet>`;

        const infoRows = [["Report", "Sales Overview — Product Snapshot"], ["Exported", new Date().toLocaleString("en-US")], ...this.filterSummary().map(item => {
            const [label, ...rest] = item.split(": ");
            return [label, rest.join(": ")];
        })];
        if (this.productSearch.trim()) {
            infoRows.push(["Search", this.productSearch.trim()]);
        }
        const infoSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="2" width="60" customWidth="1"/></cols><sheetData>${infoRows.map((pair, index) => row(index + 1, [text(`A${index + 1}`, pair[0], 5), text(`B${index + 1}`, pair[1])])).join("")}</sheetData></worksheet>`;

        const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF16101F"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE0B0FF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><top style="thin"><color rgb="FF7B4FA8"/></top></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="3" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/><xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/><xf numFmtId="165" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

        const files: Record<string, Uint8Array> = {
            "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
            "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
            "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Product Snapshot" sheetId="1" r:id="rId1"/><sheet name="Filters" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Product Snapshot'!$A$1:$F$${Math.max(lastDataRow, 1)}</definedName></definedNames></workbook>`),
            "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
            "xl/worksheets/sheet1.xml": strToU8(productSheet),
            "xl/worksheets/sheet2.xml": strToU8(infoSheet),
            "xl/styles.xml": strToU8(styles)
        };
        return zipSync(files, { level: 6 });
    }

    /**
     * Human-readable list of the active filters, e.g. "Store: Sfax Medina".
     */
    private filterSummary(): string[] {
        const f = this.filters;
        const range = f.from || f.to ? `${f.from ? this.formatDay(f.from) : "start"} → ${f.to ? this.formatDay(f.to) : "end"}` : "All dates";
        return [
            `Date range: ${range}`,
            `Store: ${f.stores.length ? f.stores.join(", ") : "All stores"}`,
            `Category: ${f.categories.length ? f.categories.join(", ") : "All categories"}`,
            `Status: ${f.statuses.length ? f.statuses.join(", ") : "All statuses"}`
        ];
    }

    private fileStem(name: string): string {
        const now = new Date();
        return `${name} ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }

    private toBase64(bytes: Uint8Array): string {
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(binary);
    }

    private setBusy(button: HTMLButtonElement, busy: boolean): void {
        button.disabled = busy;
        button.classList.toggle("sp-busy", busy);
    }

    private toast(message: string, isError: boolean): void {
        this.toastElement.textContent = message;
        this.toastElement.className = isError ? "sp-toast sp-toast-error sp-toast-show" : "sp-toast sp-toast-show";
        window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => this.toastElement.classList.remove("sp-toast-show"), isError ? 9000 : 4000);
    }

    // ---------- Formatting ----------

    private money(value: number): string {
        return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    private int(value: number): string {
        return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
    }

    private pct(value: number): string {
        return `${(value * 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    }

    private formatDay(day: string): string {
        const [year, month, date] = day.split("-").map(Number);
        return `${MONTHS[month - 1]} ${date}, ${year}`;
    }

    private el(tag: string, className: string, parent: HTMLElement, text?: string): HTMLElement {
        const element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (text !== undefined) {
            element.textContent = text;
        }
        parent.appendChild(element);
        return element;
    }
}
