"use strict";

/**
 * The Sales Overview page as an HTML email. Mail clients drop flexbox, grid and most modern CSS, so the
 * design is rebuilt with tables, inline styles and bgcolor fallbacks. Values are escaped before insertion.
 */

export interface EmailModel {
    eyebrow: string;
    title: string;
    rangeLabel: string;
    meta: string;
    filters: Array<{ label: string; value: string }>;
    totals: { gross: number; net: number; units: number; orders: number; lines: number };
    months: Array<{ label: string; net: number; orders: number }>;
    statuses: Array<{ status: string; gross: number; color: string }>;
    stores: Array<{ store: string; net: number; unknown: boolean }>;
    products: Array<{ product: string; category: string; units: number; gross: number; net: number }>;
    donutCid: string | undefined;
    generatedAt: string;
}

const FONT = "'Segoe UI',Arial,Helvetica,sans-serif";
const PAGE = "#060818";
const CARD = "#141836";
const BORDER = "#2A3168";
const ACCENT = "#22D3EE";
const TEXT = "#EEF2FF";
const SOFT = "#C7D2FE";
const MUTED = "#8B93B8";
const FAINT = "#646C92";
const ROSE = "#F472B6";
const MINT = "#34D399";
const LINE = "#1E2450";
const TRACK = "#1C2148";
const KPI_COLORS = ["#22D3EE", "#E879F9", "#3B82F6", "#A855F7"];

const escapeHtml = (value: string): string => value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const money = (value: number): string => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (value: number): string => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
const pct = (value: number): string => `${(value * 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const table = (inner: string, attributes = ""): string =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0" ${attributes}>${inner}</table>`;
const gap = (height: number): string => `<tr><td height="${height}" style="height:${height}px;font-size:0;line-height:0">&nbsp;</td></tr>`;

function card(title: string, subtitle: string, inner: string, aside = ""): string {
    const head = `<tr><td style="font-family:${FONT};font-size:16px;font-weight:700;color:${TEXT}">${escapeHtml(title)}<div style="margin-top:2px;font-size:12px;font-weight:400;color:${MUTED}">${escapeHtml(subtitle)}</div></td>${aside}</tr>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="background-color:${CARD};border:1px solid ${BORDER};border-radius:14px"><tr><td style="padding:18px 20px">${table(head)}${inner}</td></tr></table>`;
}

function bar(share: number, color: string, height: number): string {
    const width = Math.min(Math.max(Math.round(share * 100), 1), 100);
    const rest = width < 100 ? `<td style="font-size:0;line-height:0">&nbsp;</td>` : "";
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${TRACK}" style="background-color:${TRACK};border-radius:99px"><tr><td width="${width}%" height="${height}" bgcolor="${color}" style="width:${width}%;height:${height}px;background-color:${color};border-radius:99px;font-size:0;line-height:0">&nbsp;</td>${rest}</tr></table>`;
}

function header(model: EmailModel): string {
    return table(`<tr>
<td valign="top" style="font-family:${FONT}"><div style="font-size:11px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:${ACCENT}">${escapeHtml(model.eyebrow)}</div><div style="margin-top:4px;font-size:30px;line-height:36px;font-weight:700;color:${TEXT}">${escapeHtml(model.title)}</div></td>
<td valign="top" align="right" style="font-family:${FONT}"><span style="display:inline-block;padding:6px 14px;border:1px solid #1F7A94;border-radius:99px;background-color:#0F2A3D;color:${ACCENT};font-size:12px;font-weight:600;white-space:nowrap">${escapeHtml(model.rangeLabel)}</span><div style="margin-top:6px;font-size:11px;color:${MUTED}">${escapeHtml(model.meta)}</div></td>
</tr>`);
}

