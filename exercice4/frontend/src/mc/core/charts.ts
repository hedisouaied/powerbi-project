"use strict";

/**
 * Chart wrappers on ECharts (tree-shaken: only the chart types used are bundled).
 * Every chart reads the current design tokens, so dark/light/accent changes restyle all charts.
 * Charts are created after the page is in the DOM (queue + flush) and disposed on every re-render.
 */

import * as echarts from "echarts/core";
import { BarChart, CustomChart, GaugeChart, LineChart, PieChart, RadarChart, ScatterChart } from "echarts/charts";
import { DataZoomComponent, GraphicComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, RadarComponent, TooltipComponent } from "echarts/components";
import { LabelLayout } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";
import { palette, Tokens } from "./theme";

echarts.use([BarChart, CustomChart, GaugeChart, LineChart, PieChart, RadarChart, ScatterChart, DataZoomComponent, GraphicComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, RadarComponent, TooltipComponent, LabelLayout, CanvasRenderer]);

export type Click = (p: { dataIndex: number; name: string; seriesName?: string; value?: any }) => void;

export class Charts {
    private list: echarts.ECharts[] = [];
    private pending: Array<() => void> = [];
    public t: Tokens;
    public reduced = false;

    public queue(el: HTMLElement, option: Record<string, any>, onClick?: Click): void { this.pending.push(() => this.create(el, option, onClick)); }
    public flush(): void { const p = this.pending; this.pending = []; p.forEach(f => f()); }
    public dispose(): void { this.pending = []; this.list.forEach(c => c.dispose()); this.list = []; }

    private create(el: HTMLElement, option: Record<string, any>, onClick?: Click): void {
        if (!el.isConnected || !el.clientWidth) { return; }
        const c = echarts.init(el, undefined, { devicePixelRatio: 2 });
        c.setOption({ animation: !this.reduced, animationDuration: 800, animationEasing: "cubicOut", color: palette(this.t), textStyle: { fontFamily: "'Segoe UI', 'Inter', Arial, sans-serif", color: this.t.soft }, ...option });
        if (onClick) { c.on("click", p => onClick(p as any)); }
        this.list.push(c);
    }

