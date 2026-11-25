import React, { useEffect, useRef, useState } from "react";
import { api, ApiError, User } from "./api";
import { App } from "./mc/app";
import { decode, emptyDataset, TABLES } from "./mc/core/data";

interface FeedsResponse { version: number; feeds: Record<string, { c: string[]; r: unknown[][] }> }
interface PrefsResponse { preferences: Record<string, unknown>; workspace: Record<string, unknown> }

const MIN_W = 1280, MIN_H = 720;

/**
 * Hosts the Mission Control dashboard (the same engine, modules and design as the Power BI visual of exercice3).
 * Data comes from GET /api/feeds; preferences from the user's account; every table edit goes to MySQL.
 */
export function Dashboard({ user, onSignOut }: { user: User; onSignOut: () => void }): React.ReactElement {
    const host = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const el = host.current; if (!el) { return; }
        const stage = document.createElement("div"); stage.className = "mc-stage-root"; el.appendChild(stage);
        const timers: Record<string, number> = {};
        const app = new App(stage, (object, json) => {
            window.clearTimeout(timers[object]);
            timers[object] = window.setTimeout(() => {
                const body = object === "prefs" ? { preferences: JSON.parse(json || "{}") } : { workspace: JSON.parse(json || "{}") };
                api("/me/preferences", { method: "PUT", body }).catch(() => app.toast("Could not save your preferences", "bad"));
            }, 500);
        });
        app.user = { name: user.name, email: user.email, role: user.role };
        app.onLogout = onSignOut;
        app.exporter = async (fileName: string, text: string): Promise<boolean> => {
            const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
            const a = document.createElement("a"); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 2000);
            return true;
        };
        app.store.sync = (op, table, id, row) => {
            const req = op === "add" ? api(`/tables/${table}`, { method: "POST", body: row })
                : op === "change" ? api(`/tables/${table}/${encodeURIComponent(id)}`, { method: "PATCH", body: row })
                    : api(`/tables/${table}/${encodeURIComponent(id)}`, { method: "DELETE" });
            req.catch((e: ApiError) => {
                app.store.revert(op, table, id);
                const first = Object.values(e.fields ?? {})[0]?.[0];
                app.toast(`Not saved: ${first ?? e.message}`, "bad");
                app.render();
            });
        };

        const fit = (): void => {
            const w = el.clientWidth, h = el.clientHeight;
            const scale = Math.min(1, w / MIN_W, h / MIN_H);
            stage.style.width = `${Math.max(w / scale, MIN_W)}px`; stage.style.height = `${Math.max(h / scale, MIN_H)}px`;
            stage.style.transform = scale < 1 ? `scale(${scale})` : "";
        };
        fit();
        const ro = new ResizeObserver(() => { fit(); });
        ro.observe(el);
        const onKey = (e: KeyboardEvent): void => { if (!stage.contains(e.target as Node)) { app.onKey(e); } };
        window.addEventListener("keydown", onKey);

        let alive = true;
        app.render(); // loading state
        Promise.all([api<FeedsResponse>("/feeds"), api<PrefsResponse>("/me/preferences")]).then(([f, p]) => {
            if (!alive) { return; }
            const d = emptyDataset(); const sizes: Record<string, number> = {}; const issues: string[] = [];
            TABLES.forEach(t => { d[t] = decode(f.feeds[t]); sizes[t] = f.feeds[t]?.r?.length ?? 0; if (!f.feeds[t]) { issues.push(`${t} (no data)`); } });
            app.feedSizes = sizes; app.feedIssues = issues;
            app.setData(d);
            const prefs = p.preferences && Object.keys(p.preferences).length ? JSON.stringify(p.preferences) : "";
            app.loadState(prefs, JSON.stringify({ ws: {}, extras: { acks: [], reviewed: [], log: [], ...(p.workspace?.extras as object ?? {}) } }));
            app.render();
        }).catch((e: Error) => { if (alive) { setError(e.message); } });

        return () => { alive = false; ro.disconnect(); window.removeEventListener("keydown", onKey); app.destroy(); el.replaceChildren(); };
    }, [user, onSignOut]);

    return (
        <div className="mc-host mc-web" ref={host}>
            {error && <div className="auth-error mc-load-error" role="alert">Could not load the data: {error}. Is the API running (php artisan serve)?</div>}
        </div>
    );
}
