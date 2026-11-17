"use strict";

/**
 * Neon glass design for the BOI 360 visual: ECharts setup, glass tooltips, gradients and Lucide icons.
 * Only the chart types and icons used are imported, to keep the visual small.
 */

import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { GraphicComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { LabelLayout } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";
import {
    AlarmClock, Ban, Banknote, Briefcase, Building, CalendarRange, ChartBar, ChartPie, Check, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardList, Clock, createElement,
    FolderKanban, Gauge, Hourglass, IconNode, Info, Landmark, Layers, ListChecks, MapPin, Package, Pencil, Percent, Plane, Plus, Receipt, RotateCcw,
    Save, Scale, ScrollText, Search, ShieldAlert, ShoppingCart, Tag, Target, Trash, TrendingUp, TriangleAlert, Trophy, UserCheck, Users, Wallet, X
} from "lucide";

echarts.use([BarChart, LineChart, PieChart, ScatterChart, GraphicComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, LabelLayout, CanvasRenderer]);

/**
 * Command-center palette (dark + yellow/gold). Key names are kept from the earlier neon theme so every chart
 * picks up the new colours: cyan = primary yellow, violet = platinum (secondary series), blue = steel.
 */
export const NEON = {
    cyan: "#FFD43B",
    blue: "#7F8EA3",
    violet: "#C9D1DC",
    magenta: "#FFF0A3",
    gold: "#F5B82E",
    pink: "#FF5C64",
    orange: "#FFB84D",
    amber: "#FFB84D",
    green: "#35D39A",
    text: "#F5F7FA",
    soft: "#A4ADBA",
    muted: "#687383",
    line: "rgba(255, 212, 59, 0.10)"
};

export const SERIES = ["#FFD43B", "#C9D1DC", "#F5B82E", "#7F8EA3", "#FFF0A3", "#35D39A", "#FFB84D", "#FF5C64"];

const FONT = "'Segoe UI', Arial, sans-serif";

export const ICONS: Record<string, IconNode> = {
    AlarmClock, Ban, Banknote, Briefcase, Building, CalendarRange, ChartBar, ChartPie, Check, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardList, Clock,
    FolderKanban, Gauge, Hourglass, Info, Landmark, Layers, ListChecks, MapPin, Package, Pencil, Percent, Plane, Plus, Receipt, RotateCcw,
    Save, Scale, ScrollText, Search, ShieldAlert, ShoppingCart, Tag, Target, Trash, TrendingUp, TriangleAlert, Trophy, UserCheck, Users, Wallet, X
};
export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16): SVGElement {
    const element = createElement(ICONS[name]);
    element.setAttribute("width", String(size));
    element.setAttribute("height", String(size));
    return element;
}

export function linear(from: string, to: string, horizontal = false): echarts.graphic.LinearGradient {
    return new echarts.graphic.LinearGradient(0, 0, horizontal ? 1 : 0, horizontal ? 0 : 1, [{ offset: 0, color: from }, { offset: 1, color: to }]);
}

export const escapeHtml = (value: string): string => value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface TooltipRow {
    label: string;
    value: string;
    color?: string;
}

/** Tooltip body: a title, then label and value rows. All text is escaped here. */
export function tooltipHtml(title: string, rows: TooltipRow[], footer?: string): string {
    const body = rows.map(row => {
        const dot = row.color ? `<span style="display:inline-block;width:8px;height:8px;margin-right:7px;border-radius:50%;background:${row.color};box-shadow:0 0 8px ${row.color}"></span>` : "";
        return `<div style="display:flex;justify-content:space-between;gap:22px;margin-top:5px"><span style="color:${NEON.muted}">${dot}${escapeHtml(row.label)}</span><span style="font-weight:700;color:${NEON.text}">${escapeHtml(row.value)}</span></div>`;
    }).join("");
    const end = footer ? `<div style="margin-top:8px;padding-top:6px;border-top:1px solid ${NEON.line};font-size:11px;color:${NEON.cyan}">${escapeHtml(footer)}</div>` : "";
    return `<div style="font-weight:700;font-size:13px;color:${NEON.text}">${escapeHtml(title)}</div>${body}${end}`;
}

export function glassTooltip(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        confine: true,
        backgroundColor: "rgba(17, 21, 28, 0.95)",
        borderColor: "rgba(255, 212, 59, 0.55)",
        borderWidth: 1,
        padding: [9, 12],
        textStyle: { color: NEON.text, fontFamily: FONT, fontSize: 12 },
        extraCssText: "border-radius:12px;backdrop-filter:blur(12px);box-shadow:0 14px 34px rgba(0,0,0,0.6),0 0 22px rgba(255,212,59,0.18);",
        ...extra
    };
}

export function axisStyle(): Record<string, unknown> {
    return {
        axisLine: { lineStyle: { color: NEON.line } },
        axisTick: { show: false },
        axisLabel: { color: NEON.muted, fontFamily: FONT, fontSize: 10 },
        splitLine: { lineStyle: { color: NEON.line, type: "dashed" } }
    };
}

export type ChartClick = (params: { dataIndex: number; name: string; seriesName?: string }) => void;

/** Owns the charts of a render, so they can be disposed before the page is rebuilt. */
export class ChartHost {
    private charts: echarts.ECharts[] = [];
    private pending: Array<() => void> = [];

    /** Creates the chart at the next flush: a chart takes its size when created, so the page must be laid out first. */
    public queue(element: HTMLElement, option: Record<string, unknown>, onClick?: ChartClick): void {
        this.pending.push(() => this.create(element, option, onClick));
    }

    public flush(): void {
        const pending = this.pending;
        this.pending = [];
        pending.forEach(create => create());
    }

    private create(element: HTMLElement, option: Record<string, unknown>, onClick?: ChartClick): void {
        const chart = echarts.init(element, undefined, { devicePixelRatio: 2 });
        chart.setOption({ animationDuration: 1100, animationEasing: "cubicOut", animationDelay: (i: number) => i * 40, textStyle: { fontFamily: FONT }, ...option });
        if (onClick) {
            chart.on("click", params => onClick(params as unknown as { dataIndex: number; name: string; seriesName?: string }));
        }
        this.charts.push(chart);
    }

    public disposeAll(): void {
        this.pending = [];
        this.charts.forEach(chart => chart.dispose());
        this.charts = [];
    }
}