function filters(model: EmailModel): string {
    const cells = model.filters.map(filter => {
        const active = !/^All /.test(filter.value);
        return `<td valign="top" style="padding:0 10px 0 0;font-family:${FONT}"><div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED}">${escapeHtml(filter.label)}</div><div style="margin-top:4px;font-size:13px;font-weight:600;color:${active ? ACCENT : SOFT}">${escapeHtml(filter.value)}</div></td>`;
    }).join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="background-color:${CARD};border:1px solid ${BORDER};border-radius:14px"><tr><td style="padding:14px 20px">${table(`<tr>${cells}</tr>`)}</td></tr></table>`;
}

function kpis(model: EmailModel): string {
    const { gross, net, orders, units, lines } = model.totals;
    const cards: Array<[string, string, string, string, boolean]> = [
        ["Net Revenue", money(net), "TND", `${pct(gross ? net / gross : 0)} of gross retained`, true],
        ["Gross Sales", money(gross), "TND", `${money(gross - net)} lost to cancels &amp; returns`, false],
        ["Orders", int(orders), "", `AOV ${money(orders ? net / orders : 0)} TND`, false],
        ["Units Sold", int(units), "units", `${int(lines)} order lines`, false]
    ];
    const cells = cards.map(([label, value, unit, note, highlight], index) => {
        const background = highlight ? "#132B4A" : "#141836";
        const color = KPI_COLORS[index];
        const gradient = highlight ? "background-image:linear-gradient(135deg,#1B3A5C 0%,#141836 75%);" : "";
        const space = index < cards.length - 1 ? `<td width="2%" style="width:2%;font-size:0;line-height:0">&nbsp;</td>` : "";
        return `<td width="23.5%" valign="top" bgcolor="${background}" style="width:23.5%;background-color:${background};${gradient}border:1px solid ${color};border-top:3px solid ${color};box-shadow:0 0 14px ${color}44;border-radius:12px;padding:12px 12px 12px;font-family:${FONT}"><div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#A5B4FC">${label}</div><div style="margin-top:6px;font-size:22px;line-height:28px;font-weight:700;color:${highlight ? ACCENT : TEXT};white-space:nowrap">${value}<span style="margin-left:4px;font-size:10px;font-weight:600;color:${MUTED}">${unit}</span></div><div style="margin-top:4px;font-size:11px;line-height:15px;color:${MUTED}">${note}</div></td>${space}`;
    }).join("");
    return table(`<tr>${cells}</tr>`);
}

function months(model: EmailModel): string {
    const total = model.months.reduce((sum, month) => sum + month.net, 0);
    const aside = `<td valign="top" align="right" style="font-family:${FONT}"><div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED}">Period total</div><div style="margin-top:2px;font-size:18px;font-weight:700;color:${ACCENT};white-space:nowrap">${money(total)} TND</div></td>`;
    if (!model.months.length) {
        return card("Net Revenue by Month", "Monthly net revenue", `<div style="padding:24px 0;text-align:center;font-family:${FONT};font-size:13px;color:${MUTED}">No sales match the filters.</div>`, aside);
    }
    const max = Math.max(...model.months.map(month => month.net), 0.0001);
    const width = Math.floor(100 / model.months.length);
    const bars = model.months.map(month => {
        const height = Math.max(Math.round((month.net / max) * 120), 4);
        return `<td width="${width}%" valign="bottom" align="center" height="160" style="height:160px;border-bottom:1px solid #2A3168;font-family:${FONT}"><div style="margin-bottom:6px;font-size:14px;font-weight:700;color:${TEXT}">${money(month.net)}</div><table role="presentation" width="56%" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td height="${height}" bgcolor="#3B82F6" style="height:${height}px;background-color:#3B82F6;background-image:linear-gradient(180deg,#22D3EE 0%,#3B82F6 55%,#A855F7 100%);border-radius:8px 8px 2px 2px;font-size:0;line-height:0">&nbsp;</td></tr></table></td>`;
    }).join("");
    const labels = model.months.map((month, index) => {
        const previous = index > 0 ? model.months[index - 1].net : 0;
        let chip = `<span style="font-size:11px;color:${FAINT}">baseline</span>`;
        if (previous) {
            const delta = (month.net - previous) / previous;
            const up = delta >= 0;
            chip = `<span style="display:inline-block;padding:2px 8px;border-radius:99px;background-color:${up ? "#0F2F2A" : "#33182C"};color:${up ? MINT : ROSE};font-size:11px;font-weight:600;white-space:nowrap">${up ? "&#9650;" : "&#9660;"} ${pct(Math.abs(delta))} MoM</span>`;
        }
        return `<td align="center" valign="top" style="padding-top:8px;font-family:${FONT}"><div style="font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#A5B4FC">${escapeHtml(month.label)}</div><div style="margin-top:2px;font-size:11px;color:${FAINT}">${int(month.orders)} orders</div><div style="margin-top:6px">${chip}</div></td>`;
    }).join("");
    return card("Net Revenue by Month", "Monthly net revenue with month-over-month change", table(gap(4) + `<tr>${bars}</tr><tr>${labels}</tr>`), aside);
}

