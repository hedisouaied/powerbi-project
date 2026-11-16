/*
 *  Mauve Report Page: the Product Performance, Order Analysis, Price Analysis, Date Trends and
 *  Data Quality pages. The "page.kind" setting chooses the page. Sales pages receive order lines and
 *  compute their totals here, using the same rules as the DAX measures; Data Quality reads measures,
 *  including its five tables as JSON text ('DQ … JSON'). Filters and tables are built in and apply to
 *  this visual only: each page is this one visual, with no other visuals on it.
 */

"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";
import { axisStyle, ChartHost, glassTooltip, icon, ICONS, linear, NEON, radial, TooltipRow, tooltipHtml } from "../../shared/neon";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import DataView = powerbi.DataView;
import DataViewTable = powerbi.DataViewTable;
import PrimitiveValue = powerbi.PrimitiveValue;

import { VisualFormattingSettingsModel } from "./settings";

type IconName = keyof typeof ICONS;

interface SaleLine {
    day: string;
    orderId: string;
    lineId: string;
    store: string;
    unitPrice: number;
    flag: string;
    product: string;
    productUnknown: boolean;
    category: string;
    listPrice: number | null;
    status: string;
    quantity: number;
    discount: number;
    gross: number;
    net: number;
}

interface FilterState {
    from: string;
    to: string;
    categories: string[];
    /** Order picked by clicking a row of the Order Line Detail table. */
    order: string;
}

/** One row of a Data Quality table, parsed from the JSON measures. */
type JsonRow = Record<string, string | number | boolean | null>;

interface QualityTables {
    payments: JsonRow[];
    orders: JsonRow[];
    customers: JsonRow[];
    products: JsonRow[];
    stores: JsonRow[];
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

interface WeekBucket {
    label: string;
    totals: Totals;
}

interface DayBucket {
    day: string;
    totals: Totals;
}

interface ProductRow {
    product: string;
    category: string;
    unknown: boolean;
    listPrice: number | null;
    units: number;
    gross: number;
    net: number;
    price: number;
}

interface KpiSpark {
    label: string;
    lines: SaleLine[];
    metric: (totals: Totals) => number;
    money: boolean;
    bars?: boolean;
    delta?: boolean;
}

interface KpiCard {
    label: string;
    value: string;
    unit?: string;
    note: string;
    iconName: IconName;
    warning?: boolean;
    spark?: KpiSpark;
}

interface BarRow {
    name: string;
    value: number;
    label: string;
    color?: "unknown" | "zero";
    tooltip: TooltipRow[];
    footer?: string;
}

interface DonutItem {
    name: string;
    value: number;
    color: string;
    valueText: string;
    note: string;
    tooltip: TooltipRow[];
    footer?: string;
    onClick?: () => void;
    active?: boolean;
}

interface TableColumn<T> {
    key: string;
    label: string;
    numeric?: boolean;
    sortValue: (row: T) => number | string;
    render: (cell: HTMLElement, row: T) => void;
    /** Values offered by this column's dropdown filter; a column without it has no filter. */
    filterValues?: (row: T) => string[];
    /** Name of the dropdown filter when it differs from the column label. */
    filterLabel?: string;
}

interface TableOptions<T> {
    id: string;
    title: string;
    subtitle: string;
    iconName?: IconName;
    rows: T[];
    columns: Array<TableColumn<T>>;
    sort: { key: string; descending: boolean };
    /** Text searched by the search box; no search box without it. */
    searchText?: (row: T) => string;
    footer?: string[];
    emptyText?: string;
    onRowClick?: (row: T) => void;
    isRowActive?: (row: T) => boolean;
}

type PageKind = "products" | "orders" | "price" | "trends" | "quality";

const PAGE_WIDTH = 1920;
const PAGES: Record<PageKind, { eyebrow: string; title: string; subtitle: string }> = {
    products: { eyebrow: "Product Insights", title: "Product Performance", subtitle: "Revenue, mix and pricing by product" },
    orders: { eyebrow: "Order Insights", title: "Order Analysis", subtitle: "Order volume, status outcomes and line-level detail" },
    price: { eyebrow: "Pricing Insights", title: "Price Analysis", subtitle: "Selling price, list price and volume by product" },
    trends: { eyebrow: "Time Insights", title: "Date Trends", subtitle: "Daily and monthly revenue, orders and units" },
    quality: { eyebrow: "Data Governance", title: "Data Quality", subtitle: "Exceptions kept visible, not silently corrected" }
};
const STATUS_ORDER = ["Completed", "Shipped", "Pending", "Returned", "Cancelled"];
const STATUS_COLORS: Record<string, string> = {
    Completed: NEON.cyan,
    Shipped: NEON.violet,
    Pending: NEON.blue,
    Returned: NEON.orange,
    Cancelled: NEON.pink
};
const CATEGORY_COLORS = [NEON.cyan, NEON.violet, NEON.blue, NEON.magenta, NEON.orange, NEON.green];
const KPI_TONES = ["", "nx-magenta", "nx-blue", "nx-violet", "nx-cyan2"];
const KPI_COLORS = [NEON.cyan, NEON.magenta, NEON.blue, NEON.violet, NEON.cyan];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EMPTY_FILTERS: FilterState = { from: "", to: "", categories: [], order: "" };
const EMPTY_TABLES: QualityTables = { payments: [], orders: [], customers: [], products: [], stores: [] };
const QUALITY_ROLES: Record<keyof QualityTables, string> = {
    payments: "dqPayments",
    orders: "dqOrders",
    customers: "dqCustomers",
    products: "dqProducts",
    stores: "dqStores"
};
const PILL_COLORS: Record<string, string> = {
    completed: NEON.cyan,
    shipped: NEON.violet,
    pending: NEON.blue,
    returned: NEON.orange,
    cancelled: NEON.pink,
    refunded: NEON.pink,
    paid: NEON.green,
    "no payment": NEON.pink
};

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private container: HTMLElement;
    private page: HTMLElement;
    private errorElement: HTMLElement;
    private charts = new ChartHost();
    private renderedKey = "";

