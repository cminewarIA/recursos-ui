const TOKEN_STORAGE_KEY = 'recursos_device_token';

export function getStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore storage errors
  }
}

export function detectNativeEnvironment(): {
  isUbuntuNative: boolean;
  isAndroidNative: boolean;
  isNativeApp: boolean;
} {
  if (typeof window === 'undefined') {
    return { isUbuntuNative: false, isAndroidNative: false, isNativeApp: false };
  }
  const ua = (navigator.userAgent || '').toLowerCase();
  const isUbuntuNative =
    Boolean(window.__RECURSOS_UBUNTU_NATIVE__) ||
    ua.includes('recursoscockpit-linux') ||
    Boolean(window.webkit?.messageHandlers?.recursosNative);
  const isAndroidNative =
    Boolean(window.__RECURSOS_ANDROID_NATIVE__) ||
    ua.includes('recursoscockpit-android') ||
    Boolean(window.AndroidBridge);
  return {
    isUbuntuNative,
    isAndroidNative,
    isNativeApp: isUbuntuNative || isAndroidNative,
  };
}

export function buildApiHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra || {});
  const token = getStoredToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('X-Device-Token', token);
  }
  const env = detectNativeEnvironment();
  if (env.isUbuntuNative) {
    headers.set('X-Recursos-Env', 'native');
  } else if (env.isAndroidNative) {
    headers.set('X-Recursos-Env', 'mobile');
  } else {
    headers.set('X-Recursos-Env', 'web');
  }
  return headers;
}

export async function apiFetchJson<T = Record<string, unknown>>(
  url: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  try {
    const res = await fetch(url, {
      ...options,
      headers: buildApiHeaders(options?.headers),
      credentials: 'same-origin',
    });
    const text = await res.text();
    let parsed: T | null = null;
    try {
      parsed = text ? (JSON.parse(text) as T) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const errMsg =
        (parsed && typeof parsed === 'object' && 'error' in parsed ? String((parsed as Record<string, unknown>).error) : '') ||
        `Error HTTP ${res.status}`;
      return { ok: false, status: res.status, data: parsed, error: errMsg };
    }
    return { ok: true, status: res.status, data: parsed };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : 'Sin conexión con el servidor',
    };
  }
}