function statusMix(model: EmailModel): string {
    const gross = model.statuses.reduce((sum, status) => sum + status.gross, 0);
    if (!model.statuses.length || !gross) {
        return card("Order Status Mix", "Share of gross sales by status", `<div style="padding:24px 0;text-align:center;font-family:${FONT};font-size:13px;color:${MUTED}">No sales match the filters.</div>`);
    }
    const rows = model.statuses.map((status, index) => {
        const border = index < model.statuses.length - 1 ? `border-bottom:1px solid ${LINE};` : "";
        return `<tr><td width="14" style="padding:8px 0;${border}"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="10" height="10" bgcolor="${status.color}" style="width:10px;height:10px;background-color:${status.color};border-radius:3px;font-size:0;line-height:0">&nbsp;</td></tr></table></td><td style="padding:8px 6px;${border}font-family:${FONT};font-size:13px;color:${SOFT}">${escapeHtml(status.status)}</td><td align="right" style="padding:8px 8px;${border}font-family:${FONT};font-size:13px;font-weight:700;color:${TEXT};white-space:nowrap">${money(status.gross)}</td><td align="right" style="padding:8px 0;${border}font-family:${FONT};font-size:12px;color:${MUTED};white-space:nowrap">${pct(status.gross / gross)}</td></tr>`;
    }).join("");
    const donut = model.donutCid
        ? `<td width="190" valign="middle" style="width:190px;padding-right:20px"><img src="cid:${model.donutCid}" width="190" height="190" alt="Net kept ${pct(gross ? model.totals.net / gross : 0)}" style="display:block;width:190px;height:190px;border:0;font-family:${FONT};font-size:13px;color:${ACCENT}"/></td>`
        : "";
    return card("Order Status Mix", "Share of gross sales by status", table(gap(10) + `<tr>${donut}<td valign="middle">${table(rows)}</td></tr>`));
}

function stores(model: EmailModel): string {
    const max = Math.max(...model.stores.map(store => store.net), 0.0001);
    const total = model.stores.reduce((sum, store) => sum + store.net, 0);
    const rows = model.stores.map(store => {
        const badge = store.unknown ? ` <span style="padding:0 5px;border:1px solid ${ROSE};border-radius:3px;font-size:9px;letter-spacing:0.5px;color:${ROSE}">UNKNOWN</span>` : "";
        return `<tr><td width="210" style="width:210px;padding:7px 10px 7px 0;font-family:${FONT};font-size:13px;color:${store.unknown ? MUTED : SOFT}">${escapeHtml(store.store)}${badge}</td><td style="padding:7px 0">${bar(store.net / max, store.unknown ? "#F472B6" : "#22D3EE", 10)}</td><td width="80" align="right" style="width:80px;padding:7px 0;font-family:${FONT};font-size:13px;font-weight:700;color:${TEXT};white-space:nowrap">${money(store.net)}</td><td width="44" align="right" style="width:44px;padding:7px 0;font-family:${FONT};font-size:12px;color:${MUTED}">${total ? Math.round((store.net / total) * 100) : 0}%</td></tr>`;
    }).join("");
    return card("Net Revenue by Store", "Ranked by net revenue, with share of total", table(gap(8) + (rows || `<tr><td style="padding:24px 0;text-align:center;font-family:${FONT};font-size:13px;color:${MUTED}">No sales match the filters.</td></tr>`)));
}