    private lines: SaleLine[] = [];
    private measures: Record<string, number> = {};
    private qualityTables: QualityTables = { ...EMPTY_TABLES };
    private qualityKey = "";
    private qualityError = "";
    private filters: FilterState = { ...EMPTY_FILTERS };
    private tableSorts: Record<string, { key: string; descending: boolean }> = {};
    private tableSearches: Record<string, string> = {};
    private tableFilters: Record<string, Record<string, string>> = {};

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.formattingSettingsService = new FormattingSettingsService();
        this.container = options.element;
        this.container.classList.add("sp-host");
        this.page = this.el("div", "sp-page", this.container);
        this.errorElement = this.el("div", "sp-error", this.container);
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        try {
            const dataView: DataView | undefined = options.dataViews && options.dataViews[0];
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            this.readData(dataView && dataView.table);
            this.filters = this.readFilters(dataView);
            // The page is designed at 1920 px wide and scaled to whatever size Power BI gives the visual.
            const scale = options.viewport.width / PAGE_WIDTH;
            this.page.style.transform = `scale(${scale})`;
            this.page.style.height = `${options.viewport.height / scale}px`;
            this.container.style.height = `${options.viewport.height}px`;
            // Saving filters triggers an update with the same data: redrawing would restart the chart animations.
            if (this.dataKey() !== this.renderedKey) {
                this.render();
            }
            this.errorElement.textContent = "";
            this.events.renderingFinished(options);
        } catch (error) {
            this.errorElement.textContent = `Mauve Report Page error: ${error instanceof Error ? error.message : String(error)}`;
            this.events.renderingFailed(options, String(error));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    private get kind(): PageKind {
        const kind = this.formattingSettings.pageCard.kind.value as PageKind;
        return PAGES[kind] ? kind : "products";
    }

    /**
     * What the page shows: when this is unchanged, an update has nothing new to draw.
     */
    private dataKey(): string {
        const totals = this.totals(this.lines);
        return JSON.stringify([this.kind, this.filters, totals.lines, totals.net, totals.gross, totals.units, this.measures, this.qualityKey]);
    }

    // ---------- Data ----------

    private readData(table: DataViewTable | undefined): void {
        this.lines = [];
        this.measures = {};
        this.qualityTables = { ...EMPTY_TABLES };
        this.qualityKey = "";
        this.qualityError = "";
        if (!table || !table.rows) {
            return;
        }
        const index: Record<string, number> = {};
        table.columns.forEach((column, position) => {
            Object.keys(column.roles || {}).forEach(role => { index[role] = position; });
        });
        const has = (role: string): boolean => index[role] !== undefined;
        const raw = (row: PrimitiveValue[], role: string): PrimitiveValue => (has(role) ? row[index[role]] : null);
        const text = (row: PrimitiveValue[], role: string, fallback: string): string => {
            const value = raw(row, role);
            return value === null || value === undefined || value === "" ? fallback : String(value);
        };
        const num = (row: PrimitiveValue[], role: string): number => {
            const value = raw(row, role);
            return typeof value === "number" ? value : Number(value) || 0;
        };
        if (this.kind === "quality") {
            if (table.rows[0]) {
                ["flaggedLines", "orderLines", "unknownLines", "missingPayments", "noPaymentOrders", "paymentExceptions", "segmentCoverage", "missingSegments"]
                    .forEach(role => { this.measures[role] = num(table.rows[0], role); });
                const keys: string[] = [];
                (Object.keys(QUALITY_ROLES) as Array<keyof QualityTables>).forEach(name => {
                    const json = text(table.rows[0], QUALITY_ROLES[name], "");
                    keys.push(json);
                    this.qualityTables[name] = this.parseRows(json, name);
                });
                this.qualityKey = keys.join("|");
            }
            return;
        }
        this.lines = table.rows.map(row => {
            const list = raw(row, "listPrice");
            const quantity = num(row, "quantity");
            const price = raw(row, "unitPrice");
            return {
                day: this.toDay(raw(row, "date")),
                orderId: text(row, "order", ""),
                lineId: text(row, "line", ""),
                store: text(row, "store", ""),
                // Without the Unit price field, fall back to gross / quantity (the same value in this data).
                unitPrice: typeof price === "number" ? price : (quantity ? num(row, "gross") / quantity : 0),
                flag: text(row, "lineFlag", ""),
                product: text(row, "product", "(no product)"),
                productUnknown: raw(row, "productUnknown") === true,
                category: text(row, "category", "(no category)"),
                listPrice: typeof list === "number" ? list : null,
                status: text(row, "status", "(no status)"),
                quantity,
                discount: num(row, "discount"),
                gross: num(row, "gross"),
                net: num(row, "net")
            };
        });
    }

    /**
     * Parses a JSON measure (an array of row objects). A bad value is reported on the page, not swallowed.
     */
    private parseRows(json: string, name: string): JsonRow[] {
        if (!json) {
            return [];
        }
        try {
            const parsed = JSON.parse(json);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            this.qualityError = `The ${name} rows could not be read: ${error instanceof Error ? error.message : String(error)}`;
            return [];
        }
    }

    private toDay(value: PrimitiveValue): string {
        if (value === null || value === undefined) {
            return "";
        }
        const date = value instanceof Date ? value : new Date(String(value));
        return isNaN(date.getTime()) ? String(value).slice(0, 10) : this.dayKey(date);
    }

    private dayKey(date: Date): string {
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
                categories: Array.isArray(parsed.categories) ? parsed.categories : [],
                order: typeof parsed.order === "string" ? parsed.order : ""
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
            (!f.categories.length || f.categories.includes(line.category)) &&
            (!f.order || line.orderId === f.order));
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
            weeks.push({ label: `${MONTHS[cursor.getMonth()]} ${cursor.getDate()}`, totals: this.totals(groups.get(this.dayKey(cursor)) || []) });
        }
        return weeks;
    }

    /**
     * Every calendar day between the first and last sale of the selection, including days with no sales.
     */
    private calendar(lines: SaleLine[]): DayBucket[] {
        const known = lines.map(line => line.day).filter(day => day).sort();
        if (!known.length) {
            return [];
        }
        const groups = new Map<string, SaleLine[]>();
        lines.filter(line => line.day).forEach(line => groups.set(line.day, [...(groups.get(line.day) || []), line]));
        const [startYear, startMonth, startDate] = known[0].split("-").map(Number);
        const days: DayBucket[] = [];
        const last = known[known.length - 1];
        for (let cursor = new Date(startYear, startMonth - 1, startDate); this.dayKey(cursor) <= last; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
            const key = this.dayKey(cursor);
            days.push({ day: key, totals: this.totals(groups.get(key) || []) });
        }
        return days;
    }

    private statusGroups(lines: SaleLine[]): Array<{ status: string; totals: Totals }> {
        const groups = new Map<string, SaleLine[]>();
        lines.forEach(line => groups.set(line.status, [...(groups.get(line.status) || []), line]));
        const rank = (status: string): number => {
            const position = STATUS_ORDER.indexOf(status);
            return position < 0 ? STATUS_ORDER.length : position;
        };
        return [...groups.entries()]
            .sort((a, b) => rank(a[0]) - rank(b[0]))
            .map(([status, group]) => ({ status, totals: this.totals(group) }));
    }

    private productRows(lines: SaleLine[]): ProductRow[] {
        const rows = new Map<string, ProductRow>();
        lines.forEach(line => {
            const row = rows.get(line.product) || { product: line.product, category: line.category, unknown: line.productUnknown, listPrice: line.listPrice, units: 0, gross: 0, net: 0, price: 0 };
            row.units += line.quantity;
            row.gross += line.gross;
            row.net += line.net;
            row.price = row.units ? row.gross / row.units : 0;
            rows.set(line.product, row);
        });
        return [...rows.values()];
    }

    private productTooltip(row: ProductRow, total: number): TooltipRow[] {
        return [
            { label: "Net revenue", value: `${this.money(row.net)} TND`, color: NEON.cyan },
            { label: "Share of net", value: this.pct(total ? row.net / total : 0) },
            { label: "Gross sales", value: `${this.money(row.gross)} TND` },
            { label: "Units sold", value: this.int(row.units) },
            { label: "Avg selling price", value: `${this.money(row.price)} TND` },
            { label: "List price", value: row.listPrice === null ? "none" : `${this.money(row.listPrice)} TND` }
        ];
    }

    // ---------- Pages ----------

    private render(): void {
        this.charts.disposeAll();
        this.page.replaceChildren();
        this.renderedKey = this.dataKey();
        this.page.dataset.kind = this.kind;
        const lines = this.filteredLines();
        switch (this.kind) {
            case "orders": this.renderOrders(lines); break;
            case "price": this.renderPrice(lines); break;
            case "trends": this.renderTrends(lines); break;
            case "quality": this.renderQuality(); break;
            default: this.renderProducts(lines);
        }
        this.charts.flush();
    }

    private renderProducts(lines: SaleLine[]): void {
        this.renderHeader(lines);
        this.renderCategoryFilter();
        const totals = this.totals(lines);
        const products = this.productRows(lines);
        const byNet = [...products].sort((a, b) => b.net - a.net || a.product.localeCompare(b.product));
        const categories = this.categoryRows(lines);
        const top = byNet[0];
        const topCategory = categories[0];
        this.renderKpis([
            { label: "Products Sold", value: this.int(products.length), note: "with sales in this selection", iconName: "Boxes", spark: { label: "Units sold", lines, metric: t => t.units, money: false, bars: true } },
            { label: "Top Product", value: top ? top.product : "—", note: top ? `${this.money(top.net)} TND net revenue` : "No sales", iconName: "Trophy", spark: top ? { label: "Net revenue", lines: lines.filter(line => line.product === top.product), metric: t => t.net, money: true } : undefined },
            { label: "Top Category", value: topCategory ? topCategory.name : "—", note: topCategory ? `${this.pct(topCategory.share)} of net revenue` : "No sales", iconName: "Tag", spark: topCategory ? { label: "Net revenue", lines: lines.filter(line => line.category === topCategory.name), metric: t => t.net, money: true, bars: true } : undefined },
            { label: "Avg Unit Price", value: this.money(totals.units ? totals.gross / totals.units : 0), unit: "TND", note: `${this.int(totals.units)} units sold`, iconName: "Banknote", spark: { label: "Avg unit price", lines, metric: t => (t.units ? t.gross / t.units : 0), money: true } }
        ]);

        const middle = this.row("sp-row-products");
        const barsCard = this.el("section", "sp-card sp-grow-3", middle);
        this.cardHead(barsCard, "Net Revenue by Product", "Ranked by net revenue · share of total", "ChartBar");
        this.barChart(barsCard, byNet.map(row => ({
            name: row.product,
            value: row.net,
            label: `${this.money(row.net)}  ·  ${Math.round(totals.net ? (row.net / totals.net) * 100 : 0)}%`,
            color: row.unknown ? "unknown" : (row.net === 0 ? "zero" : undefined),
            tooltip: this.productTooltip(row, totals.net),
            footer: row.category
        })));

        const mixCard = this.el("section", "sp-card sp-grow-2", middle);
        this.cardHead(mixCard, "Net Revenue by Category", "Share of net revenue · click a category to filter", "ChartPie");
        this.categoryMix(mixCard, categories, totals, lines);

        const tableCard = this.el("section", "sp-card sp-table-card", this.row("sp-row-fill"));
        this.dataTable<ProductRow>(tableCard, { id: "products", title: "Product Metrics", subtitle: "Sort by clicking a header · search by product or category", rows: products, columns: [
            this.productColumn(),
            { key: "units", label: "Units", numeric: true, sortValue: r => r.units, render: (c, r) => { c.textContent = this.int(r.units); } },
            { key: "price", label: "Avg Price", numeric: true, sortValue: r => r.price, render: (c, r) => { c.textContent = this.money(r.price); } },
            { key: "gross", label: "Gross", numeric: true, sortValue: r => r.gross, render: (c, r) => { c.textContent = this.money(r.gross); c.classList.add("sp-muted"); } },
            this.netColumn(),
            this.shareColumn(totals.net)
        ], sort: { key: "net", descending: true }, searchText: row => `${row.product} ${row.category}` });
    }

    private renderOrders(lines: SaleLine[]): void {
        const totals = this.totals(lines);
        const statuses = this.statusGroups(lines);
        const named = (name: string): Totals => {
            const found = statuses.find(status => status.status === name);
            return found ? found.totals : this.totals([]);
        };
        const completed = named("Completed");
        const cancelled = named("Cancelled");
        const returned = named("Returned");
        this.renderHeader(lines, `${this.int(totals.orders)} orders · ${this.int(completed.orders)} completed`);
        if (this.filters.order) {
            this.orderChip(this.page.querySelector(".sp-header-right") as HTMLElement);
        }
        this.renderKpis([
            { label: "Orders", value: this.int(totals.orders), note: `${this.int(completed.orders)} completed`, iconName: "ShoppingCart", spark: { label: "Orders", lines, metric: t => t.orders, money: false, delta: true } },
            { label: "Order Lines", value: this.int(totals.lines), note: `${(totals.orders ? totals.lines / totals.orders : 0).toFixed(2)} lines per order`, iconName: "ListChecks", spark: { label: "Order lines", lines, metric: t => t.lines, money: false, bars: true, delta: true } },
            { label: "Avg Order Value", value: this.money(totals.orders ? totals.net / totals.orders : 0), unit: "TND", note: "net revenue per order", iconName: "Banknote", spark: { label: "Avg order value", lines, metric: t => (t.orders ? t.net / t.orders : 0), money: true, delta: true } },
            { label: "Cancelled Gross", value: this.money(cancelled.gross), unit: "TND", note: `${this.int(cancelled.orders)} cancelled · ${this.money(returned.gross)} returned`, iconName: "Ban", warning: true, spark: { label: "Cancelled gross", lines: lines.filter(line => line.status === "Cancelled"), metric: t => t.gross, money: true, bars: true } }
        ]);

        const middle = this.row("sp-row-orders");
        const grossCard = this.el("section", "sp-card sp-grow-1", middle);
        this.cardHead(grossCard, "Gross vs Net by Order Status", "Outlined bar = gross sales · filled bar = net revenue", "Receipt");
        this.overlapChart(grossCard, statuses.map(status => ({
            name: status.status,
            outer: status.totals.gross,
            inner: status.totals.net,
            label: `${this.money(status.totals.gross)} / ${this.money(status.totals.net)}`,
            color: STATUS_COLORS[status.status] || NEON.muted,
            tooltip: [
                { label: "Gross sales", value: `${this.money(status.totals.gross)} TND`, color: STATUS_COLORS[status.status] || NEON.muted },
                { label: "Net revenue", value: `${this.money(status.totals.net)} TND` },
                { label: "Lost", value: `${this.money(status.totals.gross - status.totals.net)} TND` },
                { label: "Orders", value: this.int(status.totals.orders) },
                { label: "Order lines", value: this.int(status.totals.lines) },
                { label: "Units", value: this.int(status.totals.units) }
            ]
        })), "Gross", "Net");

        const mixCard = this.el("section", "sp-card sp-grow-1", middle);
        this.cardHead(mixCard, "Orders by Status", "Share of orders by status · net revenue kept", "ChartPie");
        this.donutWithLegend(mixCard, statuses.map(status => ({
            name: status.status,
            value: status.totals.orders,
            color: STATUS_COLORS[status.status] || NEON.muted,
            valueText: this.int(status.totals.orders),
            note: `${this.money(status.totals.net)} net`,
            tooltip: [
                { label: "Orders", value: this.int(status.totals.orders), color: STATUS_COLORS[status.status] || NEON.muted },
                { label: "Share of orders", value: this.pct(totals.orders ? status.totals.orders / totals.orders : 0) },
                { label: "Net revenue", value: `${this.money(status.totals.net)} TND` },
                { label: "Gross sales", value: `${this.money(status.totals.gross)} TND` },
                { label: "Avg order value", value: `${this.money(status.totals.orders ? status.totals.net / status.totals.orders : 0)} TND` }
            ]
        })), "Orders", this.int(totals.orders));

        // Every line stays listed; clicking one filters the KPIs and charts above to its order.
        const picked = this.filters.order;
        const tableCard = this.el("section", "sp-card sp-table-card", this.row("sp-row-fill"));
        this.dataTable<SaleLine>(tableCard, {
            id: "lines",
            title: "Order Line Detail",
            subtitle: picked ? `Showing ${picked} above · click it again, or the order chip, to show every order` : "Filter or sort any column · click a line to filter the page to its order",
            iconName: "ListChecks",
            rows: this.lines,
            columns: [
                { key: "line", label: "Line", sortValue: r => r.lineId, render: (c, r) => { c.textContent = r.lineId; c.classList.add("rp-strong"); } },
                { key: "order", label: "Order", sortValue: r => r.orderId, render: (c, r) => { c.textContent = r.orderId; }, filterValues: r => [r.orderId] },
                { key: "product", label: "Product", sortValue: r => r.product, render: (c, r) => this.productCell(c, r.product, r.productUnknown), filterValues: r => [r.product] },
                { key: "store", label: "Store", sortValue: r => r.store, render: (c, r) => this.textCell(c, r.store), filterValues: r => [r.store] },
                { key: "qty", label: "Qty", numeric: true, sortValue: r => r.quantity, render: (c, r) => { c.textContent = this.int(r.quantity); } },
                { key: "price", label: "Unit Price", numeric: true, sortValue: r => r.unitPrice, render: (c, r) => { c.textContent = this.money(r.unitPrice); } },
                { key: "gross", label: "Gross", numeric: true, sortValue: r => r.gross, render: (c, r) => { c.textContent = this.money(r.gross); c.classList.add("sp-muted"); } },
                { key: "net", label: "Net", numeric: true, sortValue: r => r.net, render: (c, r) => { c.textContent = this.money(r.net); c.classList.add("sp-net"); c.classList.toggle("sp-zero", r.net === 0); } },
                { key: "status", label: "Status", sortValue: r => r.status, render: (c, r) => this.pillCell(c, r.status), filterValues: r => [r.status] },
                { key: "flag", label: "Flags", sortValue: r => r.flag, render: (c, r) => this.flagCell(c, r.flag), filterValues: r => this.splitFlags(r.flag) }
            ],
            sort: { key: "line", descending: false },
            searchText: r => `${r.lineId} ${r.orderId} ${r.product} ${r.store} ${r.status} ${r.flag}`,
            onRowClick: r => this.setFilters({ ...this.filters, order: picked === r.orderId ? "" : r.orderId }),
            isRowActive: picked ? r => r.orderId === picked : undefined
        });
    }

    /** Header chip naming the order picked in the line table; clicking it shows every order again. */
    private orderChip(parent: HTMLElement): void {
        const chip = this.el("button", "sp-pill rp-order-chip", parent) as HTMLButtonElement;
        chip.title = "Show every order";
        chip.appendChild(document.createTextNode(`Order ${this.filters.order}`));
        chip.appendChild(icon("X", 14));
        chip.addEventListener("click", () => this.setFilters({ ...this.filters, order: "" }));
        parent.insertBefore(chip, parent.firstChild);
    }

    private renderPrice(lines: SaleLine[]): void {
        const totals = this.totals(lines);
        const products = this.productRows(lines);
        const listed = products.filter(row => row.listPrice !== null);
        const avgList = listed.length ? listed.reduce((sum, row) => sum + row.listPrice, 0) / listed.length : 0;
        const matched = lines.filter(line => line.listPrice !== null);
        const listValue = matched.reduce((sum, line) => sum + line.quantity * line.listPrice, 0);
        const soldValue = matched.reduce((sum, line) => sum + line.gross, 0);
        const discount = totals.gross ? lines.reduce((sum, line) => sum + line.gross * line.discount, 0) / totals.gross : 0;
        this.renderHeader(lines, "All prices in TND");
        this.renderKpis([
            { label: "Avg Selling Price", value: this.money(totals.units ? totals.gross / totals.units : 0), unit: "TND", note: "gross sales / units sold", iconName: "Banknote", spark: { label: "Avg selling price", lines, metric: t => (t.units ? t.gross / t.units : 0), money: true, delta: true } },
            { label: "Avg List Price", value: this.money(avgList), unit: "TND", note: `${this.int(listed.length)} sold products with a list price`, iconName: "Tag" },
            { label: "Price Realisation", value: this.pct(listValue ? soldValue / listValue : 0), note: "selling value vs list value", iconName: "Scale" },
            { label: "Avg Discount", value: `${discount.toFixed(2)}%`, note: discount === 0 ? "no discounts recorded" : "weighted by gross sales", iconName: "Percent" }
        ]);

        const middle = this.row("sp-row-price");
        const barsCard = this.el("section", "sp-card sp-grow-1", middle);
        this.cardHead(barsCard, "Average Unit Price by Product", "Gross sales / units sold · ranked by price", "ChartBar");
        const byPrice = [...products].sort((a, b) => b.price - a.price || a.product.localeCompare(b.product));
        this.barChart(barsCard, byPrice.map(row => ({
            name: row.product,
            value: row.price,
            label: `${this.money(row.price)}  ·  ${this.unitsText(row.units)}`,
            color: row.unknown ? "unknown" : undefined,
            tooltip: this.productTooltip(row, totals.net),
            footer: row.category
        })));

        const scatterCard = this.el("section", "sp-card sp-grow-1", middle);
        this.cardHead(scatterCard, "Units vs Average Price", "Each bubble is a product · bubble size = net revenue", "ChartScatter");
        this.scatter(scatterCard, products, totals.net);

        const bottom = this.row("sp-row-fill sp-row-with-slot");
        const listCard = this.el("section", "sp-card rp-list-card", bottom);
        this.cardHead(listCard, "Selling Price vs List Price", "Filled bar = avg selling price · outlined bar = list price", "Scale");
        const byList = [...products].sort((a, b) => (b.listPrice || 0) - (a.listPrice || 0) || a.product.localeCompare(b.product));
        this.overlapChart(listCard, byList.map(row => {
            const delta = row.listPrice ? row.price / row.listPrice - 1 : 0;
            const state = row.listPrice === null ? "no list price" : (Math.abs(delta) < 0.0005 ? "= list" : `${delta < 0 ? "▼" : "▲"} ${this.pct(Math.abs(delta))}`);
            return {
                name: row.product,
                outer: row.listPrice === null ? row.price : row.listPrice,
                inner: row.price,
                label: `${this.money(row.price)}  ·  ${state}`,
                color: NEON.cyan,
                tooltip: [
                    { label: "Avg selling price", value: `${this.money(row.price)} TND`, color: NEON.cyan },
                    { label: "List price", value: row.listPrice === null ? "none" : `${this.money(row.listPrice)} TND` },
                    { label: "Difference", value: row.listPrice === null ? "n/a" : `${this.money(row.price - row.listPrice)} TND (${this.pct(delta)})` },
                    { label: "Units sold", value: this.int(row.units) },
                    { label: "Gross sales", value: `${this.money(row.gross)} TND` },
                    { label: "Net revenue", value: `${this.money(row.net)} TND` }
                ]
            };
        }), "List price", "Selling price");

        const tableCard = this.el("section", "sp-card sp-grow-1 sp-table-card", bottom);
        this.dataTable<ProductRow>(tableCard, {
            id: "price",
            title: "Price Metrics",
            subtitle: "List vs selling price, volume and gross sales · sold products",
            rows: products,
            columns: [
                { ...this.productColumn(), filterValues: r => [r.category], filterLabel: "Category" },
                { key: "list", label: "List", numeric: true, sortValue: r => (r.listPrice === null ? -1 : r.listPrice), render: (c, r) => this.numberCell(c, r.listPrice) },
                { key: "price", label: "Avg Price", numeric: true, sortValue: r => r.price, render: (c, r) => { c.textContent = this.money(r.price); c.classList.add("sp-net"); } },
                { key: "units", label: "Units", numeric: true, sortValue: r => r.units, render: (c, r) => { c.textContent = this.int(r.units); } },
                { key: "gross", label: "Gross", numeric: true, sortValue: r => r.gross, render: (c, r) => { c.textContent = this.money(r.gross); c.classList.add("sp-muted"); } }
            ],
            sort: { key: "gross", descending: true },
            searchText: r => `${r.product} ${r.category}`
        });
    }

    private renderTrends(lines: SaleLine[]): void {
        this.renderHeader(lines);
        this.renderDateFilter();
        const totals = this.totals(lines);
        const days = this.calendar(lines);
        const active = days.filter(day => day.totals.orders > 0);
        const months = this.monthBuckets(lines);
        const bestMonth = [...months].sort((a, b) => b.totals.net - a.totals.net)[0];
        const peak = [...active].sort((a, b) => b.totals.net - a.totals.net || a.day.localeCompare(b.day))[0];
        this.renderKpis([
            { label: "Active Sales Days", value: this.int(active.length), note: `of ${this.int(days.length)} days in range`, iconName: "CalendarDays", spark: { label: "Orders", lines, metric: t => t.orders, money: false, bars: true } },
            { label: "Avg Daily Net Revenue", value: this.money(active.length ? totals.net / active.length : 0), unit: "TND", note: "per active sales day", iconName: "Banknote", spark: { label: "Net revenue", lines, metric: t => t.net, money: true } },
            { label: "Best Month", value: bestMonth ? bestMonth.label : "—", note: bestMonth ? `${this.money(bestMonth.totals.net)} TND net revenue` : "No sales", iconName: "Trophy", spark: { label: "Gross sales", lines, metric: t => t.gross, money: true, bars: true } },
            { label: "Peak Day", value: peak ? this.shortDay(peak.day) : "—", note: peak ? `${this.money(peak.totals.net)} TND net revenue` : "No sales", iconName: "Clock", spark: { label: "Units sold", lines, metric: t => t.units, money: false } }
        ]);

        const dailyCard = this.el("section", "sp-card sp-grow-1", this.row("sp-row-daily"));
        const head = this.cardHead(dailyCard, "Net Revenue Trend", "Daily net revenue · dashed line = average per active day · pick a month below to filter", "TrendingUp");
        this.el("div", "rp-note", head, peak ? `Peak ${this.shortDay(peak.day)} · ${this.money(peak.totals.net)} TND` : "");
        this.dailyChart(dailyCard, days, months, peak && peak.day, active.length ? totals.net / active.length : 0);

        const bottom = this.row("sp-row-fill");
        const monthCard = this.el("section", "sp-card sp-grow-1", bottom);
        this.cardHead(monthCard, "Orders and Units by Month", "Order count vs units sold", "ChartColumn");
        this.monthPairs(monthCard, months);

        const tableCard = this.el("section", "sp-card sp-grow-1 sp-table-card", bottom);
        const rows = months.map((month, index) => ({ month, previous: index ? months[index - 1].totals.net : 0, position: index }));
        this.dataTable(tableCard, { id: "months", title: "Monthly Detail", subtitle: "Orders, units, sales and order value per month", rows, columns: [
            { key: "month", label: "Month", sortValue: r => r.position, render: (c, r) => { c.textContent = r.month.label; c.classList.add("rp-strong"); } },
            { key: "orders", label: "Orders", numeric: true, sortValue: r => r.month.totals.orders, render: (c, r) => { c.textContent = this.int(r.month.totals.orders); } },
            { key: "units", label: "Units", numeric: true, sortValue: r => r.month.totals.units, render: (c, r) => { c.textContent = this.int(r.month.totals.units); } },
            { key: "gross", label: "Gross", numeric: true, sortValue: r => r.month.totals.gross, render: (c, r) => { c.textContent = this.money(r.month.totals.gross); c.classList.add("sp-muted"); } },
            { key: "net", label: "Net Revenue", numeric: true, sortValue: r => r.month.totals.net, render: (c, r) => { c.textContent = this.money(r.month.totals.net); c.classList.add("sp-net"); } },
            { key: "aov", label: "AOV", numeric: true, sortValue: r => (r.month.totals.orders ? r.month.totals.net / r.month.totals.orders : 0), render: (c, r) => { c.textContent = this.money(r.month.totals.orders ? r.month.totals.net / r.month.totals.orders : 0); } },
            {
                key: "mom", label: "MoM Net", numeric: true, sortValue: r => (r.previous ? (r.month.totals.net - r.previous) / r.previous : -Infinity), render: (c, r) => {
                    if (!r.previous) {
                        this.el("span", "sp-delta sp-delta-neutral", c, "baseline");
                        return;
                    }
                    const delta = (r.month.totals.net - r.previous) / r.previous;
                    this.el("span", delta >= 0 ? "sp-delta sp-delta-up" : "sp-delta sp-delta-down", c, `${delta >= 0 ? "▲" : "▼"} ${this.pct(Math.abs(delta))}`);
                }
            }
        ], sort: { key: "month", descending: false }, footer: ["Total", this.int(totals.orders), this.int(totals.units), this.money(totals.gross), this.money(totals.net), this.money(totals.orders ? totals.net / totals.orders : 0), ""] });
    }

    private renderQuality(): void {
        const value = (key: string): number => this.measures[key] || 0;
        this.renderHeader([], `${this.int(value("flaggedLines"))} flagged lines · ${this.int(value("paymentExceptions"))} payment exceptions`, true);
        this.renderKpis([
            { label: "Flagged Lines", value: this.int(value("flaggedLines")), note: `of ${this.int(value("orderLines"))} order lines`, iconName: "TriangleAlert", warning: value("flaggedLines") > 0 },
            { label: "Unknown Member Lines", value: this.int(value("unknownLines")), note: "unmatched customer, product or store", iconName: "CircleSlash", warning: value("unknownLines") > 0 },
            { label: "Missing Pay Amount", value: this.int(value("missingPayments")), note: "payment rows without an amount", iconName: "CreditCard", warning: value("missingPayments") > 0 },
            { label: "No Payment Orders", value: this.int(value("noPaymentOrders")), note: "orders with no payment record", iconName: "Ban", warning: value("noPaymentOrders") > 0 },
            { label: "Segment Coverage", value: this.pct(value("segmentCoverage")), note: `${this.int(value("missingSegments"))} customers missing a segment`, iconName: "Users", warning: value("segmentCoverage") < 1 }
        ]);
        if (this.qualityError) {
            this.el("div", "sp-error rp-inline-error", this.page, this.qualityError);
        }

        const t = this.qualityTables;
        const str = (row: JsonRow, key: string): string => (row[key] === null || row[key] === undefined ? "" : String(row[key]));
        const num = (row: JsonRow, key: string): number | null => (typeof row[key] === "number" ? row[key] as number : null);
        const textColumn = (key: string, label: string, options: { filter?: boolean; strong?: boolean } = {}): TableColumn<JsonRow> => ({
            key, label, sortValue: r => str(r, key),
            render: (c, r) => { this.textCell(c, str(r, key)); if (options.strong) { c.classList.add("rp-strong"); } },
            filterValues: options.filter ? r => [str(r, key)] : undefined
        });
        const pillColumn = (key: string, label: string): TableColumn<JsonRow> => ({ key, label, sortValue: r => str(r, key), render: (c, r) => this.pillCell(c, str(r, key)), filterValues: r => [str(r, key)] });
        const flagColumn = (key: string, label: string): TableColumn<JsonRow> => ({ key, label, sortValue: r => str(r, key), render: (c, r) => this.flagCell(c, str(r, key)), filterValues: r => this.splitFlags(str(r, key)) });
        const unknownColumn: TableColumn<JsonRow> = { key: "unknown", label: "Unknown", sortValue: r => (r.unknown ? 1 : 0), render: (c, r) => this.unknownCell(c, r.unknown === true), filterValues: r => [r.unknown ? "Yes" : "No"] };
        const search = (keys: string[]) => (r: JsonRow): string => keys.map(key => str(r, key)).join(" ");
        const flagsFirst = { key: "flag", descending: true };

        const top = this.row("rp-row-quality");
        this.dataTable<JsonRow>(this.el("section", "sp-card sp-grow-1 sp-table-card", top), {
            id: "dq-payments", title: "Payments", subtitle: "All payments · pick a flag to see the exceptions", iconName: "CreditCard", rows: t.payments,
            columns: [
                textColumn("id", "Payment", { strong: true }),
                textColumn("order", "Order"),
                pillColumn("status", "Status"),
                { key: "amount", label: "Amount", numeric: true, sortValue: r => (num(r, "amount") === null ? -Infinity : num(r, "amount")), render: (c, r) => this.numberCell(c, num(r, "amount")) },
                textColumn("method", "Method", { filter: true }),
                flagColumn("flag", "Flag")
            ],
            sort: flagsFirst, searchText: search(["id", "order", "status", "method", "flag"]), emptyText: "No payment rows."
        });
        this.dataTable<JsonRow>(this.el("section", "sp-card sp-grow-1 sp-table-card", top), {
            id: "dq-orders", title: "Order Flags", subtitle: "All orders · pick a flag to see the ones it touched", iconName: "Receipt", rows: t.orders,
            columns: [
                textColumn("id", "Order", { strong: true }),
                { key: "date", label: "Date", sortValue: r => str(r, "date"), render: (c, r) => this.textCell(c, str(r, "date") ? this.formatDay(str(r, "date")) : "") },
                pillColumn("status", "Status"),
                pillColumn("payment", "Payment"),
                { key: "lines", label: "Lines", numeric: true, sortValue: r => num(r, "lines") || 0, render: (c, r) => { c.textContent = this.int(num(r, "lines") || 0); } },
                flagColumn("flag", "Flags")
            ],
            sort: flagsFirst, searchText: search(["id", "date", "status", "payment", "flag"]), emptyText: "No order rows."
        });

        const bottom = this.row("sp-row-fill");
        this.dataTable<JsonRow>(this.el("section", "sp-card sp-grow-1 sp-table-card", bottom), {
            id: "dq-customers", title: "Customers", subtitle: "Segment coverage and unknown members", iconName: "Users", rows: t.customers,
            columns: [textColumn("key", "Key", { strong: true }), textColumn("name", "Name"), textColumn("city", "City", { filter: true }), textColumn("segment", "Segment", { filter: true }), unknownColumn],
            sort: { key: "key", descending: false }, searchText: search(["key", "name", "city", "segment"]), emptyText: "No customer rows."
        });
        this.dataTable<JsonRow>(this.el("section", "sp-card sp-grow-1 sp-table-card", bottom), {
            id: "dq-products", title: "Products", subtitle: "Whole catalogue and unknown members", iconName: "Package", rows: t.products,
            columns: [
                textColumn("key", "Key", { strong: true }), textColumn("name", "Name"), textColumn("category", "Category", { filter: true }),
                { key: "listPrice", label: "List", numeric: true, sortValue: r => (num(r, "listPrice") === null ? -Infinity : num(r, "listPrice")), render: (c, r) => this.numberCell(c, num(r, "listPrice")) },
                unknownColumn
            ],
            sort: { key: "key", descending: false }, searchText: search(["key", "name", "category"]), emptyText: "No product rows."
        });
        this.dataTable<JsonRow>(this.el("section", "sp-card sp-grow-1 sp-table-card", bottom), {
            id: "dq-stores", title: "Stores", subtitle: "Store master data and unknown members", iconName: "Store", rows: t.stores,
            columns: [textColumn("key", "Key", { strong: true }), textColumn("name", "Name"), textColumn("city", "City", { filter: true }), textColumn("region", "Region", { filter: true }), unknownColumn],
            sort: { key: "key", descending: false }, searchText: search(["key", "name", "city", "region"]), emptyText: "No store rows."
        });
    }

    // ---------- Shared sections ----------

    private renderHeader(lines: SaleLine[], pill?: string, warning = false): void {
        const page = PAGES[this.kind];
        const header = this.el("header", "sp-header rp-header", this.page);
        const left = this.el("div", "", header);
        this.el("div", "sp-eyebrow", left, page.eyebrow);
        const titleRow = this.el("div", "rp-title-row", left);
        this.el("span", "sp-title", titleRow, page.title);
        this.el("span", "rp-subtitle", titleRow, page.subtitle);
        const right = this.el("div", "sp-header-right", header);
        if (pill) {
            this.el("div", warning ? "sp-pill rp-pill-warning" : "sp-pill", right, pill);
            return;
        }
        const days = lines.map(line => line.day).filter(day => day).sort();
        this.el("div", "sp-pill", right, days.length ? `${this.formatDay(days[0])}  →  ${this.formatDay(days[days.length - 1])}` : "No sales in selection");
    }

    private renderKpis(cards: KpiCard[]): void {
        const row = this.el("div", "sp-row sp-kpis", this.page);
        cards.forEach((card, index) => {
            const color = card.warning ? NEON.pink : KPI_COLORS[index];
            const element = this.el("div", `sp-kpi ${card.warning ? "nx-pink" : KPI_TONES[index]}`, row);
            const text = this.el("div", "nx-kpi-text", element);
            this.el("div", "sp-kpi-label", text, card.label);
            const valueRow = this.el("div", "sp-kpi-value-row", text);
            const value = this.el("span", card.value.length > 9 ? "sp-kpi-value rp-kpi-long" : "sp-kpi-value", valueRow, card.value);
            value.title = card.value;
            if (card.unit) {
                this.el("span", "sp-kpi-unit", valueRow, card.unit);
            }
            const note = this.el("div", "sp-kpi-note", text);
            if (card.spark && card.spark.delta) {
                const months = this.monthBuckets(card.spark.lines);
                const last = months[months.length - 1];
                const previous = months[months.length - 2];
                if (last && previous && card.spark.metric(previous.totals)) {
                    const delta = (card.spark.metric(last.totals) - card.spark.metric(previous.totals)) / card.spark.metric(previous.totals);
                    this.el("span", delta >= 0 ? "nx-delta" : "nx-delta nx-delta-down", note, `${delta >= 0 ? "▲" : "▼"} ${this.pct(Math.abs(delta))}`);
                    note.title = `${last.label} vs ${previous.label}`;
                }
            }
            note.appendChild(document.createTextNode(card.note));
            const side = this.el("div", card.spark ? "nx-kpi-side" : "nx-kpi-side nx-kpi-side-small", element);
            this.el("div", "nx-kpi-icon", side).appendChild(icon(card.iconName, 20));
            if (card.spark) {
                this.spark(this.el("div", "nx-spark", side), card.spark, color);
            }
        });
    }

    private spark(element: HTMLElement, spark: KpiSpark, color: string): void {
        const weeks = this.weekBuckets(spark.lines);
        const data = weeks.map(week => spark.metric(week.totals));
        this.charts.queue(element, {
            grid: { left: 2, right: 2, top: 4, bottom: 2 },
            xAxis: { type: "category", show: false, data: weeks.map(week => week.label), boundaryGap: Boolean(spark.bars) },
            yAxis: { type: "value", show: false, min: 0 },
            tooltip: glassTooltip({
                trigger: "axis",
                axisPointer: { type: "none" },
                formatter: (params: Array<{ dataIndex: number }>) => {
                    const index = params[0].dataIndex;
                    return tooltipHtml(`Week of ${weeks[index].label}`, [{ label: spark.label, value: spark.money ? `${this.money(data[index])} TND` : this.int(data[index]), color }]);
                }
            }),
            series: [spark.bars
                ? { type: "bar", data, barWidth: "62%", itemStyle: { color: linear(color, `${color}55`), borderRadius: [3, 3, 0, 0] }, animationDelay: (index: number) => index * 40 }
                : { type: "line", data, smooth: true, showSymbol: false, lineStyle: { color, width: 2.5, shadowColor: color, shadowBlur: 10 }, itemStyle: { color }, areaStyle: { color: linear(`${color}66`, `${color}00`) } }]
        });
    }

    private row(className: string): HTMLElement {
        return this.el("div", `sp-row ${className}`, this.page);
    }

    private renderCategoryFilter(): void {
        const bar = this.el("section", "sp-card sp-filters rp-filters-one", this.page);
        const cell = this.filterCell(bar, "Category", "Tag");
        const selected = this.filters.categories;
        const options = [{ value: "", label: "All categories" }, ...this.distinct(this.lines.map(line => line.category)).map(value => ({ value, label: value }))];
        this.select(cell, "sp-select", options, selected[0] || "", value => this.setFilters({ ...this.filters, categories: value ? [value] : [] }));
        this.clearButton(bar);
    }

    private renderDateFilter(): void {
        const bar = this.el("section", "sp-card sp-filters rp-filters-one", this.page);
        const allDays = this.distinct(this.lines.map(line => line.day).filter(day => day));
        const row = this.el("div", "sp-date-row", this.filterCell(bar, "Date range", "CalendarRange"));
        this.dateInput(row, this.filters.from, allDays, "From", value => this.setFilters({ ...this.filters, from: value }));
        this.el("span", "sp-filter-sep", row, "→");
        this.dateInput(row, this.filters.to, allDays, "To", value => this.setFilters({ ...this.filters, to: value }));
        const months = this.monthBuckets(this.lines);
        const activeMonth = months.find(month => this.filters.from === month.from && this.filters.to === month.to);
        const custom = !activeMonth && (this.filters.from || this.filters.to);
        const periods = [{ value: "", label: "All dates" }, ...months.map(month => ({ value: month.key, label: month.label }))];
        if (custom) {
            periods.push({ value: "custom", label: "Custom range" });
        }
        this.select(row, "sp-select sp-select-period", periods, activeMonth ? activeMonth.key : (custom ? "custom" : ""), value => {
            const month = months.find(item => item.key === value);
            if (value === "") {
                this.setFilters({ ...this.filters, from: "", to: "" });
            } else if (month) {
                this.setFilters({ ...this.filters, from: month.from, to: month.to });
            }
        });
        this.clearButton(bar);
    }

    private clearButton(parent: HTMLElement): void {
        const f = this.filters;
        const actions = this.el("div", "sp-filter-actions", parent);
        const clear = this.el("button", "sp-clear", actions) as HTMLButtonElement;
        clear.appendChild(icon("X", 15));
        clear.appendChild(document.createTextNode("Clear all"));
        clear.disabled = !(f.from || f.to || f.categories.length || f.order);
        clear.addEventListener("click", () => this.setFilters({ ...EMPTY_FILTERS }));
    }

    private filterCell(parent: HTMLElement, label: string, iconName: IconName): HTMLElement {
        const cell = this.el("div", "sp-filter-cell", parent);
        const labelElement = this.el("div", "sp-filter-label", cell);
        labelElement.appendChild(icon(iconName, 15));
        labelElement.appendChild(document.createTextNode(label));
        return cell;
    }

    private select(parent: HTMLElement, className: string, options: Array<{ value: string; label: string }>, value: string, onChange: (value: string) => void): void {
        const select = this.el("select", className, parent) as HTMLSelectElement;
        options.forEach(option => {
            const element = this.el("option", "", select, option.label) as HTMLOptionElement;
            element.value = option.value;
        });
        select.value = value;
        select.classList.toggle("sp-select-active", value !== "");
        select.addEventListener("change", () => onChange(select.value));
    }

    private dateInput(parent: HTMLElement, value: string, allDays: string[], title: string, onChange: (value: string) => void): void {
        const input = this.el("input", value ? "sp-date sp-select-active" : "sp-date", parent) as HTMLInputElement;
        input.type = "date";
        input.title = title;
        input.value = value;
        if (allDays.length) {
            input.min = allDays[0];
            input.max = allDays[allDays.length - 1];
        }
        input.addEventListener("change", () => onChange(input.value));
    }

    private cardHead(card: HTMLElement, title: string, subtitle: string, iconName: IconName): HTMLElement {
        const head = this.el("div", "sp-card-head", card);
        const text = this.el("div", "", head);
        const titleElement = this.el("div", "sp-card-title", text);
        titleElement.appendChild(icon(iconName, 20));
        titleElement.appendChild(document.createTextNode(title));
        this.el("div", "sp-card-subtitle", text, subtitle);
        return head;
    }

    private categoryRows(lines: SaleLine[]): Array<{ name: string; value: number; share: number }> {
        const net = new Map<string, number>();
        lines.forEach(line => net.set(line.category, (net.get(line.category) || 0) + line.net));
        const total = [...net.values()].reduce((sum, value) => sum + value, 0);
        return [...net.entries()]
            .map(([name, value]) => ({ name, value, share: total ? value / total : 0 }))
            .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    }

    private categoryMix(card: HTMLElement, categories: Array<{ name: string; value: number; share: number }>, totals: Totals, lines: SaleLine[]): void {
        this.donutWithLegend(card, categories.filter(category => category.value > 0).map((category, index) => {
            const group = this.totals(lines.filter(line => line.category === category.name));
            const color = CATEGORY_COLORS[Math.min(index, CATEGORY_COLORS.length - 1)];
            return {
                name: category.name,
                value: category.value,
                color,
                valueText: this.money(category.value),
                note: this.unitsText(group.units),
                tooltip: [
                    { label: "Net revenue", value: `${this.money(group.net)} TND`, color },
                    { label: "Share of net", value: this.pct(category.share) },
                    { label: "Gross sales", value: `${this.money(group.gross)} TND` },
                    { label: "Units sold", value: this.int(group.units) },
                    { label: "Orders", value: this.int(group.orders) }
                ],
                footer: "Click to filter by this category",
                onClick: () => {
                    const selected = this.filters.categories;
                    this.setFilters({ ...this.filters, categories: selected.length === 1 && selected[0] === category.name ? [] : [category.name] });
                },
                active: this.filters.categories.includes(category.name)
            };
        }), "Net revenue", this.int(totals.net));
    }

    private donutWithLegend(card: HTMLElement, items: DonutItem[], label: string, center: string): void {
        const total = items.reduce((sum, item) => sum + item.value, 0);
        if (!items.length || total === 0) {
            this.el("div", "sp-empty", card, "No sales in this selection.");
            return;
        }
        const body = this.el("div", "sp-status-body", card);
        const donut = this.el("div", "nx-donut", body);
        const chart = this.el("div", "nx-chart", donut);
        chart.style.height = "100%";
        const hole = this.el("div", "nx-donut-center", donut);
        this.el("div", "sp-donut-label", hole, label);
        this.el("div", "sp-donut-value", hole, center);
        this.charts.queue(chart, {
            tooltip: glassTooltip({
                trigger: "item",
                formatter: (params: { dataIndex: number }) => {
                    const item = items[params.dataIndex];
                    return tooltipHtml(item.name, item.tooltip, item.footer);
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
                data: items.map(item => ({ name: item.name, value: item.value, itemStyle: { color: item.color, shadowColor: item.color, shadowBlur: 14 } }))
            }]
        }, params => {
            const item = items[params.dataIndex];
            if (item.onClick) {
                item.onClick();
            }
        });
        const legend = this.el("div", "sp-legend", body);
        items.forEach(item => {
            const row = this.el("div", `sp-legend-row${item.active ? " sp-legend-active" : ""}${item.onClick ? "" : " rp-no-click"}`, legend);
            if (item.onClick) {
                row.addEventListener("click", item.onClick);
            }
            const swatch = this.el("span", "sp-swatch", row);
            swatch.style.background = item.color;
            swatch.style.color = item.color;
            this.el("span", "sp-legend-name", row, item.name);
            this.el("span", "rp-note", row, item.note);
            this.el("span", "sp-legend-value", row, item.valueText);
            this.el("span", "sp-legend-share", row, this.pct(item.value / total));
        });
    }

    private barChart(card: HTMLElement, rows: BarRow[]): void {
        if (!rows.length) {
            this.el("div", "sp-empty", card, "No sales in this selection.");
            return;
        }
        this.charts.queue(this.el("div", "nx-chart nx-grow", card), {
            grid: { left: 8, right: 170, top: 10, bottom: 4, containLabel: true },
            xAxis: { type: "value", show: false, min: 0 },
            yAxis: { type: "category", inverse: true, data: rows.map(row => row.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: NEON.soft, fontSize: 14, margin: 12, width: 190, overflow: "truncate" } },
            tooltip: glassTooltip({
                trigger: "item",
                formatter: (params: { dataIndex: number }) => {
                    const row = rows[params.dataIndex];
                    return tooltipHtml(row.name, row.tooltip, row.footer);
                }
            }),
            series: [{
                type: "bar",
                barMaxWidth: 16,
                showBackground: true,
                backgroundStyle: { color: "rgba(148, 163, 255, 0.10)", borderRadius: 99 },
                animationDelay: (index: number) => index * 60,
                label: {
                    show: true,
                    position: "right",
                    distance: 10,
                    color: NEON.text,
                    fontSize: 14,
                    fontWeight: 700,
                    formatter: (params: { dataIndex: number }) => rows[params.dataIndex].label
                },
                data: rows.map(row => ({
                    value: row.value,
                    itemStyle: {
                        borderRadius: 99,
                        color: row.color ? linear(NEON.pink, NEON.orange, true) : linear(NEON.violet, NEON.cyan, true),
                        shadowColor: row.color ? NEON.pink : NEON.cyan,
                        shadowBlur: 10
                    }
                }))
            }]
        });
    }

    /**
     * Horizontal bars with an outlined outer value and a filled inner value on the same row.
     */
    private overlapChart(card: HTMLElement, rows: Array<{ name: string; outer: number; inner: number; label: string; color: string; tooltip: TooltipRow[] }>, outerName: string, innerName: string): void {
        if (!rows.length) {
            this.el("div", "sp-empty", card, "No sales in this selection.");
            return;
        }
        const legend = this.el("div", "rp-legend", card);
        this.el("span", "rp-key rp-key-outline", legend);
        this.el("span", "rp-note", legend, outerName);
        this.el("span", "rp-key rp-key-fill", legend);
        this.el("span", "rp-note", legend, innerName);
        this.charts.queue(this.el("div", "nx-chart nx-grow", card), {
            grid: { left: 8, right: 200, top: 6, bottom: 4, containLabel: true },
            xAxis: { type: "value", show: false, min: 0 },
            yAxis: { type: "category", inverse: true, data: rows.map(row => row.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: NEON.soft, fontSize: 14, margin: 12, width: 190, overflow: "truncate" } },
            tooltip: glassTooltip({
                trigger: "axis",
                axisPointer: { type: "shadow", shadowStyle: { color: "rgba(34, 211, 238, 0.06)" } },
                formatter: (params: Array<{ dataIndex: number }>) => {
                    const row = rows[params[0].dataIndex];
                    return tooltipHtml(row.name, row.tooltip);
                }
            }),
            series: [
                {
                    name: outerName,
                    type: "bar",
                    barMaxWidth: 22,
                    barGap: "-100%",
                    z: 1,
                    data: rows.map(row => ({ value: row.outer, itemStyle: { color: `${row.color}22`, borderColor: `${row.color}AA`, borderWidth: 1, borderRadius: 99 } })),
                    label: { show: true, position: "right", distance: 10, color: NEON.text, fontSize: 14, fontWeight: 700, formatter: (params: { dataIndex: number }) => rows[params.dataIndex].label },
                    animationDelay: (index: number) => index * 60
                },
                {
                    name: innerName,
                    type: "bar",
                    barMaxWidth: 22,
                    z: 2,
                    data: rows.map(row => ({ value: row.inner, itemStyle: { color: linear(`${row.color}77`, row.color, true), borderRadius: 99, shadowColor: row.color, shadowBlur: 10 } })),
                    animationDelay: (index: number) => 200 + index * 60
                }
            ]
        });
    }

    private productColumn(): TableColumn<ProductRow> {
        return {
            key: "product", label: "Product", sortValue: r => r.product, render: (c, r) => {
                this.el("div", "sp-product", c, r.product);
                this.el("div", "sp-category", c, r.category);
            }
        };
    }

    private netColumn(): TableColumn<ProductRow> {
        return { key: "net", label: "Net Revenue", numeric: true, sortValue: r => r.net, render: (c, r) => { c.textContent = this.money(r.net); c.classList.add("sp-net"); c.classList.toggle("sp-zero", r.net === 0); } };
    }

    private shareColumn(total: number): TableColumn<ProductRow> {
        return {
            key: "share", label: "Share of net", sortValue: r => r.net, render: (c, r) => {
                const share = this.el("div", "sp-share", c);
                this.el("div", "sp-fill", this.el("div", "sp-track sp-track-small", share)).style.width = `${total ? (r.net / total) * 100 : 0}%`;
                this.el("span", "sp-share-value", share, this.pct(total ? r.net / total : 0));
            }
        };
    }

    /**
     * Card with a sortable table, plus optional search box, dropdown filters per column, clickable rows and total row.
     * Search and filter changes only refill the rows; sorting redraws the page.
     */
    private dataTable<T>(card: HTMLElement, options: TableOptions<T>): void {
        const { id, rows, columns, searchText, footer, onRowClick, isRowActive } = options;
        const head = this.cardHead(card, options.title, options.subtitle, options.iconName || "PackageSearch");
        const sort = this.tableSorts[id] || options.sort;
        const chosen = this.tableFilters[id] || (this.tableFilters[id] = {});
        const filterable = columns.filter(column => column.filterValues);
        const tools = filterable.length ? this.el("div", "rp-table-tools", card) : undefined;
        filterable.forEach(column => {
            const values = this.distinct(rows.reduce((all, row) => all.concat(column.filterValues(row)), [] as string[]).filter(value => value !== ""));
            if (chosen[column.key] && !values.includes(chosen[column.key])) {
                delete chosen[column.key];
            }
            const label = this.el("label", "rp-table-filter", tools);
            this.el("span", "", label, column.filterLabel || column.label);
            const select = this.el("select", "sp-select", label) as HTMLSelectElement;
            [{ value: "", text: "All" }, ...values.map(value => ({ value, text: value.replace(/_/g, " ") }))].forEach(option => {
                (this.el("option", "", select, option.text) as HTMLOptionElement).value = option.value;
            });
            select.value = chosen[column.key] || "";
            select.classList.toggle("sp-select-active", select.value !== "");
            select.addEventListener("change", () => {
                if (select.value) {
                    chosen[column.key] = select.value;
                } else {
                    delete chosen[column.key];
                }
                select.classList.toggle("sp-select-active", select.value !== "");
                fill();
            });
        });
        const scroll = this.el("div", "sp-table-scroll", card);
        const table = this.el("table", "sp-table", scroll);
        const headRow = this.el("tr", "", this.el("thead", "", table));
        columns.forEach(column => {
            const sorted = sort.key === column.key;
            const th = this.el("th", `${column.numeric ? "sp-num " : ""}${sorted ? "sp-sorted" : ""}`, headRow, `${column.label}${sorted ? (sort.descending ? " ▼" : " ▲") : ""}`);
            th.addEventListener("click", () => {
                this.tableSorts[id] = { key: column.key, descending: sorted ? !sort.descending : Boolean(column.numeric) };
                this.render();
            });
        });
        const body = this.el("tbody", "", table);
        const count = searchText || tools ? this.el("div", "sp-table-count", card) : undefined;
        const active = columns.find(column => column.key === sort.key) || columns[0];
        const fill = (): void => {
            body.replaceChildren();
            const term = (this.tableSearches[id] || "").trim().toLowerCase();
            const filters = filterable.filter(column => chosen[column.key]);
            const visible = rows
                .filter(row => !term || !searchText || searchText(row).toLowerCase().includes(term))
                .filter(row => filters.every(column => column.filterValues(row).includes(chosen[column.key])))
                .sort((a, b) => {
                    const left = active.sortValue(a);
                    const right = active.sortValue(b);
                    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
                    return sort.descending ? -order : order;
                });
            const anyActive = Boolean(isRowActive);
            visible.forEach(row => {
                const tr = this.el("tr", "", body);
                if (anyActive) {
                    tr.classList.add(isRowActive(row) ? "rp-row-active" : "rp-row-dimmed");
                }
                if (onRowClick) {
                    tr.classList.add("rp-row-click");
                    tr.addEventListener("click", () => onRowClick(row));
                }
                columns.forEach(column => column.render(this.el("td", column.numeric ? "sp-num" : "", tr), row));
            });
            if (!visible.length) {
                this.el("td", "sp-empty", this.el("tr", "", body), rows.length ? "No row matches the search or filters." : (options.emptyText || "No sales in this selection.")).setAttribute("colspan", String(columns.length));
            }
            if (count) {
                count.textContent = term || filters.length ? `${visible.length} of ${rows.length} rows` : `${rows.length} rows`;
            }
        };
        if (searchText) {
            const search = this.el("input", "sp-search", head) as HTMLInputElement;
            search.type = "search";
            search.placeholder = "Search…";
            search.value = this.tableSearches[id] || "";
            search.addEventListener("input", () => {
                this.tableSearches[id] = search.value;
                fill();
            });
        }
        fill();
        if (footer) {
            const tr = this.el("tr", "rp-table-total", this.el("tfoot", "", table));
            footer.forEach((text, index) => this.el("td", columns[index].numeric ? "sp-num" : "", tr, text));
        }
    }

    // ---------- Table cells ----------

    private textCell(cell: HTMLElement, text: string): void {
        if (text) {
            cell.textContent = text;
        } else {
            this.el("span", "rp-missing", cell, "—");
        }
    }

    private numberCell(cell: HTMLElement, value: number | null): void {
        if (value === null) {
            this.el("span", "rp-missing", cell, "—");
            return;
        }
        cell.textContent = this.money(value);
        cell.classList.toggle("rp-negative", value < 0);
    }

    private productCell(cell: HTMLElement, product: string, unknown: boolean): void {
        cell.textContent = product;
        if (unknown) {
            this.el("span", "rp-unknown", cell, "UNKNOWN");
        }
    }

    /** Status pill coloured by the status palette (order and payment statuses). */
    private pillCell(cell: HTMLElement, text: string): void {
        if (!text) {
            this.el("span", "rp-missing", cell, "—");
            return;
        }
        const color = PILL_COLORS[text.toLowerCase()] || NEON.soft;
        const pill = this.el("span", "rp-pill", cell, text);
        pill.style.color = color;
        pill.style.borderColor = color;
    }

    /** Data quality flags ("A; B") as chips. */
    private flagCell(cell: HTMLElement, text: string): void {
        const flags = this.splitFlags(text);
        if (!flags.length) {
            this.el("span", "rp-missing", cell, "—");
            return;
        }
        flags.forEach(flag => this.el("span", "rp-chip", cell, flag.replace(/_/g, " ")));
    }

    private unknownCell(cell: HTMLElement, unknown: boolean): void {
        this.el("span", unknown ? "rp-unknown" : "rp-missing", cell, unknown ? "UNKNOWN" : "—");
    }

    private splitFlags(text: string): string[] {
        return text.split(";").map(flag => flag.trim()).filter(flag => flag);
    }

    private scatter(card: HTMLElement, products: ProductRow[], totalNet: number): void {
        if (!products.length) {
            this.el("div", "sp-empty", card, "No sales in this selection.");
            return;
        }
        const maxNet = Math.max(...products.map(row => row.net), 0.0001);
        this.charts.queue(this.el("div", "nx-chart nx-grow", card), {
            grid: { left: 58, right: 28, top: 26, bottom: 40 },
            xAxis: { type: "value", name: "Units sold", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: NEON.muted }, min: 0, ...axisStyle() },
            yAxis: { type: "value", name: "Avg unit price", nameTextStyle: { color: NEON.muted, align: "left" }, min: 0, ...axisStyle() },
            tooltip: glassTooltip({
                trigger: "item",
                formatter: (params: { dataIndex: number }) => {
                    const row = products[params.dataIndex];
                    return tooltipHtml(row.product, this.productTooltip(row, totalNet), row.category);
                }
            }),
            series: [{
                type: "scatter",
                data: products.map(row => ({
                    value: [row.units, row.price],
                    symbolSize: Math.round(16 + Math.sqrt(Math.max(row.net, 0) / maxNet) * 40),
                    itemStyle: row.unknown
                        ? { color: "rgba(244, 114, 182, 0.35)", borderColor: NEON.pink, borderWidth: 1 }
                        : { color: radial("#E0F7FF", NEON.cyan, NEON.violet), shadowColor: NEON.cyan, shadowBlur: 16 }
                })),
                label: { show: true, position: "right", distance: 7, color: NEON.soft, fontSize: 12, formatter: (params: { dataIndex: number }) => products[params.dataIndex].product },
                labelLayout: { hideOverlap: true },
                animationDelay: (index: number) => index * 70,
                emphasis: { scale: 1.2 }
            }]
        });
    }

    private dailyChart(card: HTMLElement, days: DayBucket[], months: MonthBucket[], peak: string | undefined, average: number): void {
        if (!days.length) {
            this.el("div", "sp-empty", card, "No sales in this selection.");
            return;
        }
        const chart = this.el("div", "nx-chart nx-grow", card);
        const chips = this.el("div", "nx-month-chips", card);
        months.forEach((month, index) => {
            const before = index > 0 ? months[index - 1].totals.net : 0;
            const active = this.filters.from === month.from && this.filters.to === month.to;
            const chip = this.el("div", active ? "nx-month-chip nx-active" : "nx-month-chip", chips);
            chip.title = `${month.label}: click to filter the page to this month`;
            chip.addEventListener("click", () => this.setFilters({ ...this.filters, from: active ? "" : month.from, to: active ? "" : month.to }));
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
        const peakIndex = days.findIndex(day => day.day === peak);
        this.charts.queue(chart, {
            grid: { left: 58, right: 18, top: 22, bottom: 26 },
            xAxis: { type: "category", data: days.map(day => this.shortDay(day.day)), boundaryGap: false, ...axisStyle(), axisLabel: { color: NEON.muted, fontSize: 13, interval: 6 } },
            yAxis: { type: "value", min: 0, ...axisStyle() },
            tooltip: glassTooltip({
                trigger: "axis",
                axisPointer: { type: "line", lineStyle: { color: NEON.cyan, width: 1, type: "dashed" } },
                formatter: (params: Array<{ dataIndex: number }>) => {
                    const day = days[params[0].dataIndex];
                    if (!day.totals.orders) {
                        return tooltipHtml(this.formatDay(day.day), [{ label: "Net revenue", value: "No sales" }]);
                    }
                    return tooltipHtml(this.formatDay(day.day), [
                        { label: "Net revenue", value: `${this.money(day.totals.net)} TND`, color: NEON.cyan },
                        { label: "Gross sales", value: `${this.money(day.totals.gross)} TND`, color: NEON.magenta },
                        { label: "Orders", value: this.int(day.totals.orders) },
                        { label: "Units sold", value: this.int(day.totals.units) }
                    ], day.day === peak ? "Peak day" : `${day.totals.net >= average ? "Above" : "Below"} the daily average of ${this.money(average)} TND`);
                }
            }),
            series: [{
                type: "line",
                data: days.map(day => day.totals.net),
                smooth: 0.35,
                showSymbol: false,
                symbol: "circle",
                symbolSize: 8,
                lineStyle: { width: 3, color: linear(NEON.cyan, NEON.magenta, true), shadowColor: "rgba(34, 211, 238, 0.7)", shadowBlur: 14 },
                itemStyle: { color: "#FFFFFF", borderColor: NEON.cyan, borderWidth: 2 },
                areaStyle: { color: linear("rgba(168, 85, 247, 0.55)", "rgba(34, 211, 238, 0.02)") },
                markLine: average > 0 ? {
                    silent: true,
                    symbol: "none",
                    lineStyle: { color: NEON.magenta, type: "dashed", width: 1.5 },
                    label: { color: NEON.magenta, position: "insideEndTop", fontWeight: 700, formatter: `avg ${this.money(average)}` },
                    data: [{ yAxis: average }]
                } : undefined,
                markPoint: peakIndex >= 0 ? {
                    symbol: "circle",
                    symbolSize: 12,
                    itemStyle: { color: "#FFFFFF", shadowColor: NEON.cyan, shadowBlur: 14 },
                    label: { show: false },
                    data: [{ coord: [peakIndex, days[peakIndex].totals.net] }]
                } : undefined
            }]
        });
    }

    private monthPairs(card: HTMLElement, months: MonthBucket[]): void {
        if (!months.length) {
            this.el("div", "sp-empty", card, "No sales in this selection.");
            return;
        }
        const legend = this.el("div", "rp-legend", card);
        this.el("span", "rp-key rp-key-fill", legend);
        this.el("span", "rp-note", legend, "Orders");
        this.el("span", "rp-key rp-key-violet", legend);
        this.el("span", "rp-note", legend, "Units");
        const barLabel = { show: true, position: "top", color: NEON.text, fontSize: 15, fontWeight: 700 };
        this.charts.queue(this.el("div", "nx-chart nx-grow", card), {
            grid: { left: 44, right: 14, top: 26, bottom: 30 },
            xAxis: { type: "category", data: months.map(month => month.label), ...axisStyle(), splitLine: { show: false } },
            yAxis: { type: "value", min: 0, ...axisStyle() },
            tooltip: glassTooltip({
                trigger: "axis",
                axisPointer: { type: "shadow", shadowStyle: { color: "rgba(34, 211, 238, 0.06)" } },
                formatter: (params: Array<{ dataIndex: number }>) => {
                    const month = months[params[0].dataIndex];
                    return tooltipHtml(month.label, [
                        { label: "Orders", value: this.int(month.totals.orders), color: NEON.cyan },
                        { label: "Units sold", value: this.int(month.totals.units), color: NEON.violet },
                        { label: "Units per order", value: (month.totals.orders ? month.totals.units / month.totals.orders : 0).toFixed(1) },
                        { label: "Order lines", value: this.int(month.totals.lines) },
                        { label: "Net revenue", value: `${this.money(month.totals.net)} TND` }
                    ]);
                }
            }),
            series: [
                { name: "Orders", type: "bar", barMaxWidth: 54, label: barLabel, data: months.map(month => month.totals.orders), itemStyle: { color: linear(NEON.cyan, "rgba(34, 211, 238, 0.25)"), borderRadius: [8, 8, 2, 2], shadowColor: NEON.cyan, shadowBlur: 12 }, animationDelay: (index: number) => index * 120 },
                { name: "Units", type: "bar", barMaxWidth: 54, label: barLabel, data: months.map(month => month.totals.units), itemStyle: { color: linear(NEON.violet, "rgba(168, 85, 247, 0.25)"), borderRadius: [8, 8, 2, 2], shadowColor: NEON.violet, shadowBlur: 12 }, animationDelay: (index: number) => 120 + index * 120 }
            ]
        });
    }

    // ---------- Formatting ----------

    private money(value: number): string {
        return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    private int(value: number): string {
        return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
    }

    private unitsText(value: number): string {
        return `${this.int(value)} ${value === 1 ? "unit" : "units"}`;
    }

    private pct(value: number): string {
        return `${(value * 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    }

    private formatDay(day: string): string {
        const [year, month, date] = day.split("-").map(Number);
        return `${MONTHS[month - 1]} ${date}, ${year}`;
    }

    private shortDay(day: string): string {
        const [, month, date] = day.split("-").map(Number);
        return `${MONTHS[month - 1]} ${date}`;
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
