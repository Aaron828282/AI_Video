import { useCallback, useEffect, useState } from "react";

type ManagedApiKeys = {
  firstPassApiKey: string;
  promptPackApiKey: string;
  shortVideoPromptApiKey: string;
  shortVideoRenderApiKey: string;
};

type ManagedRequestModels = {
  firstPassModel: string;
  promptPackModel: string;
  shortVideoPromptModel: string;
  shortVideoRenderModel: string;
};

type ManagedApiEndpoints = {
  firstPassAnalysisApiUrl: string;
  secondStagePromptApiUrl: string;
  shortVideoPromptApiUrl: string;
  shortVideoBaseApiUrl: string;
  shortVideoCreateApiUrl: string;
  shortVideoQueryApiUrl: string;
};

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

type ManagerResetResponse = {
  ok: boolean;
  message?: string;
  email?: string;
  expiresAt?: string;
  verifiedUntil?: string;
};

type ApiKeyManagerSectionProps = {
  apiBase: string;
  sessionStorageKey: string;
};

const DEFAULT_MANAGED_API_KEYS: ManagedApiKeys = {
  firstPassApiKey: "",
  promptPackApiKey: "",
  shortVideoPromptApiKey: "",
  shortVideoRenderApiKey: ""
};

const DEFAULT_MANAGED_REQUEST_MODELS: ManagedRequestModels = {
  firstPassModel: "",
  promptPackModel: "",
  shortVideoPromptModel: "",
  shortVideoRenderModel: ""
};

