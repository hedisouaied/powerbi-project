"use strict";

/**
 * Neon glass design shared by the report visuals: ECharts setup, glass tooltips, gradients and Lucide icons.
 * Only the chart types and icons used are imported, to keep the visuals small.
 */

import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, MarkPointComponent, TooltipComponent } from "echarts/components";
import { LabelLayout } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";
import {
    Ban, Banknote, Boxes, CalendarDays, CalendarRange, ChartBar, ChartColumn, ChartPie, ChartScatter, Check, CircleSlash, Clock, createElement, CreditCard, Download,
    FileSpreadsheet, IconNode, Layers, ListChecks, Mail, Package, PackageSearch, Percent, Receipt, Scale, ShoppingCart, Store, Tag, TrendingUp, TriangleAlert, Trophy, Users, X
} from "lucide";

echarts.use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, MarkLineComponent, MarkPointComponent, TooltipComponent, LabelLayout, CanvasRenderer]);

export const NEON = {
    cyan: "#22D3EE",
    blue: "#3B82F6",
    violet: "#A855F7",
    magenta: "#E879F9",
    pink: "#F472B6",
    orange: "#FB923C",
    green: "#34D399",
    text: "#EEF2FF",
    soft: "#C7D2FE",
    muted: "#8B93B8",
    line: "rgba(148, 163, 255, 0.14)"
};

const FONT = "'Segoe UI', Arial, sans-serif";

export const ICONS: Record<string, IconNode> = {
    Ban, Banknote, Boxes, CalendarDays, CalendarRange, ChartBar, ChartColumn, ChartPie, ChartScatter, Check, CircleSlash, Clock, CreditCard, Download,
    FileSpreadsheet, Layers, ListChecks, Mail, Package, PackageSearch, Percent, Receipt, Scale, ShoppingCart, Store, Tag, TrendingUp, TriangleAlert, Trophy, Users, X
};

export function icon(name: keyof typeof ICONS, size = 18): SVGElement {
    const element = createElement(ICONS[name]);
    element.setAttribute("width", String(size));
    element.setAttribute("height", String(size));
    return element;
}

export function linear(from: string, to: string, horizontal = false): echarts.graphic.LinearGradient {
    return new echarts.graphic.LinearGradient(0, 0, horizontal ? 1 : 0, horizontal ? 0 : 1, [{ offset: 0, color: from }, { offset: 1, color: to }]);
}

export function radial(light: string, mid: string, dark: string): echarts.graphic.RadialGradient {
    return new echarts.graphic.RadialGradient(0.35, 0.35, 0.8, [{ offset: 0, color: light }, { offset: 0.6, color: mid }, { offset: 1, color: dark }]);
}

const escapeHtml = (value: string): string => value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface TooltipRow {
    label: string;
    value: string;
    color?: string;
}

/**
 * Tooltip body: a title, then label and value rows. All text is escaped here, so callers pass plain strings.
 */
export function tooltipHtml(title: string, rows: TooltipRow[], footer?: string): string {
    const body = rows.map(row => {
        const dot = row.color ? `<span style="display:inline-block;width:9px;height:9px;margin-right:8px;border-radius:50%;background:${row.color};box-shadow:0 0 8px ${row.color}"></span>` : "";
        return `<div style="display:flex;justify-content:space-between;gap:28px;margin-top:6px"><span style="color:${NEON.muted}">${dot}${escapeHtml(row.label)}</span><span style="font-weight:700;color:${NEON.text}">${escapeHtml(row.value)}</span></div>`;
    }).join("");
    const end = footer ? `<div style="margin-top:9px;padding-top:7px;border-top:1px solid ${NEON.line};font-size:12px;color:${NEON.cyan}">${escapeHtml(footer)}</div>` : "";
    return `<div style="font-weight:700;font-size:15px;color:${NEON.text}">${escapeHtml(title)}</div>${body}${end}`;
}

export function glassTooltip(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        confine: true,
        backgroundColor: "rgba(15, 20, 48, 0.88)",
        borderColor: "rgba(34, 211, 238, 0.55)",
        borderWidth: 1,
        padding: [11, 15],
        textStyle: { color: NEON.text, fontFamily: FONT, fontSize: 14 },
        extraCssText: "border-radius:14px;backdrop-filter:blur(12px);box-shadow:0 12px 34px rgba(0,0,0,0.5),0 0 24px rgba(34,211,238,0.22);",
        ...extra
    };
}

export function axisStyle(): Record<string, unknown> {
    return {
        axisLine: { lineStyle: { color: NEON.line } },
        axisTick: { show: false },
        axisLabel: { color: NEON.muted, fontFamily: FONT, fontSize: 13 },
        splitLine: { lineStyle: { color: NEON.line, type: "dashed" } }
    };
}

/**
 * Owns the charts of a render, so they can be disposed before the page is rebuilt.
 */
export class ChartHost {
    private charts: echarts.ECharts[] = [];
    private pending: Array<() => void> = [];

    /**
     * Creates the chart at the next flush: a chart takes its size when created, so the page must be fully laid out first.
     */
    public queue(element: HTMLElement, option: Record<string, unknown>, onClick?: (params: { dataIndex: number; name: string }) => void): void {
        this.pending.push(() => this.create(element, option, onClick));
    }

    public flush(): void {
        const pending = this.pending;
        this.pending = [];
        pending.forEach(create => create());
    }

    public create(element: HTMLElement, option: Record<string, unknown>, onClick?: (params: { dataIndex: number; name: string }) => void): echarts.ECharts {
        const chart = echarts.init(element, undefined, { devicePixelRatio: 2 });
        chart.setOption({ animationDuration: 900, animationEasing: "cubicOut", textStyle: { fontFamily: FONT }, ...option });
        if (onClick) {
            chart.on("click", params => onClick(params as unknown as { dataIndex: number; name: string }));
        }
        this.charts.push(chart);
        return chart;
    }

    public disposeAll(): void {
        this.pending = [];
        this.charts.forEach(chart => chart.dispose());
        this.charts = [];
    }
}