function products(model: EmailModel): string {
    const total = model.products.reduce((sum, product) => sum + product.net, 0);
    const th = (label: string, align: string): string => `<th align="${align}" style="padding:0 8px 8px;border-bottom:1px solid #2A3168;font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${MUTED};white-space:nowrap">${label}</th>`;
    const td = (content: string, style = ""): string => `<td align="right" style="padding:8px;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:13px;color:${SOFT};white-space:nowrap;${style}">${content}</td>`;
    const rows = model.products.map(product => {
        const share = total ? product.net / total : 0;
        return `<tr><td style="padding:8px;border-bottom:1px solid ${LINE};font-family:${FONT}"><div style="font-size:13px;font-weight:600;color:${TEXT}">${escapeHtml(product.product)}</div><div style="margin-top:1px;font-size:10px;letter-spacing:0.8px;text-transform:uppercase;color:#E879F9">${escapeHtml(product.category)}</div></td>${td(int(product.units))}${td(money(product.gross), "color:#A5B4FC;")}${td(money(product.net), `font-weight:700;color:${product.net === 0 ? ROSE : ACCENT};`)}<td width="130" style="width:130px;padding:8px;border-bottom:1px solid ${LINE}">${table(`<tr><td>${bar(share, "#22D3EE", 6)}</td><td width="48" align="right" style="width:48px;font-family:${FONT};font-size:11px;color:${MUTED}">${pct(share)}</td></tr>`)}</td></tr>`;
    }).join("");
    const empty = `<tr><td colspan="5" style="padding:24px 0;text-align:center;font-family:${FONT};font-size:13px;color:${MUTED}">No sales match the filters.</td></tr>`;
    return card("Product Snapshot", `${model.products.length} ${model.products.length === 1 ? "product" : "products"}, in the order shown on the page`, table(gap(10) + `<tr>${th("Product", "left")}${th("Units", "right")}${th("Gross", "right")}${th("Net Revenue", "right")}${th("Share of net", "left")}</tr>${rows || empty}`));
}

export function buildEmail(model: EmailModel): { subject: string; html: string; text: string } {
    const sections = [header(model), filters(model), kpis(model), months(model), statusMix(model), stores(model), products(model)];
    const body = sections.map((section, index) => `${index ? gap(14) : ""}<tr><td>${section}</td></tr>`).join("");
    const footer = `<tr><td align="center" style="padding-top:16px;font-family:${FONT};font-size:11px;color:${FAINT}">Generated from the Power BI report on ${escapeHtml(model.generatedAt)} &#183; amounts in TND</td></tr>`;
    const subject = `${model.title}: ${model.rangeLabel}`;
    const preheader = `Net revenue ${money(model.totals.net)} TND, ${int(model.totals.orders)} orders, ${int(model.totals.units)} units.`;
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeHtml(subject)}</title></head>
<body bgcolor="${PAGE}" style="margin:0;padding:0;background-color:${PAGE}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="background-color:${PAGE}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="760" cellpadding="0" cellspacing="0" border="0" style="width:760px;max-width:100%">${body}${footer}</table>
</td></tr></table>
</body></html>`;
    const text = [
        `${model.title} (${model.rangeLabel})`,
        ...model.filters.map(filter => `${filter.label}: ${filter.value}`),
        "",
        `Net Revenue: ${money(model.totals.net)} TND`,
        `Gross Sales: ${money(model.totals.gross)} TND`,
        `Orders: ${int(model.totals.orders)}`,
        `Units Sold: ${int(model.totals.units)}`,
        "",
        ...model.products.map(product => `${product.product}: ${int(product.units)} units, ${money(product.net)} TND net`)
    ].join("\n");
    return { subject, html, text };
}