    // ---------- common pieces
    public tooltip(extra: Record<string, any> = {}): Record<string, any> {
        return { confine: true, backgroundColor: this.t.glass, borderColor: this.t.accent, borderWidth: 1, padding: [8, 11], textStyle: { color: this.t.text, fontSize: 12 }, extraCssText: `border-radius:10px;backdrop-filter:blur(10px);box-shadow:${this.t.shadow};`, ...extra };
    }
    public axis(extra: Record<string, any> = {}): Record<string, any> {
        return { axisLine: { lineStyle: { color: this.t.line2 } }, axisTick: { show: false }, axisLabel: { color: this.t.muted, fontSize: 10 }, splitLine: { lineStyle: { color: this.t.grid, type: "dashed" } }, ...extra };
    }
    public grad(color: string, top = 0.35): echarts.graphic.LinearGradient {
        return new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: this.alpha(color, top) }, { offset: 1, color: this.alpha(color, 0) }]);
    }
    public alpha(hex: string, a: number): string {
        if (!hex.startsWith("#")) { return hex; }
        const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
    public short(v: number): string { const a = Math.abs(v); return a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(Math.round(v)); }

    // ---------- chart types
    public line(el: HTMLElement, cats: string[], series: Array<{ name: string; data: Array<number | null>; color?: string; area?: boolean; dashed?: boolean; band?: [number[], number[]] }>, onClick?: Click, yFmt?: (v: number) => string): void {
        const s: any[] = [];
        series.forEach((x, i) => {
            const color = x.color ?? palette(this.t)[i];
            if (x.band) {
                s.push({ name: `${x.name} low`, type: "line", data: x.band[0], lineStyle: { opacity: 0 }, stack: `band${i}`, symbol: "none", silent: true, tooltip: { show: false } });
                s.push({ name: `${x.name} band`, type: "line", data: x.band[1].map((hi, k) => hi - x.band![0][k]), lineStyle: { opacity: 0 }, areaStyle: { color: this.alpha(color, 0.15) }, stack: `band${i}`, symbol: "none", silent: true, tooltip: { show: false } });
            }
            s.push({ name: x.name, type: "line", smooth: true, symbol: "circle", symbolSize: 5, showSymbol: false, data: x.data, lineStyle: { width: 2.5, color, type: x.dashed ? "dashed" : "solid", shadowBlur: 8, shadowColor: this.alpha(color, 0.5) }, itemStyle: { color }, areaStyle: x.area === false ? undefined : { color: this.grad(color) } });
        });
        this.queue(el, {
            grid: { left: 6, right: 12, top: 26, bottom: 4, containLabel: true },
            legend: { top: 0, right: 0, textStyle: { color: this.t.soft, fontSize: 10 }, itemWidth: 12, itemHeight: 7, data: series.map(x => x.name) },
            tooltip: this.tooltip({ trigger: "axis", valueFormatter: (v: number) => (v === null || v === undefined ? "—" : yFmt ? yFmt(v) : this.short(v)) }),
            xAxis: { type: "category", data: cats, boundaryGap: false, ...this.axis() }, yAxis: { type: "value", ...this.axis({ axisLabel: { color: this.t.muted, fontSize: 10, formatter: (v: number) => (yFmt ? yFmt(v) : this.short(v)) } }) },
            series: s
        }, onClick);
    }
    public bars(el: HTMLElement, rows: Array<{ name: string; value: number; color?: string }>, opts: { horizontal?: boolean; fmt?: (v: number) => string; onClick?: Click; selected?: string } = {}): void {
        const data = rows.map(r => ({ value: r.value, itemStyle: { color: r.color ?? this.t.accent, opacity: opts.selected && opts.selected !== r.name ? 0.35 : 1, borderRadius: opts.horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0] } }));
        const cat = { type: "category", data: rows.map(r => r.name), ...this.axis({ axisLabel: { color: this.t.soft, fontSize: 10, width: 110, overflow: "truncate" } }) };
        const val = { type: "value", ...this.axis({ axisLabel: { show: !opts.horizontal, color: this.t.muted, fontSize: 10, formatter: (v: number) => this.short(v) } }), splitLine: { show: !opts.horizontal, lineStyle: { color: this.t.grid, type: "dashed" } } };
        this.queue(el, {
            grid: { left: 6, right: opts.horizontal ? 56 : 8, top: 8, bottom: 4, containLabel: true },
            tooltip: this.tooltip({ trigger: "item", valueFormatter: (v: number) => (opts.fmt ? opts.fmt(v) : this.short(v)) }),
            xAxis: opts.horizontal ? val : cat, yAxis: opts.horizontal ? { ...cat, inverse: true } : val,
            series: [{ type: "bar", barMaxWidth: 16, data, cursor: opts.onClick ? "pointer" : "default", label: { show: !!opts.horizontal, position: "right", color: this.t.text, fontSize: 10, formatter: (p: any) => (opts.fmt ? opts.fmt(p.value) : this.short(p.value)) } }]
        }, opts.onClick);
    }
    public stacked(el: HTMLElement, cats: string[], series: Array<{ name: string; data: number[]; color?: string }>, fmtV?: (v: number) => string): void {
        this.queue(el, {
            grid: { left: 6, right: 8, top: 26, bottom: 4, containLabel: true },
            legend: { top: 0, right: 0, textStyle: { color: this.t.soft, fontSize: 10 }, itemWidth: 10, itemHeight: 7 },
            tooltip: this.tooltip({ trigger: "axis", valueFormatter: (v: number) => (fmtV ? fmtV(v) : this.short(v)) }),
            xAxis: { type: "category", data: cats, ...this.axis() }, yAxis: { type: "value", ...this.axis({ axisLabel: { color: this.t.muted, fontSize: 10, formatter: (v: number) => this.short(v) } }) },
            series: series.map(x => ({ name: x.name, type: "bar", stack: "s", barMaxWidth: 20, data: x.data, itemStyle: { color: x.color, borderRadius: 2 } }))
        });
    }
    public donut(el: HTMLElement, items: Array<{ name: string; value: number; color?: string }>, onClick?: Click, fmtV?: (v: number) => string): void {
        this.queue(el, {
            tooltip: this.tooltip({ trigger: "item", valueFormatter: (v: number) => (fmtV ? fmtV(v) : this.short(v)) }),
            legend: { orient: "vertical", right: 0, top: "middle", textStyle: { color: this.t.soft, fontSize: 10 }, itemWidth: 8, itemHeight: 8, icon: "circle" },
            series: [{ type: "pie", radius: ["58%", "80%"], center: ["34%", "52%"], padAngle: 2, itemStyle: { borderRadius: 5 }, label: { show: false }, cursor: onClick ? "pointer" : "default", data: items.map(i => ({ name: i.name, value: i.value, itemStyle: i.color ? { color: i.color } : undefined })) }]
        }, onClick);
    }
    public radar(el: HTMLElement, indicators: Array<{ name: string; max: number }>, series: Array<{ name: string; values: number[]; color?: string }>, onClick?: Click): void {
        this.queue(el, {
            tooltip: this.tooltip({ trigger: "item" }),
            legend: series.length > 1 ? { bottom: 0, textStyle: { color: this.t.soft, fontSize: 10 }, itemWidth: 10, itemHeight: 7 } : undefined,
            radar: { indicator: indicators, radius: "66%", center: ["50%", series.length > 1 ? "46%" : "52%"], splitNumber: 4, axisName: { color: this.t.soft, fontSize: 10 }, splitLine: { lineStyle: { color: this.t.line2 } }, splitArea: { areaStyle: { color: ["transparent"] } }, axisLine: { lineStyle: { color: this.t.line } } },
            series: [{ type: "radar", symbolSize: 5, data: series.map((x, i) => { const c = x.color ?? palette(this.t)[i]; return { name: x.name, value: x.values, lineStyle: { color: c, width: 2 }, itemStyle: { color: c }, areaStyle: { color: this.alpha(c, 0.25) } }; }) }]
        }, onClick);
    }
    public scatter(el: HTMLElement, points: Array<{ name: string; x: number; y: number; size: number; color?: string }>, xName: string, yName: string, onClick?: Click): void {
        const max = Math.max(1, ...points.map(p => p.size));
        this.queue(el, {
            grid: { left: 8, right: 16, top: 16, bottom: 22, containLabel: true },
            tooltip: this.tooltip({ trigger: "item", formatter: (p: any) => { const q = points[p.dataIndex]; return `${q.name}<br/>${xName}: ${this.short(q.x)}<br/>${yName}: ${this.short(q.y)}`; } }),
            xAxis: { type: "value", name: xName, nameLocation: "middle", nameGap: 22, nameTextStyle: { color: this.t.muted, fontSize: 10 }, scale: true, ...this.axis({ axisLabel: { color: this.t.muted, fontSize: 10, formatter: (v: number) => this.short(v) } }) },
            yAxis: { type: "value", name: yName, nameTextStyle: { color: this.t.muted, fontSize: 10 }, scale: true, ...this.axis({ axisLabel: { color: this.t.muted, fontSize: 10, formatter: (v: number) => this.short(v) } }) },
            series: [{ type: "scatter", data: points.map(p => ({ value: [p.x, p.y], itemStyle: { color: p.color ?? this.t.accent, opacity: 0.85 } })), symbolSize: (_: any, p: any) => 8 + 22 * (points[p.dataIndex].size / max), cursor: onClick ? "pointer" : "default" }]
        }, onClick);
    }
    /** Waterfall / bridge: first and last bars are totals. */
    public waterfall(el: HTMLElement, steps: Array<{ name: string; value: number; total?: boolean }>, fmtV: (v: number) => string): void {
        let run = 0; const base: number[] = [], up: Array<number | string> = [], down: Array<number | string> = [];
        steps.forEach(st => {
            if (st.total) { base.push(0); up.push(st.value >= 0 ? st.value : "-"); down.push(st.value < 0 ? -st.value : "-"); run = st.value; return; }
            const next = run + st.value; base.push(Math.min(run, next)); up.push(st.value >= 0 ? st.value : "-"); down.push(st.value < 0 ? -st.value : "-"); run = next;
        });
        this.queue(el, {
            grid: { left: 6, right: 8, top: 12, bottom: 4, containLabel: true },
            tooltip: this.tooltip({ trigger: "axis", formatter: (ps: any[]) => { const i = ps[0].dataIndex; return `${steps[i].name}<br/>${fmtV(steps[i].value)}`; } }),
            xAxis: { type: "category", data: steps.map(st => st.name), ...this.axis({ axisLabel: { color: this.t.soft, fontSize: 9, interval: 0, rotate: steps.length > 6 ? 25 : 0 } }) },
            yAxis: { type: "value", ...this.axis({ axisLabel: { color: this.t.muted, fontSize: 10, formatter: (v: number) => this.short(v) } }) },
            series: [
                { type: "bar", stack: "w", data: base, itemStyle: { color: "transparent" }, silent: true },
                { type: "bar", stack: "w", data: up, barMaxWidth: 28, itemStyle: { color: this.t.good, borderRadius: 3 } },
                { type: "bar", stack: "w", data: down, barMaxWidth: 28, itemStyle: { color: this.t.bad, borderRadius: 3 } }
            ]
        });
    }
    public gaugeChart(el: HTMLElement, value: number, max: number, label: string): void {
        this.queue(el, {
            series: [{ type: "gauge", startAngle: 210, endAngle: -30, min: 0, max, radius: "92%", progress: { show: true, width: 10, roundCap: true, itemStyle: { color: this.t.accent } }, axisLine: { lineStyle: { width: 10, color: [[1, this.t.panel3]] } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false }, anchor: { show: false }, title: { show: true, offsetCenter: [0, "38%"], color: this.t.muted, fontSize: 11 }, detail: { valueAnimation: !this.reduced, offsetCenter: [0, "-2%"], fontSize: 24, fontWeight: 700, color: this.t.text, formatter: (v: number) => `${Math.round(v)}` }, data: [{ value, name: label }] }]
        });
    }
}
