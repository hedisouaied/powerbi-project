/*
 *  Mauve Table — dark table visual for the biproject report.
 *  Per-column filters, global search, header sorting and row cross-filtering.
 */

"use strict";

import powerbi from "powerbi-visuals-api";
import { createElement, Table2 } from "lucide";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataViewTable = powerbi.DataViewTable;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import PrimitiveValue = powerbi.PrimitiveValue;

import { VisualFormattingSettingsModel } from "./settings";

type ColumnKind = "text" | "number" | "date" | "bool" | "status" | "flags";
type FilterControl = "text" | "number" | "select" | "radio";

interface TableColumn {
    name: string;
    kind: ColumnKind;
    format: string | undefined;
    control: FilterControl;
    options: string[];
}

const MAX_SELECT_OPTIONS = 30;
const MAX_RADIO_OPTIONS = 3;
const MAX_RADIO_LABEL = 10;

interface TableRow {
    values: PrimitiveValue[];
    display: string[];
    searchText: string;
    selectionId: ISelectionId;
}

interface NumericCondition {
    operator: ">" | ">=" | "<" | "<=" | "=";
    value: number;
}

const STATUS_COLORS: Record<string, string> = {
    completed: "#22D3EE",
    shipped: "#A855F7",
    pending: "#3B82F6",
    returned: "#FB923C",
    cancelled: "#F472B6",
    refunded: "#F472B6",
    paid: "#34D399",
    "no payment": "#F472B6"
};

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private root: HTMLElement;
    private titleElement: HTMLElement;
    private subtitleElement: HTMLElement;
    private countElement: HTMLElement;
    private clearButton: HTMLButtonElement;
    private searchInput: HTMLInputElement;
    private scroller: HTMLElement;
    private headRow: HTMLTableRowElement;
    private filterRow: HTMLTableRowElement;
    private body: HTMLTableSectionElement;
    private emptyState: HTMLElement;

    private columns: TableColumn[] = [];
    private rows: TableRow[] = [];
    private columnSignature = "";
    private columnFilters: string[] = [];
    private columnControls: FilterControl[] = [];
    private searchText = "";
    private sortColumn = -1;
    private sortDescending = false;
    private selectedKeys = new Set<string>();

    private diagnostics: HTMLElement;

    constructor(options: VisualConstructorOptions) {
        this.diagnostics = document.createElement("div");
        this.diagnostics.style.cssText = "position:absolute;left:8px;bottom:6px;z-index:10;color:#F472B6;font:12px Segoe UI,Arial,sans-serif;pointer-events:none";
        options.element.style.background = "#060818";
        options.element.appendChild(this.diagnostics);
        try {
            this.host = options.host;
            this.events = options.host.eventService;
            this.selectionManager = options.host.createSelectionManager();
            this.formattingSettingsService = new FormattingSettingsService();
            this.selectionManager.registerOnSelectCallback((ids: ISelectionId[]) => {
                this.selectedKeys = new Set(ids.map(id => id.getKey()));
                this.renderBody();
            });
            this.buildShell(options.element);
        } catch (error) {
            this.report(`Constructor error: ${this.describe(error)}`, true);
        }
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        let step = "start";
        try {
            const dataView = options.dataViews && options.dataViews[0];
            // Size from the viewport: the host element has no fixed height, so "100%" can collapse to 0.
            this.root.style.width = `${options.viewport.width}px`;
            this.root.style.height = `${options.viewport.height}px`;
            step = "settings";
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
            this.applySettings();
            step = "data";
            this.readData(dataView && dataView.table);
            step = "header";
            this.renderHeader();
            step = "body";
            this.renderBody();
            this.report(this.layoutProblem(options));
            this.events.renderingFinished(options);
        } catch (error) {
            this.report(`Update error at "${step}": ${this.describe(error)}`, true);
            this.events.renderingFailed(options, String(error));
        }
    }

    /**
     * Shows an error inside the visual instead of failing silently; an empty message clears it.
     */
    private report(message: string, isError = true): void {
        this.diagnostics.textContent = message;
        this.diagnostics.style.color = isError ? "#F472B6" : "#8B93B8";
    }

    /**
     * Returns a description when rows exist but the table can't be seen (collapsed layout or missing styles), otherwise "".
     */
    private layoutProblem(options: VisualUpdateOptions): string {
        const cssLoaded = getComputedStyle(this.root).display === "flex";
        const scrollHeight = this.scroller.clientHeight;
        if (cssLoaded && (scrollHeight >= 20 || this.rows.length === 0)) {
            return "";
        }
        const root = this.root.getBoundingClientRect();
        return `Layout issue: styles ${cssLoaded ? "loaded" : "missing"}, table area ${scrollHeight}px, root ${Math.round(root.width)}×${Math.round(root.height)}, viewport ${Math.round(options.viewport.width)}×${Math.round(options.viewport.height)}, ${this.rows.length} rows`;
    }

    private describe(error: unknown): string {
        return error instanceof Error ? `${error.name}: ${error.message} ${(error.stack || "").split("\n").slice(1, 3).join(" ")}` : String(error);
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    private buildShell(element: HTMLElement): void {
        this.root = this.createElement("div", "mt-root", element);

        const top = this.createElement("div", "mt-top", this.root);
        const heading = this.createElement("div", "mt-heading", top);
        const titleRow = this.createElement("div", "mt-title", heading);
        const titleIcon = createElement(Table2);
        titleIcon.setAttribute("width", "20");
        titleIcon.setAttribute("height", "20");
        titleRow.appendChild(titleIcon);
        this.titleElement = this.createElement("span", "", titleRow);
        this.subtitleElement = this.createElement("div", "mt-subtitle", heading);

        const tools = this.createElement("div", "mt-tools", top);
        this.countElement = this.createElement("span", "mt-count", tools);
        this.clearButton = this.createElement("button", "mt-clear", tools) as HTMLButtonElement;
        this.clearButton.textContent = "Clear filters";
        this.clearButton.addEventListener("click", () => this.clearFilters());
        this.searchInput = this.createElement("input", "mt-search", tools) as HTMLInputElement;
        this.searchInput.type = "search";
        this.searchInput.placeholder = "Search all columns…";
        this.searchInput.addEventListener("input", () => {
            this.searchText = this.searchInput.value.trim().toLowerCase();
            this.renderBody();
        });

        this.scroller = this.createElement("div", "mt-scroll", this.root);
        const table = this.createElement("table", "mt-table", this.scroller);
        const head = this.createElement("thead", "", table);
        this.headRow = this.createElement("tr", "mt-head", head) as HTMLTableRowElement;
        this.filterRow = this.createElement("tr", "mt-filters", head) as HTMLTableRowElement;
        this.body = this.createElement("tbody", "", table) as HTMLTableSectionElement;
        this.emptyState = this.createElement("div", "mt-empty", this.root);

        // Clicking outside a row clears the cross-filter selection.
        this.root.addEventListener("click", (event: MouseEvent) => {
            if (!(event.target as HTMLElement).closest("tbody tr, input, button, th")) {
                this.selectionManager.clear();
                this.selectedKeys.clear();
                this.renderBody();
            }
        });
        this.root.addEventListener("contextmenu", (event: MouseEvent) => {
            const rowElement = (event.target as HTMLElement).closest("tbody tr") as HTMLElement;
            const row = rowElement ? this.rows[Number(rowElement.dataset.row)] : undefined;
            this.selectionManager.showContextMenu(row ? row.selectionId : ({} as ISelectionId), { x: event.clientX, y: event.clientY });
            event.preventDefault();
        });
    }

    private applySettings(): void {
        const card = this.formattingSettings.tableCard;
        this.root.style.fontSize = `${card.fontSize.value}px`;
        this.titleElement.textContent = card.title.value;
        this.subtitleElement.textContent = card.subtitle.value;
        this.titleElement.parentElement.style.display = card.title.value ? "" : "none";
        this.subtitleElement.style.display = card.subtitle.value ? "" : "none";
        this.searchInput.style.display = card.showSearch.value ? "" : "none";
        this.filterRow.style.display = card.showFilters.value ? "" : "none";
    }

    private readData(table: DataViewTable | undefined): void {
        if (!table || !table.columns.length) {
            this.columns = [];
            this.rows = [];
            return;
        }
        this.columns = table.columns.map(column => ({
            name: column.displayName,
            kind: this.detectKind(column),
            format: column.format,
            control: "text" as FilterControl,
            options: []
        }));

        this.rows = table.rows.map((values, rowIndex) => {
            const display = values.map((value, columnIndex) => this.formatValue(value, this.columns[columnIndex]));
            return {
                values,
                display,
                searchText: display.join(" ").toLowerCase(),
                selectionId: this.host.createSelectionIdBuilder().withTable(table, rowIndex).createSelectionId()
            };
        });
        this.columns.forEach((column, index) => {
            column.options = this.distinctValues(index, column);
        });

        // Keep filters, sorting and the chosen controls while the user only changes slicers; reset them when the fields change.
        const signature = this.columns.map(column => column.name).join("|");
        if (signature !== this.columnSignature) {
            this.columnSignature = signature;
            this.columnFilters = this.columns.map(() => "");
            this.columnControls = this.columns.map(column => this.chooseControl(column));
            const card = this.formattingSettings.tableCard;
            const defaultSort = card.sortColumn.value.trim().toLowerCase();
            this.sortColumn = defaultSort ? this.columns.findIndex(column => column.name.toLowerCase() === defaultSort) : -1;
            this.sortDescending = card.sortDescending.value;
        }
        this.columns.forEach((column, index) => {
            column.control = this.columnControls[index];
            const filter = this.columnFilters[index];
            if ((column.control === "select" || column.control === "radio") && filter && !column.options.includes(filter)) {
                this.columnFilters[index] = "";
            }
        });
    }

    /**
     * Distinct non-empty display values of a column; flag columns are split into individual flags.
     */
    private distinctValues(index: number, column: TableColumn): string[] {
        const values = new Set<string>();
        this.rows.forEach(row => {
            const text = row.display[index];
            if (column.kind === "flags") {
                this.splitFlags(text).forEach(flag => values.add(flag));
            } else if (text) {
                values.add(text);
            }
        });
        return [...values].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    }

    /**
     * Radio buttons for Yes/No and a few short values, a dropdown for short lists, text boxes otherwise.
     */
    private chooseControl(column: TableColumn): FilterControl {
        if (column.kind === "number") {
            return "number";
        }
        if (column.kind === "bool") {
            return "radio";
        }
        if (column.kind !== "flags" && column.options.length <= MAX_RADIO_OPTIONS && column.options.every(option => option.length <= MAX_RADIO_LABEL)) {
            return "radio";
        }
        if (column.kind === "flags" || column.options.length <= MAX_SELECT_OPTIONS) {
            return "select";
        }
        return "text";
    }

    private splitFlags(text: string): string[] {
        return text.split(";").map(flag => flag.trim()).filter(flag => flag);
    }

    private detectKind(column: DataViewMetadataColumn): ColumnKind {
        const name = column.displayName.toLowerCase();
        if (column.type && column.type.numeric) {
            return "number";
        }
        if (column.type && column.type.dateTime) {
            return "date";
        }
        if (column.type && column.type.bool) {
            return "bool";
        }
        if (name.includes("status")) {
            return "status";
        }
        if (name.includes("flag")) {
            return "flags";
        }
        return "text";
    }

    private formatValue(value: PrimitiveValue, column: TableColumn): string {
        if (value === null || value === undefined || value === "") {
            return "";
        }
        if (column.kind === "number" && typeof value === "number") {
            return this.formatNumber(value, column.format);
        }
        if (column.kind === "date") {
            const date = value instanceof Date ? value : new Date(String(value));
            return isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        }
        if (column.kind === "bool") {
            return value ? "Yes" : "No";
        }
        return String(value);
    }

    private formatNumber(value: number, format: string | undefined): string {
        const pattern = format || "";
        const decimalsMatch = pattern.match(/\.(0+)/);
        const decimals = decimalsMatch ? decimalsMatch[1].length : (Number.isInteger(value) ? 0 : 2);
        // Unformatted whole numbers (years, counts from the model) stay plain: 2026, not 2,026.
        const useGrouping = pattern.includes(",") || (pattern === "" && !Number.isInteger(value));
        const options = { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping };
        if (pattern.includes("\"%\"")) {
            return `${value.toLocaleString("en-US", options)}%`;
        }
        if (pattern.includes("%")) {
            return `${(value * 100).toLocaleString("en-US", options)}%`;
        }
        return value.toLocaleString("en-US", options);
    }

    private renderHeader(): void {
        this.headRow.replaceChildren();
        this.filterRow.replaceChildren();
        this.columns.forEach((column, index) => {
            const th = this.createElement("th", this.alignClass(column), this.headRow);
            th.textContent = column.name.replace(/_/g, " ");
            if (index === this.sortColumn) {
                th.classList.add("mt-sorted");
                th.appendChild(document.createTextNode(this.sortDescending ? " ▼" : " ▲"));
            }
            th.title = "Click to sort";
            th.addEventListener("click", () => {
                this.sortDescending = this.sortColumn === index ? !this.sortDescending : column.kind === "number";
                this.sortColumn = index;
                this.renderHeader();
                this.renderBody();
            });

            const filterCell = this.createElement("th", "", this.filterRow);
            if (column.control === "select") {
                this.renderSelectFilter(filterCell, column, index);
            } else if (column.control === "radio") {
                this.renderRadioFilter(filterCell, column, index);
            } else {
                this.renderTextFilter(filterCell, column, index);
            }
        });
    }

    private renderTextFilter(cell: HTMLElement, column: TableColumn, index: number): void {
        const input = this.createElement("input", "mt-filter", cell) as HTMLInputElement;
        input.type = "text";
        input.value = this.columnFilters[index] || "";
        input.placeholder = column.control === "number" ? ">0, <100, =3" : "Contains…";
        input.classList.toggle("mt-active", input.value.trim() !== "");
        input.addEventListener("input", () => {
            this.columnFilters[index] = input.value;
            input.classList.toggle("mt-active", input.value.trim() !== "");
            this.renderBody();
        });
    }

    private renderSelectFilter(cell: HTMLElement, column: TableColumn, index: number): void {
        const select = this.createElement("select", "mt-filter mt-select", cell) as HTMLSelectElement;
        ["", ...column.options].forEach(option => {
            const element = this.createElement("option", "", select) as HTMLOptionElement;
            element.value = option;
            element.textContent = option === "" ? "All" : (column.kind === "flags" ? option.replace(/_/g, " ") : option);
        });
        select.value = this.columnFilters[index] || "";
        select.classList.toggle("mt-active", select.value !== "");
        select.addEventListener("change", () => {
            this.columnFilters[index] = select.value;
            select.classList.toggle("mt-active", select.value !== "");
            this.renderBody();
        });
    }

    private renderRadioFilter(cell: HTMLElement, column: TableColumn, index: number): void {
        const group = this.createElement("div", "mt-radios", cell);
        group.setAttribute("role", "radiogroup");
        ["", ...column.options].forEach(option => {
            const label = this.createElement("label", "mt-radio", group);
            const input = this.createElement("input", "", label) as HTMLInputElement;
            input.type = "radio";
            input.name = `mt-radio-${index}`;
            input.value = option;
            input.checked = (this.columnFilters[index] || "") === option;
            this.createElement("span", "", label).textContent = option === "" ? "All" : option;
            input.addEventListener("change", () => {
                this.columnFilters[index] = option;
                this.renderBody();
            });
        });
    }

    private renderBody(): void {
        if (!this.body) {
            return;
        }
        this.body.replaceChildren();
        const hasData = this.columns.length > 0;
        this.emptyState.textContent = hasData ? "No rows match the current filters." : "Add fields to Columns.";

        const visible = this.sortedRows(this.rows.filter(row => this.matches(row)));
        const anySelected = this.selectedKeys.size > 0;
        visible.forEach(row => {
            const tr = this.createElement("tr", "", this.body) as HTMLTableRowElement;
            tr.dataset.row = String(this.rows.indexOf(row));
            const isSelected = this.selectedKeys.has(row.selectionId.getKey());
            if (anySelected) {
                tr.classList.add(isSelected ? "mt-selected" : "mt-dimmed");
            }
            row.display.forEach((text, columnIndex) => this.renderCell(tr, text, row.values[columnIndex], this.columns[columnIndex]));
            tr.addEventListener("click", (event: MouseEvent) => {
                const multiSelect = event.ctrlKey || event.metaKey;
                this.selectionManager.select(row.selectionId, multiSelect).then((ids: ISelectionId[]) => {
                    this.selectedKeys = new Set(ids.map(id => id.getKey()));
                    this.renderBody();
                });
            });
        });

        const filtered = this.columnFilters.some(filter => filter.trim()) || this.searchText !== "";
        this.countElement.textContent = filtered ? `${visible.length} of ${this.rows.length} rows` : `${this.rows.length} rows`;
        this.clearButton.style.display = filtered ? "" : "none";
        this.emptyState.style.display = visible.length ? "none" : "";
    }

    private renderCell(tr: HTMLTableRowElement, text: string, value: PrimitiveValue, column: TableColumn): void {
        const td = this.createElement("td", this.alignClass(column), tr);
        if (text === "") {
            this.createElement("span", "mt-missing", td).textContent = "—";
            return;
        }
        if (column.kind === "status") {
            const pill = this.createElement("span", "mt-pill", td);
            const color = STATUS_COLORS[text.toLowerCase()] || "#A5B4FC";
            pill.style.color = color;
            pill.style.borderColor = color;
            pill.textContent = text;
            return;
        }
        if (column.kind === "flags") {
            this.splitFlags(text).forEach(flag => {
                this.createElement("span", "mt-chip", td).textContent = flag.replace(/_/g, " ");
            });
            return;
        }
        if (column.kind === "bool" && column.name.toLowerCase().includes("unknown")) {
            if (value) {
                this.createElement("span", "mt-unknown", td).textContent = "UNKNOWN";
            } else {
                this.createElement("span", "mt-missing", td).textContent = "—";
            }
            return;
        }
        td.textContent = text;
        if (column.kind === "number" && typeof value === "number" && value < 0) {
            td.classList.add("mt-negative");
        }
    }

    private matches(row: TableRow): boolean {
        if (this.searchText && !row.searchText.includes(this.searchText)) {
            return false;
        }
        return this.columnFilters.every((filter, index) => {
            const term = filter.trim();
            if (!term) {
                return true;
            }
            const column = this.columns[index];
            const value = row.values[index];
            const text = row.display[index];
            if (column.control === "select" || column.control === "radio") {
                return column.kind === "flags" ? this.splitFlags(text).includes(term) : text === term;
            }
            if (column.control === "number") {
                const condition = this.parseNumericCondition(term);
                if (condition) {
                    return typeof value === "number" && this.compare(value, condition);
                }
            }
            return text.toLowerCase().includes(term.toLowerCase());
        });
    }

    private parseNumericCondition(term: string): NumericCondition | undefined {
        const match = term.replace(/,/g, "").match(/^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/);
        return match ? { operator: match[1] as NumericCondition["operator"], value: Number(match[2]) } : undefined;
    }

    private compare(value: number, condition: NumericCondition): boolean {
        switch (condition.operator) {
            case ">": return value > condition.value;
            case ">=": return value >= condition.value;
            case "<": return value < condition.value;
            case "<=": return value <= condition.value;
            default: return Math.abs(value - condition.value) < 0.005;
        }
    }

    private sortedRows(rows: TableRow[]): TableRow[] {
        if (this.sortColumn < 0) {
            return rows;
        }
        const index = this.sortColumn;
        const direction = this.sortDescending ? -1 : 1;
        return [...rows].sort((a, b) => {
            const left = a.values[index];
            const right = b.values[index];
            if (left === null || left === undefined) {
                return 1;
            }
            if (right === null || right === undefined) {
                return -1;
            }
            if (typeof left === "number" && typeof right === "number") {
                return (left - right) * direction;
            }
            return String(left).localeCompare(String(right), "en", { numeric: true }) * direction;
        });
    }

    private clearFilters(): void {
        this.columnFilters = this.columns.map(() => "");
        this.searchText = "";
        this.searchInput.value = "";
        this.renderHeader();
        this.renderBody();
    }

    private alignClass(column: TableColumn): string {
        return column.kind === "number" ? "mt-right" : "";
    }

    private createElement(tag: string, className: string, parent: HTMLElement): HTMLElement {
        const element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        parent.appendChild(element);
        return element;
    }
}
