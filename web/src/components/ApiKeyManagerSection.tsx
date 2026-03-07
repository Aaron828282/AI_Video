import { useCallback, useEffect, useState } from "react";

type ManagerLoginResponse = {
  ok: boolean;
  token?: string;
  expiresAt?: string;
  message?: string;
};

type ManagerApiKeysResponse = {
  ok: boolean;
  apiKeys?: Record<string, unknown>;
  models?: Record<string, unknown>;
  apiEndpoints?: Record<string, unknown>;
  updatedAt?: string;
  message?: string;
};

type ApiKeyManagerSectionProps = {
  apiBase: string;
  sessionStorageKey: string;
};

function safeText(input: unknown) {
  if (typeof input === "string") {
    return input.trim();
  }
  if (typeof input === "number") {
    return String(input);
  }
  return "";
}

function toDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function normalizeUnifiedApiKey(input: unknown) {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const candidates = [
    source.unifiedApiKey,
    source.apiKey,
    source.firstPassApiKey,
    source.first_request_api_key,
    source.FIRST_PASS_ANALYSIS_API_KEY,
    source.promptPackApiKey,
    source.prompt_pack_api_key,
    source.SECOND_STAGE_PROMPT_API_KEY,
    source.shortVideoPromptApiKey,
    source.short_video_prompt_api_key,
    source.SHORT_VIDEO_PROMPT_API_KEY,
    source.shortVideoRenderApiKey,
    source.short_video_render_api_key,
    source.SHORT_VIDEO_RENDER_API_KEY,
    source.shortVideoApiKey,
    source.short_video_api_key,
    source.SHORT_VIDEO_API_KEY,
    source.VECTORENGINE_API_KEY,
    source.COZE_API_TOKEN,
    source.COZE_AUTH_TOKEN,
    source.VEO_API_KEY
  ];
  return candidates.map((value) => safeText(value)).find(Boolean) || "";
}

function buildApiKeysPayload(unifiedApiKey: string) {
  const value = String(unifiedApiKey || "").trim();
  return {
    unifiedApiKey: value,
    firstPassApiKey: value,
    promptPackApiKey: value,
    shortVideoPromptApiKey: value,
    shortVideoRenderApiKey: value,
    shortVideoApiKey: value
  };
}

function managerAuthHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    "X-Settings-Token": token
  };
}

