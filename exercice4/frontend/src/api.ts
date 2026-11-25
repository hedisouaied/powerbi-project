/** Minimal client for the Laravel API (Sanctum bearer token kept in localStorage). */
const TOKEN_KEY = "mc.token";

export interface User { id: number; name: string; email: string; role: string }
export class ApiError extends Error {
    constructor(public status: number, message: string, public fields: Record<string, string[]> = {}) { super(message); }
}

export function getToken(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
export function setToken(t: string | null): void { try { if (t) { localStorage.setItem(TOKEN_KEY, t); } else { localStorage.removeItem(TOKEN_KEY); } } catch { /* private mode */ } }

let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(fn: () => void): void { onUnauthorized = fn; }

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const token = getToken();
    const res = await fetch(`/api${path}`, {
        method: init.method ?? "GET",
        headers: { Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) { setToken(null); onUnauthorized(); }
    if (!res.ok) {
        const fields = (data?.errors ?? {}) as Record<string, string[]>;
        throw new ApiError(res.status, data?.message ?? `La requête a échoué (${res.status})`, fields);
    }
    return data as T;
}
