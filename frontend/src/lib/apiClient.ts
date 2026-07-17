import { clearAuthState, getAuthValue, setAuthValue } from "./authSession";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5100/api";

export type GroqLimitPayload = {
    code: "GROQ_RATE_LIMIT";
    message: string;
    retry_after_seconds?: number;
    until_ts?: number;
    console_url?: string;
    billing_url?: string;
};

export class ApiError extends Error {
    status: number;
    code?: string;
    data?: any;
    constructor(message: string, status: number, data?: any) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = data?.code;
        this.data = data;
    }
}

type GroqHandler = ((info: GroqLimitPayload) => void) | null;
let groqLimitHandler: GroqHandler = null;

export function setGroqLimitHandler(fn: GroqHandler) {
    groqLimitHandler = fn;
}

function maybeNotifyGroqLimit(status: number, data: any) {
    const msg = String(data?.message || data?.detail || data?.error || "");
    const isLimit =
        data?.code === "GROQ_RATE_LIMIT" ||
        status === 429 ||
        /rate.?limit|tokens per day|tpd|GROQ_RATE_LIMIT/i.test(msg);
    if (!isLimit) return;
    const payload: GroqLimitPayload = {
        code: "GROQ_RATE_LIMIT",
        message: msg || "Groq rate limit reached",
        retry_after_seconds: Number(data?.retry_after_seconds) || 24 * 3600,
        until_ts: data?.until_ts ? Number(data.until_ts) : undefined,
        console_url: data?.console_url || "https://console.groq.com/keys",
        billing_url: data?.billing_url || "https://console.groq.com/settings/billing",
    };
    groqLimitHandler?.(payload);
}

async function refreshAccessToken(): Promise<string | null> {
    const refreshToken = getAuthValue("refreshToken") || getAuthValue("refresh_token");
    if (!refreshToken) return null;

    const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const accessToken = data?.data?.accessToken;
    if (accessToken) {
        setAuthValue("accessToken", accessToken);
        if (data?.data?.refreshToken) setAuthValue("refreshToken", data.data.refreshToken);
    }
    return accessToken;
}

export async function apiRequest<T = any>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = endpoint.startsWith("http")
        ? endpoint
        : `${API_BASE}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

    let token = getAuthValue("accessToken") || getAuthValue("token");

    const doFetch = async (accessToken: string | null) => {
        const headers = new Headers(options.headers || {});
        if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }
        if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
        return fetch(url, { ...options, headers });
    };

    let res = await doFetch(token);
    if (res.status === 401) {
        const next = await refreshAccessToken();
        if (next) {
            res = await doFetch(next);
        } else {
            clearAuthState();
        }
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        maybeNotifyGroqLimit(res.status, data);
        throw new ApiError(data.message || data.error || data.detail || `Request failed (${res.status})`, res.status, data);
    }
    return data as T;
}

export async function apiFetchBlob(
    endpoint: string,
    options: RequestInit = {}
): Promise<Blob> {
    const url = endpoint.startsWith("http")
        ? endpoint
        : `${API_BASE}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

    let token = getAuthValue("accessToken") || getAuthValue("token");

    const doFetch = async (accessToken: string | null) => {
        const headers = new Headers(options.headers || {});
        if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
        return fetch(url, { ...options, headers });
    };

    let res = await doFetch(token);
    if (res.status === 401) {
        const next = await refreshAccessToken();
        if (next) {
            res = await doFetch(next);
        } else {
            clearAuthState();
        }
    }

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        maybeNotifyGroqLimit(res.status, data);
        throw new ApiError(data.message || `Request failed (${res.status})`, res.status, data);
    }
    return res.blob();
}