export function ApiKeyManagerSection({ apiBase, sessionStorageKey }: ApiKeyManagerSectionProps) {
  const [sessionToken, setSessionToken] = useState("");
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [unifiedApiKey, setUnifiedApiKey] = useState("");
  const [statusError, setStatusError] = useState("");
  const [statusNotice, setStatusNotice] = useState("");
  const [keyUpdatedAt, setKeyUpdatedAt] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    setSessionToken("");
    setPasswordInput("");
    setUnifiedApiKey("");
    window.sessionStorage.removeItem(sessionStorageKey);
  }, [sessionStorageKey]);

  const fetchApiKeys = useCallback(
    async (token: string) => {
      if (!token) {
        return false;
      }
      setLoadingKeys(true);
      setStatusError("");
      try {
        const response = await fetch(`${apiBase}/api/system/api-keys`, {
          method: "GET",
          headers: managerAuthHeaders(token)
        });
        const json = (await response.json()) as ManagerApiKeysResponse;
        if (response.status === 401) {
          clearSession();
          setStatusError("登录已失效，请重新输入页面密码。");
          return false;
        }
        if (!response.ok || !json.ok || !json.apiKeys) {
          setStatusError(safeText(json?.message) || `读取 API Key 失败: ${response.status}`);
          return false;
        }
        setUnifiedApiKey(normalizeUnifiedApiKey(json.apiKeys));
        setKeyUpdatedAt(json.updatedAt ?? new Date().toISOString());
        return true;
      } catch (error) {
        setStatusError(error instanceof Error ? error.message : "读取 API Key 失败");
        return false;
      } finally {
        setLoadingKeys(false);
      }
    },
    [apiBase, clearSession]
  );

  useEffect(() => {
    const token = safeText(window.sessionStorage.getItem(sessionStorageKey));
    if (!token) {
      return;
    }
    setSessionToken(token);
    void fetchApiKeys(token);
  }, [fetchApiKeys, sessionStorageKey]);

  const handleLogin = useCallback(async () => {
    const password = String(passwordInput || "");
    if (!password) {
      setStatusError("请输入页面密码。");
      return;
    }
    setLoginPending(true);
    setStatusError("");
    setStatusNotice("");
    try {
      const response = await fetch(`${apiBase}/api/system/credentials/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const json = (await response.json()) as ManagerLoginResponse;
      if (!response.ok || !json.ok || !json.token) {
        setStatusError(safeText(json?.message) || `登录失败: ${response.status}`);
        return;
      }
      const token = json.token;
      setSessionToken(token);
      window.sessionStorage.setItem(sessionStorageKey, token);
      const loaded = await fetchApiKeys(token);
      if (loaded) {
        setStatusNotice("已进入 API Key 管理页面。");
      }
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoginPending(false);
    }
  }, [apiBase, fetchApiKeys, passwordInput, sessionStorageKey]);

  const handleLogout = useCallback(async () => {
    const token = sessionToken;
    clearSession();
    setStatusNotice("已退出 API Key 管理。");
    if (!token) {
      return;
    }
    try {
      await fetch(`${apiBase}/api/system/credentials/logout`, {
        method: "POST",
        headers: managerAuthHeaders(token)
      });
    } catch (_error) {
      // no-op
    }
  }, [apiBase, clearSession, sessionToken]);

  const handleSaveApiKeys = useCallback(async () => {
    if (!sessionToken) {
      setStatusError("请先输入页面密码。");
      return;
    }
    setSavePending(true);
    setStatusError("");
    setStatusNotice("");
    try {
      const response = await fetch(`${apiBase}/api/system/api-keys`, {
        method: "PUT",
        headers: managerAuthHeaders(sessionToken),
        body: JSON.stringify({ apiKeys: buildApiKeysPayload(unifiedApiKey) })
      });
      const json = (await response.json()) as ManagerApiKeysResponse;
      if (response.status === 401) {
        clearSession();
        setStatusError("登录已失效，请重新输入页面密码。");
        return;
      }
      if (!response.ok || !json.ok || !json.apiKeys) {
        setStatusError(safeText(json?.message) || `保存失败: ${response.status}`);
        return;
      }
      setUnifiedApiKey(normalizeUnifiedApiKey(json.apiKeys));
      setKeyUpdatedAt(json.updatedAt ?? new Date().toISOString());
      setStatusNotice("API Key 已保存并立即生效。");
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSavePending(false);
    }
  }, [apiBase, clearSession, sessionToken, unifiedApiKey]);

  return (
    <section className="apikey-page">
      {statusError ? <div className="error-banner">{statusError}</div> : null}
      {statusNotice ? <div className="loading">{statusNotice}</div> : null}

      <div className="apikey-grid">
        <article className="apikey-card">
          <h3>API Key 管理</h3>
          <p>请输入管理密码进入页面。页面仅保留一个 API Key，所有模型请求与视频请求共用此 Key。</p>
          {!sessionToken ? (
            <div className="apikey-form">
              <label className="apikey-field">
                页面密码
                <input
                  autoComplete="current-password"
                  onChange={(event) => setPasswordInput(event.target.value)}
                  placeholder="请输入页面密码"
                  type="password"
                  value={passwordInput}
                />
              </label>
              <button className="primary-btn" disabled={loginPending} onClick={() => void handleLogin()} type="button">
                {loginPending ? "进入中..." : "进入管理页"}
              </button>
            </div>
          ) : (
            <div className="apikey-form">
              <label className="apikey-field">
                <span className="apikey-field-title">UNIFIED_API_KEY</span>
                <small className="apikey-field-help">该 Key 会用于首轮分析、图词请求、短视频提示词、短视频创建与查询接口。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setUnifiedApiKey(event.target.value)}
                  placeholder="请输入统一 API Key"
                  type="password"
                  value={unifiedApiKey}
                />
              </label>

              <div className="apikey-actions">
                <button className="primary-btn" disabled={savePending || loadingKeys} onClick={() => void handleSaveApiKeys()} type="button">
                  {savePending ? "保存中..." : "保存 API Key"}
                </button>
                <button className="ghost" disabled={loadingKeys} onClick={() => void fetchApiKeys(sessionToken)} type="button">
                  {loadingKeys ? "刷新中..." : "刷新"}
                </button>
                <button className="danger-btn" onClick={() => void handleLogout()} type="button">
                  退出管理
                </button>
              </div>
              <small className="apikey-note">最近更新：{toDate(keyUpdatedAt)}</small>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