const DEFAULT_MANAGED_API_ENDPOINTS: ManagedApiEndpoints = {
  firstPassAnalysisApiUrl: "",
  secondStagePromptApiUrl: "",
  shortVideoPromptApiUrl: "",
  shortVideoBaseApiUrl: "",
  shortVideoCreateApiUrl: "",
  shortVideoQueryApiUrl: ""
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

function trimTrailingSlash(value: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function buildShortVideoEndpointByBase(baseUrl: string, suffix: string) {
  const base = trimTrailingSlash(baseUrl);
  if (!base) {
    return "";
  }
  return `${base}${suffix}`;
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

function normalizeManagedApiKeys(input: unknown): ManagedApiKeys {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const firstPassApiKey = safeText(
    source.firstPassApiKey ?? source.first_request_api_key ?? source.FIRST_PASS_ANALYSIS_API_KEY ?? source.claudeAuthToken ?? source.CLAUDE_AUTH_TOKEN
  );
  const promptPackApiKey = safeText(
    source.promptPackApiKey ??
      source.prompt_pack_api_key ??
      source.SECOND_STAGE_PROMPT_API_KEY ??
      source.secondStagePromptApiKey ??
      source.secondPromptApiKey ??
      source.cozeApiToken ??
      source.COZE_API_TOKEN
  );
  const shortVideoPromptApiKey = safeText(
    source.shortVideoPromptApiKey ??
      source.short_video_prompt_api_key ??
      source.SHORT_VIDEO_PROMPT_API_KEY ??
      source.videoPromptApiKey ??
      source.shortVideoApiKey ??
      source.short_video_api_key ??
      source.SHORT_VIDEO_API_KEY ??
      source.cozeApiToken ??
      source.COZE_API_TOKEN
  );
  const shortVideoRenderApiKey = safeText(
    source.shortVideoRenderApiKey ??
      source.short_video_render_api_key ??
      source.SHORT_VIDEO_RENDER_API_KEY ??
      source.videoRenderApiKey ??
      source.shortVideoApiKey ??
      source.short_video_api_key ??
      source.SHORT_VIDEO_API_KEY ??
      source.veoApiKey ??
      source.VEO_API_KEY ??
      source.cozeApiToken ??
      source.COZE_API_TOKEN
  );
  return {
    firstPassApiKey,
    promptPackApiKey: promptPackApiKey || firstPassApiKey,
    shortVideoPromptApiKey: shortVideoPromptApiKey || promptPackApiKey || firstPassApiKey,
    shortVideoRenderApiKey: shortVideoRenderApiKey || shortVideoPromptApiKey || promptPackApiKey || firstPassApiKey
  };
}

function normalizeManagedApiEndpoints(input: unknown): ManagedApiEndpoints {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const shortVideoBaseApiUrl = safeText(
    source.shortVideoBaseApiUrl ??
      source.short_video_base_api_url ??
      source.SHORT_VIDEO_BASE_API_URL ??
      source.baseApiUrl ??
      source.videoBaseApiUrl ??
      source.veoApiBaseUrl ??
      source.VEO_API_BASE_URL
  );
  const shortVideoCreateApiUrl = safeText(
    source.shortVideoCreateApiUrl ??
      source.short_video_create_api_url ??
      source.SHORT_VIDEO_CREATE_API_URL ??
      source.videoCreateApiUrl
  );
  const shortVideoQueryApiUrl = safeText(
    source.shortVideoQueryApiUrl ??
      source.short_video_query_api_url ??
      source.SHORT_VIDEO_QUERY_API_URL ??
      source.videoQueryApiUrl
  );
  return {
    firstPassAnalysisApiUrl: safeText(
      source.firstPassAnalysisApiUrl ??
        source.first_pass_analysis_api_url ??
        source.FIRST_PASS_ANALYSIS_API_URL ??
        source.firstPassApiUrl ??
        source.analysisApiUrl ??
        source.vectorengineFirstPassApiUrl ??
        source.VECTORENGINE_FIRST_PASS_API_URL
    ),
    secondStagePromptApiUrl: safeText(
      source.secondStagePromptApiUrl ??
        source.second_stage_prompt_api_url ??
        source.SECOND_STAGE_PROMPT_API_URL ??
        source.promptPackApiUrl ??
        source.promptApiUrl ??
        source.vectorengineSecondStageApiUrl ??
        source.VECTORENGINE_SECOND_STAGE_API_URL
    ),
    shortVideoPromptApiUrl: safeText(
      source.shortVideoPromptApiUrl ??
        source.short_video_prompt_api_url ??
        source.SHORT_VIDEO_PROMPT_API_URL ??
        source.videoPromptApiUrl
    ),
    shortVideoBaseApiUrl,
    shortVideoCreateApiUrl: shortVideoCreateApiUrl || buildShortVideoEndpointByBase(shortVideoBaseApiUrl, "/v1/video/create"),
    shortVideoQueryApiUrl: shortVideoQueryApiUrl || buildShortVideoEndpointByBase(shortVideoBaseApiUrl, "/v1/video/query")
  };
}

function normalizeManagedRequestModels(input: unknown): ManagedRequestModels {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    firstPassModel: safeText(source.firstPassModel ?? source.first_pass_model ?? source.FIRST_PASS_ANALYSIS_MODEL ?? source.analysisModel),
    promptPackModel: safeText(source.promptPackModel ?? source.prompt_pack_model ?? source.SECOND_STAGE_PROMPT_MODEL ?? source.promptModel),
    shortVideoPromptModel: safeText(
      source.shortVideoPromptModel ?? source.short_video_prompt_model ?? source.SHORT_VIDEO_PROMPT_MODEL ?? source.videoPromptModel
    ),
    shortVideoRenderModel: safeText(
      source.shortVideoRenderModel ??
        source.short_video_render_model ??
        source.SHORT_VIDEO_RENDER_MODEL ??
        source.shortVideoModel ??
        source.short_video_model ??
        source.VEO_DEFAULT_MODEL ??
        source.videoModel
    )
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
  const [apiKeys, setApiKeys] = useState<ManagedApiKeys>(DEFAULT_MANAGED_API_KEYS);
  const [requestModels, setRequestModels] = useState<ManagedRequestModels>(DEFAULT_MANAGED_REQUEST_MODELS);
  const [apiEndpoints, setApiEndpoints] = useState<ManagedApiEndpoints>(DEFAULT_MANAGED_API_ENDPOINTS);
  const [statusError, setStatusError] = useState("");
  const [statusNotice, setStatusNotice] = useState("");
  const [keyUpdatedAt, setKeyUpdatedAt] = useState<string | null>(null);

  const [resetCodeInput, setResetCodeInput] = useState("");
  const [newManagerPassword, setNewManagerPassword] = useState("");
  const [newManagerPasswordConfirm, setNewManagerPasswordConfirm] = useState("");
  const [resetCodeExpiresAt, setResetCodeExpiresAt] = useState<string | null>(null);
  const [resetVerifiedUntil, setResetVerifiedUntil] = useState<string | null>(null);
  const [resetPending, setResetPending] = useState(false);

  const clearSession = useCallback(() => {
    setSessionToken("");
    setPasswordInput("");
    setApiKeys(DEFAULT_MANAGED_API_KEYS);
    setRequestModels(DEFAULT_MANAGED_REQUEST_MODELS);
    setApiEndpoints(DEFAULT_MANAGED_API_ENDPOINTS);
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
        setApiKeys(normalizeManagedApiKeys(json.apiKeys));
        setRequestModels(normalizeManagedRequestModels(json.models));
        setApiEndpoints(normalizeManagedApiEndpoints(json.apiEndpoints));
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
        body: JSON.stringify({ apiKeys, models: requestModels, apiEndpoints })
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
      setApiKeys(normalizeManagedApiKeys(json.apiKeys));
      setRequestModels(normalizeManagedRequestModels(json.models));
      setApiEndpoints(normalizeManagedApiEndpoints(json.apiEndpoints));
      setKeyUpdatedAt(json.updatedAt ?? new Date().toISOString());
      setStatusNotice("API Key 已保存并立即生效。");
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSavePending(false);
    }
  }, [apiBase, apiEndpoints, apiKeys, clearSession, requestModels, sessionToken]);

  const handleRequestResetCode = useCallback(async () => {
    setResetPending(true);
    setStatusError("");
    setStatusNotice("");
    try {
      const response = await fetch(`${apiBase}/api/system/credentials/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const json = (await response.json()) as ManagerResetResponse;
      if (!response.ok || !json.ok) {
        setStatusError(safeText(json?.message) || `验证码请求失败: ${response.status}`);
        return;
      }
      setResetCodeInput("");
      setResetCodeExpiresAt(json.expiresAt ?? null);
      setResetVerifiedUntil(null);
      setStatusNotice("16 位验证码已发送到指定邮箱，请在 5 分钟内完成校验。");
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "验证码请求失败");
    } finally {
      setResetPending(false);
    }
  }, [apiBase]);

  const handleVerifyResetCode = useCallback(async () => {
    const code = safeText(resetCodeInput);
    if (!/^\d{16}$/.test(code)) {
      setStatusError("请输入 16 位数字验证码。");
      return;
    }
    setResetPending(true);
    setStatusError("");
    setStatusNotice("");
    try {
      const response = await fetch(`${apiBase}/api/system/credentials/password-reset/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const json = (await response.json()) as ManagerResetResponse;
      if (!response.ok || !json.ok) {
        setStatusError(safeText(json?.message) || `验证码校验失败: ${response.status}`);
        return;
      }
      setResetVerifiedUntil(json.verifiedUntil ?? null);
      setStatusNotice("验证码校验通过，请输入新密码并提交修改。");
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "验证码校验失败");
    } finally {
      setResetPending(false);
    }
  }, [apiBase, resetCodeInput]);

  const handleUpdateManagerPassword = useCallback(async () => {
    if (!resetVerifiedUntil) {
      setStatusError("请先完成验证码校验，再修改密码。");
      return;
    }
    const nextPassword = String(newManagerPassword || "");
    const confirmPassword = String(newManagerPasswordConfirm || "");
    if (!nextPassword || nextPassword.length < 8) {
      setStatusError("新密码至少 8 位。");
      return;
    }
    if (nextPassword !== confirmPassword) {
      setStatusError("两次输入的新密码不一致。");
      return;
    }
    setResetPending(true);
    setStatusError("");
    setStatusNotice("");
    try {
      const response = await fetch(`${apiBase}/api/system/credentials/password/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: nextPassword })
      });
      const json = (await response.json()) as ManagerResetResponse;
      if (!response.ok || !json.ok) {
        setStatusError(safeText(json?.message) || `密码修改失败: ${response.status}`);
        return;
      }
      clearSession();
      setResetCodeInput("");
      setResetCodeExpiresAt(null);
      setResetVerifiedUntil(null);
      setNewManagerPassword("");
      setNewManagerPasswordConfirm("");
      setStatusNotice("密码修改成功，请使用新密码重新进入管理页。");
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "密码修改失败");
    } finally {
      setResetPending(false);
    }
  }, [apiBase, clearSession, newManagerPassword, newManagerPasswordConfirm, resetVerifiedUntil]);

  return (
    <section className="apikey-page">
      {statusError ? <div className="error-banner">{statusError}</div> : null}
      {statusNotice ? <div className="loading">{statusNotice}</div> : null}

      <div className="apikey-grid">
        <article className="apikey-card">
          <h3>API Key 管理</h3>
          <p>请输入管理密码进入页面。保存后可按请求粒度配置 API Key、模型和请求地址。</p>
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
                <span className="apikey-field-title">FIRST_PASS_ANALYSIS_API_KEY</span>
                <small className="apikey-field-help">用于首轮分析接口（`POST /api/products/:recordId/analyze`）。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setApiKeys((prev) => ({ ...prev, firstPassApiKey: event.target.value }))}
                  placeholder="首轮分析 API Key"
                  type="password"
                  value={apiKeys.firstPassApiKey}
                />
              </label>
              <label className="apikey-field">
                <span className="apikey-field-title">FIRST_PASS_ANALYSIS_MODEL</span>
                <small className="apikey-field-help">首轮分析模型名称（留空则使用服务端默认值）。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setRequestModels((prev) => ({ ...prev, firstPassModel: event.target.value }))}
                  placeholder="可选模型名"
                  type="text"
                  value={requestModels.firstPassModel}
                />
              </label>
              <label className="apikey-field">
                <span className="apikey-field-title">FIRST_PASS_ANALYSIS_API_URL</span>
                <small className="apikey-field-help">首轮分析请求地址（`POST /api/products/:recordId/analyze`）。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setApiEndpoints((prev) => ({ ...prev, firstPassAnalysisApiUrl: event.target.value }))}
                  placeholder="https://.../v1/chat/completions"
                  type="text"
                  value={apiEndpoints.firstPassAnalysisApiUrl}
                />
              </label>

              <label className="apikey-field">
                <span className="apikey-field-title">SECOND_STAGE_PROMPT_API_KEY</span>
                <small className="apikey-field-help">用于图词包生成接口（`POST /api/products/:recordId/prompt-pack`）。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setApiKeys((prev) => ({ ...prev, promptPackApiKey: event.target.value }))}
                  placeholder="图词包 API Key"
                  type="password"
                  value={apiKeys.promptPackApiKey}
                />
              </label>
              <label className="apikey-field">
                <span className="apikey-field-title">SECOND_STAGE_PROMPT_MODEL</span>
                <small className="apikey-field-help">图词包生成模型名称（留空则使用服务端默认值）。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setRequestModels((prev) => ({ ...prev, promptPackModel: event.target.value }))}
                  placeholder="可选模型名"
                  type="text"
                  value={requestModels.promptPackModel}
                />
              </label>
              <label className="apikey-field">
                <span className="apikey-field-title">SECOND_STAGE_PROMPT_API_URL</span>
                <small className="apikey-field-help">图词包生成请求地址（`POST /api/products/:recordId/prompt-pack`）。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setApiEndpoints((prev) => ({ ...prev, secondStagePromptApiUrl: event.target.value }))}
                  placeholder="https://.../v1/chat/completions"
                  type="text"
                  value={apiEndpoints.secondStagePromptApiUrl}
                />
              </label>

              <label className="apikey-field">
                <span className="apikey-field-title">SHORT_VIDEO_PROMPT_API_KEY</span>
                <small className="apikey-field-help">用于短视频脚本生成接口（`POST /api/products/:recordId/video-script`）。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setApiKeys((prev) => ({ ...prev, shortVideoPromptApiKey: event.target.value }))}
                  placeholder="短视频脚本 API Key"
                  type="password"
                  value={apiKeys.shortVideoPromptApiKey}
                />
              </label>
              <label className="apikey-field">
                <span className="apikey-field-title">SHORT_VIDEO_PROMPT_MODEL</span>
                <small className="apikey-field-help">短视频脚本模型名称（留空则使用服务端默认值）。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setRequestModels((prev) => ({ ...prev, shortVideoPromptModel: event.target.value }))}
                  placeholder="可选模型名"
                  type="text"
                  value={requestModels.shortVideoPromptModel}
                />
              </label>
              <label className="apikey-field">
                <span className="apikey-field-title">SHORT_VIDEO_PROMPT_API_URL</span>
                <small className="apikey-field-help">短视频脚本请求地址（`POST /api/products/:recordId/video-script`）。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setApiEndpoints((prev) => ({ ...prev, shortVideoPromptApiUrl: event.target.value }))}
                  placeholder="https://.../v1/chat/completions"
                  type="text"
                  value={apiEndpoints.shortVideoPromptApiUrl}
                />
              </label>

              <label className="apikey-field">
                <span className="apikey-field-title">SHORT_VIDEO_RENDER_API_KEY</span>
                <small className="apikey-field-help">用于短视频生成/查询接口（`POST /api/products/:recordId/video-clips/generate`）。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setApiKeys((prev) => ({ ...prev, shortVideoRenderApiKey: event.target.value }))}
                  placeholder="短视频渲染 API Key"
                  type="password"
                  value={apiKeys.shortVideoRenderApiKey}
                />
              </label>
              <label className="apikey-field">
                <span className="apikey-field-title">SHORT_VIDEO_RENDER_MODEL</span>
                <small className="apikey-field-help">短视频生成/查询模型名称（通常为视频模型名）。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setRequestModels((prev) => ({ ...prev, shortVideoRenderModel: event.target.value }))}
                  placeholder="模型名称"
                  type="text"
                  value={requestModels.shortVideoRenderModel}
                />
              </label>
              <label className="apikey-field">
                <span className="apikey-field-title">SHORT_VIDEO_CREATE_API_URL</span>
                <small className="apikey-field-help">创建视频请求地址（例如 `https://api.vectorengine.ai/v1/video/create`）。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setApiEndpoints((prev) => ({ ...prev, shortVideoCreateApiUrl: event.target.value }))}
                  placeholder="https://api.vectorengine.ai/v1/video/create"
                  type="text"
                  value={apiEndpoints.shortVideoCreateApiUrl}
                />
              </label>
              <label className="apikey-field">
                <span className="apikey-field-title">SHORT_VIDEO_QUERY_API_URL</span>
                <small className="apikey-field-help">查询视频状态请求地址（例如 `https://api.vectorengine.ai/v1/video/query`）。</small>
                <input
                  autoComplete="off"
                  onChange={(event) => setApiEndpoints((prev) => ({ ...prev, shortVideoQueryApiUrl: event.target.value }))}
                  placeholder="https://api.vectorengine.ai/v1/video/query"
                  type="text"
                  value={apiEndpoints.shortVideoQueryApiUrl}
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

        <article className="apikey-card">
          <h3>修改管理页密码</h3>
          <p>点击按钮后，系统会自动将 16 位验证码发送到指定邮箱。验证码不会在页面展示，请从邮箱获取后输入校验。</p>
          <div className="apikey-form">
            <div className="apikey-actions">
              <button className="primary-btn" disabled={resetPending} onClick={() => void handleRequestResetCode()} type="button">
                {resetPending ? "处理中..." : "生成16位验证码并发起邮件"}
              </button>
            </div>
            <small className="apikey-note">
              验证码仅可从邮箱获取，页面不显示明文。{resetCodeExpiresAt ? `（本次有效期至 ${toDate(resetCodeExpiresAt)}）` : ""}
            </small>
            <label className="apikey-field">
              输入邮箱中的16位验证码
              <input
                inputMode="numeric"
                maxLength={16}
                onChange={(event) => setResetCodeInput(event.target.value.replace(/\D/g, "").slice(0, 16))}
                placeholder="请输入16位数字"
                type="text"
                value={resetCodeInput}
              />
            </label>
            <div className="apikey-actions">
              <button className="ghost" disabled={resetPending} onClick={() => void handleVerifyResetCode()} type="button">
                {resetPending ? "校验中..." : "校验验证码"}
              </button>
            </div>
            <small className="apikey-note">{resetVerifiedUntil ? `已通过校验，有效期至 ${toDate(resetVerifiedUntil)}` : "尚未通过验证码校验"}</small>
            <label className="apikey-field">
              新密码
              <input
                autoComplete="new-password"
                disabled={!resetVerifiedUntil}
                onChange={(event) => setNewManagerPassword(event.target.value)}
                placeholder="至少8位"
                type="password"
                value={newManagerPassword}
              />
            </label>
            <label className="apikey-field">
              确认新密码
              <input
                autoComplete="new-password"
                disabled={!resetVerifiedUntil}
                onChange={(event) => setNewManagerPasswordConfirm(event.target.value)}
                placeholder="再次输入新密码"
                type="password"
                value={newManagerPasswordConfirm}
              />
            </label>
            <button
              className="danger-btn"
              disabled={resetPending || !resetVerifiedUntil}
              onClick={() => void handleUpdateManagerPassword()}
              type="button"
            >
              {resetPending ? "提交中..." : resetVerifiedUntil ? "确认修改密码" : "请先校验验证码"}
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
