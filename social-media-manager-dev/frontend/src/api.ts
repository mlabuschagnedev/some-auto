import type {
  AccountOperationResponse,
  AnalyticsAccountRecord,
  AnalyticsPostInsightRecord,
  AnalyticsRefreshStatus,
  GlobalSettingsPayload,
  IntegrationAccount,
  LoginResponse,
  PageRecord,
  PageSettingsPayload,
  PlanningPagePayload,
  PlanningImportResult,
  PlanningRowRecord,
  PlanningSheetSummary,
  PostRecord,
  ReferenceSheetPayload,
  SchedulerStatus,
  SessionPayload,
  SettingsSnapshot,
  SocialInsightRecord,
  TokenStatusRow,
  UserRecord,
  VerifyResponse,
  WorkspaceData,
} from "./types";

const STORAGE_KEY = "mss_some_auto_session";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type SessionUpdater = (nextSession: SessionPayload | null) => void;

type AnalyticsRefreshOptions = {
  range?: string;
  customStart?: string;
  customEnd?: string;
};

let refreshInFlight: Promise<SessionPayload | null> | null = null;

function readResponseMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["error", "message", "msg"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return fallback;
}

async function parseJsonResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    throw new ApiError(readResponseMessage(payload, fallbackMessage), response.status);
  }

  return payload as T;
}

async function refreshAccessToken(session: SessionPayload): Promise<SessionPayload | null> {
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.refreshToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await parseJsonResponse<{ access_token: string }>(
    response,
    "Unable to refresh your session.",
  );

  return {
    ...session,
    accessToken: payload.access_token,
  };
}

async function refreshAccessTokenOnce(session: SessionPayload): Promise<SessionPayload | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken(session).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function authorizedJson<T>(
  path: string,
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  init: RequestInit = {},
  allowRetry = true,
): Promise<T> {
  const headers = new Headers(init.headers);

  if (!(init.body instanceof FormData) && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", `Bearer ${session.accessToken}`);

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (response.status === 401 && allowRetry) {
    const refreshedSession = await refreshAccessTokenOnce(session);
    if (!refreshedSession) {
      onSessionUpdate(null);
      throw new ApiError("Your session has expired. Please sign in again.", 401);
    }
    onSessionUpdate(refreshedSession);
    return authorizedJson(path, refreshedSession, onSessionUpdate, init, false);
  }

  return parseJsonResponse<T>(response, "The request failed.");
}

async function parseBlobResponse(response: Response, fallbackMessage: string): Promise<Blob> {
  if (response.ok) {
    return response.blob();
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }
  const message = payload
    ? readResponseMessage(payload, fallbackMessage)
    : text.trim() || fallbackMessage;
  throw new ApiError(message, response.status);
}

async function authorizedBlob(
  path: string,
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  init: RequestInit = {},
  allowRetry = true,
): Promise<Blob> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.accessToken}`);

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (response.status === 401 && allowRetry) {
    const refreshedSession = await refreshAccessTokenOnce(session);
    if (!refreshedSession) {
      onSessionUpdate(null);
      throw new ApiError("Your session has expired. Please sign in again.", 401);
    }
    onSessionUpdate(refreshedSession);
    return authorizedBlob(path, refreshedSession, onSessionUpdate, init, false);
  }

  return parseBlobResponse(response, "The download failed.");
}

export function readStoredSession(): SessionPayload | null {
  const rawValue = window.localStorage.getItem(STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<SessionPayload>;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      !parsed.user
    ) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      user: parsed.user,
    } as SessionPayload;
  } catch {
    return null;
  }
}

export function writeStoredSession(session: SessionPayload): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export async function loginWithPassword(
  username: string,
  password: string,
): Promise<SessionPayload> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });

  const payload = await parseJsonResponse<LoginResponse>(
    response,
    "Unable to sign in with those credentials.",
  );

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    user: payload.user,
  };
}

export async function restoreStoredSession(
  storedSession: SessionPayload,
  onSessionUpdate: SessionUpdater,
): Promise<SessionPayload | null> {
  try {
    let resolvedSession = storedSession;
    const payload = await authorizedJson<VerifyResponse>(
      "/api/auth/verify",
      storedSession,
      (nextSession) => {
        if (nextSession) {
          resolvedSession = nextSession;
        }
        onSessionUpdate(nextSession);
      },
    );

    const nextSession = {
      ...resolvedSession,
      user: payload.user,
    };
    onSessionUpdate(nextSession);
    return nextSession;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function logoutSession(
  session: SessionPayload | null,
  onSessionUpdate: SessionUpdater,
): Promise<void> {
  if (!session) {
    onSessionUpdate(null);
    return;
  }

  try {
    await authorizedJson<{ message: string }>(
      "/api/auth/logout",
      session,
      onSessionUpdate,
      { method: "POST" },
    );
  } catch {
    // The client owns the session store, so best-effort logout is enough here.
  } finally {
    onSessionUpdate(null);
  }
}

function normalizeArray<T>(payload: unknown, wrappedKey?: string): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (wrappedKey && Array.isArray(record[wrappedKey])) {
      return record[wrappedKey] as T[];
    }
    if (Array.isArray(record.items)) {
      return record.items as T[];
    }
    if (Array.isArray(record.rows)) {
      return record.rows as T[];
    }
  }

  return [];
}

function normalizePages(payload: unknown): PageRecord[] {
  return normalizeArray<PageRecord>(payload, "items").map((page) => ({
    ...page,
    social_accounts: Array.isArray(page.social_accounts) ? page.social_accounts : [],
    stats: page.stats || {
      scheduled_posts: 0,
      successful_posts: 0,
      failed_posts: 0,
    },
  }));
}

function normalizePosts(payload: unknown): PostRecord[] {
  return normalizeArray<PostRecord>(payload, "items").map((post) => ({
    ...post,
    media_paths: Array.isArray(post.media_paths) ? post.media_paths : [],
    platforms: Array.isArray(post.platforms) ? post.platforms : [],
    platform_ids: post.platform_ids || {},
    platform_urls: post.platform_urls || {},
    linkedin_manual: post.linkedin_manual || { required: false },
  }));
}

function normalizeAnalyticsAccounts(payload: unknown): AnalyticsAccountRecord[] {
  return normalizeArray<AnalyticsAccountRecord>(payload, "items").map((account) => ({
    ...account,
    last_refresh_run_id: account.last_refresh_run_id ?? null,
    last_refresh_run_started_at: account.last_refresh_run_started_at ?? null,
    diagnostics: normalizeArray<SocialInsightRecord>(account.diagnostics).map((insight) => ({
      ...insight,
      refresh_run_id: insight.refresh_run_id ?? null,
      refresh_run_started_at: insight.refresh_run_started_at ?? null,
    })),
    insights: normalizeArray<SocialInsightRecord>(account.insights).map((insight) => ({
      ...insight,
      refresh_run_id: insight.refresh_run_id ?? null,
      refresh_run_started_at: insight.refresh_run_started_at ?? null,
    })),
  }));
}

function normalizeAnalyticsPosts(payload: unknown): AnalyticsPostInsightRecord[] {
  return normalizeArray<AnalyticsPostInsightRecord>(payload, "items").map((post) => ({
    ...post,
    internal_post_id: typeof post.internal_post_id === "number" ? post.internal_post_id : null,
    page_id: typeof post.page_id === "number" ? post.page_id : null,
    page_name: post.page_name ?? null,
    account_name: post.account_name ?? null,
    thumbnail: post.thumbnail ?? null,
    caption: post.caption || "",
    platform_post_id: String(post.platform_post_id || ""),
    published_at: post.published_at ?? null,
    views: Number(post.views || 0),
    reach: Number(post.reach || 0),
    engagement: Number(post.engagement || 0),
    comments: Number(post.comments || 0),
    shares: Number(post.shares || 0),
    permalink: post.permalink ?? null,
    state: post.state || "No post insights yet",
    metrics: post.metrics && typeof post.metrics === "object" ? post.metrics : {},
  }));
}

function normalizeAnalyticsRefreshStatus(payload: unknown): AnalyticsRefreshStatus {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const result = record.result && typeof record.result === "object"
    ? record.result as Record<string, unknown>
    : null;
  return {
    id: typeof record.id === "string" ? record.id : null,
    status: typeof record.status === "string" ? record.status : "idle",
    message: typeof record.message === "string" ? record.message : null,
    account_id: typeof record.account_id === "number" ? record.account_id : null,
    started_at: typeof record.started_at === "string" ? record.started_at : null,
    finished_at: typeof record.finished_at === "string" ? record.finished_at : null,
    progress_current: Number(record.progress_current || 0),
    progress_total: Number(record.progress_total || 0),
    result,
    error: typeof record.error === "string" ? record.error : null,
    accepted: typeof record.accepted === "boolean" ? record.accepted : undefined,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeScheduler(payload: unknown): SchedulerStatus {
  const scheduler = (payload && typeof payload === "object" ? payload : {}) as Partial<SchedulerStatus>;
  return {
    running: Boolean(scheduler.running),
    scheduled_jobs: Number(scheduler.scheduled_jobs || 0),
    jobs: normalizeArray(scheduler.jobs),
    queued_posts: normalizeArray(scheduler.queued_posts),
    posting_posts: normalizeArray(scheduler.posting_posts),
  };
}

function normalizePlanningPage(payload: PlanningPagePayload): PlanningPagePayload {
  return {
    ...payload,
    page: {
      ...payload.page,
      social_accounts: Array.isArray(payload.page?.social_accounts)
        ? payload.page.social_accounts
        : [],
      stats: payload.page?.stats || {
        scheduled_posts: 0,
        successful_posts: 0,
        failed_posts: 0,
      },
    },
    rows: normalizeArray<PlanningRowRecord>(payload.rows),
    month_options: normalizeArray(payload.month_options),
    designer_options: normalizeArray(payload.designer_options),
  };
}

export async function apiJson<T>(
  path: string,
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  init: RequestInit = {},
): Promise<T> {
  return authorizedJson<T>(path, session, onSessionUpdate, init);
}

export async function apiForm<T>(
  path: string,
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  formData: FormData,
  method: "POST" | "PUT" = "POST",
): Promise<T> {
  return authorizedJson<T>(
    path,
    session,
    onSessionUpdate,
    {
      method,
      body: formData,
    },
  );
}

export async function loadPages(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  search = "",
): Promise<PageRecord[]> {
  const query = search.trim()
    ? `/api/pages?include_accounts=true&q=${encodeURIComponent(search.trim())}`
    : "/api/pages?include_accounts=true";
  const payload = await apiJson<PageRecord[] | { items: PageRecord[] }>(
    query,
    session,
    onSessionUpdate,
  );
  return normalizePages(payload);
}

export async function createPageRecord(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  formData: FormData,
): Promise<PageRecord> {
  return apiForm<PageRecord>("/api/pages", session, onSessionUpdate, formData, "POST");
}

export async function updatePageRecord(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  pageId: number,
  formData: FormData,
): Promise<PageRecord> {
  return apiForm<PageRecord>(
    `/api/pages/${pageId}`,
    session,
    onSessionUpdate,
    formData,
    "PUT",
  );
}

export async function deletePageRecord(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  pageId: number,
): Promise<{ message: string }> {
  return apiJson<{ message: string }>(
    `/api/pages/${pageId}`,
    session,
    onSessionUpdate,
    { method: "DELETE" },
  );
}

export async function createSocialAccount(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  pageId: number,
  payload: Record<string, unknown>,
): Promise<AccountOperationResponse> {
  return apiJson<AccountOperationResponse>(
    `/api/pages/${pageId}/accounts`,
    session,
    onSessionUpdate,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function updateSocialAccount(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  accountId: number,
  payload: Record<string, unknown>,
): Promise<AccountOperationResponse> {
  return apiJson<AccountOperationResponse>(
    `/api/accounts/${accountId}`,
    session,
    onSessionUpdate,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export async function deleteSocialAccount(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  accountId: number,
): Promise<{ message: string }> {
  return apiJson<{ message: string }>(
    `/api/accounts/${accountId}`,
    session,
    onSessionUpdate,
    { method: "DELETE" },
  );
}

export async function testSocialAccount(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  accountId: number,
): Promise<AccountOperationResponse> {
  return apiJson<AccountOperationResponse>(
    `/api/accounts/${accountId}/test`,
    session,
    onSessionUpdate,
    { method: "POST" },
  );
}

export async function refreshSocialAccountToken(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  accountId: number,
): Promise<AccountOperationResponse> {
  return apiJson<AccountOperationResponse>(
    `/api/accounts/${accountId}/refresh`,
    session,
    onSessionUpdate,
    { method: "POST" },
  );
}

export async function loadPosts(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
): Promise<PostRecord[]> {
  const payload = await apiJson<unknown>("/api/posts", session, onSessionUpdate);
  return normalizePosts(payload);
}

export async function deletePostRecord(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  postId: number,
): Promise<{ message: string }> {
  return apiJson<{ message: string }>(
    `/api/posts/${postId}`,
    session,
    onSessionUpdate,
    { method: "DELETE" },
  );
}

export async function updateLinkedInManualPost(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  postId: number,
  payload: { done: boolean; post_url?: string },
): Promise<PostRecord> {
  return apiJson<PostRecord>(
    `/api/posts/${postId}/linkedin/manual`,
    session,
    onSessionUpdate,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function retryPostRecord(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  postId: number,
): Promise<{ message: string; post: PostRecord; results: Array<Record<string, unknown>> }> {
  return apiJson<{ message: string; post: PostRecord; results: Array<Record<string, unknown>> }>(
    `/api/posts/${postId}/retry`,
    session,
    onSessionUpdate,
    { method: "POST" },
  );
}

export async function reschedulePostRecord(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  postId: number,
  scheduledTime: string,
): Promise<{ message: string; post: PostRecord }> {
  return apiJson<{ message: string; post: PostRecord }>(
    `/api/posts/${postId}/reschedule`,
    session,
    onSessionUpdate,
    {
      method: "POST",
      body: JSON.stringify({ scheduled_time: scheduledTime }),
    },
  );
}

export async function loadPlanningSheets(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
): Promise<PlanningSheetSummary[]> {
  const payload = await apiJson<unknown>("/api/planning/sheets", session, onSessionUpdate);
  return normalizeArray<PlanningSheetSummary>(payload);
}

export async function loadPlanningPage(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  pageId: number,
  month: string,
): Promise<PlanningPagePayload> {
  const payload = await apiJson<PlanningPagePayload>(
    `/api/pages/${pageId}/planning?month=${encodeURIComponent(month)}`,
    session,
    onSessionUpdate,
  );
  return normalizePlanningPage(payload);
}

export async function createPlanningRow(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  pageId: number,
  payload: Record<string, unknown>,
): Promise<PlanningRowRecord> {
  return apiJson<PlanningRowRecord>(
    `/api/pages/${pageId}/planning/rows`,
    session,
    onSessionUpdate,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function updatePlanningRow(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  rowId: number,
  payload: Record<string, unknown>,
): Promise<PlanningRowRecord> {
  return apiJson<PlanningRowRecord>(
    `/api/planning/rows/${rowId}`,
    session,
    onSessionUpdate,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export async function deletePlanningRow(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  rowId: number,
): Promise<{ message: string }> {
  return apiJson<{ message: string }>(
    `/api/planning/rows/${rowId}`,
    session,
    onSessionUpdate,
    { method: "DELETE" },
  );
}

export async function schedulePlanningRow(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  rowId: number,
): Promise<{ message: string; row: PlanningRowRecord; post?: PostRecord }> {
  return apiJson<{ message: string; row: PlanningRowRecord; post?: PostRecord }>(
    `/api/planning/rows/${rowId}/schedule`,
    session,
    onSessionUpdate,
    { method: "POST" },
  );
}

export async function publishPlanningRow(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  rowId: number,
): Promise<{
  message: string;
  row: PlanningRowRecord;
  post: PostRecord;
  results: Array<Record<string, unknown>>;
}> {
  return apiJson<{
    message: string;
    row: PlanningRowRecord;
    post: PostRecord;
    results: Array<Record<string, unknown>>;
  }>(
    `/api/planning/rows/${rowId}/publish`,
    session,
    onSessionUpdate,
    { method: "POST" },
  );
}

export async function uploadPlanningCreativeMedia(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  rowId: number,
  formData: FormData,
): Promise<PlanningRowRecord> {
  return apiForm<PlanningRowRecord>(
    `/api/planning/rows/${rowId}/creative`,
    session,
    onSessionUpdate,
    formData,
    "POST",
  );
}

export async function importPlanningCsvs(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
): Promise<PlanningImportResult> {
  return apiJson<PlanningImportResult>(
    "/api/planning/import-csvs",
    session,
    onSessionUpdate,
    { method: "POST" },
  );
}

export async function loadIntegrationAccounts(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  pageId?: number,
): Promise<IntegrationAccount[]> {
  const path = pageId
    ? `/api/pages/${pageId}/integrations/check`
    : "/api/integrations/check";
  const payload = await apiJson<{ accounts?: IntegrationAccount[] } | IntegrationAccount[]>(
    path,
    session,
    onSessionUpdate,
  );
  return normalizeArray<IntegrationAccount>(payload, "accounts");
}

export async function loadTokenStatuses(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  pageId?: number,
): Promise<TokenStatusRow[]> {
  const path =
    typeof pageId === "number"
      ? `/api/tokens/status?page_id=${pageId}`
      : "/api/tokens/status";
  const payload = await apiJson<unknown>(path, session, onSessionUpdate);
  return normalizeArray<TokenStatusRow>(payload);
}

export async function loadGlobalSettings(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
): Promise<GlobalSettingsPayload> {
  return apiJson<GlobalSettingsPayload>("/api/settings", session, onSessionUpdate);
}

export async function updateGlobalSettings(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  payload: Record<string, unknown>,
): Promise<GlobalSettingsPayload> {
  return apiJson<GlobalSettingsPayload>("/api/settings", session, onSessionUpdate, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function loadPageSettings(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  pageId: number,
): Promise<PageSettingsPayload> {
  return apiJson<PageSettingsPayload>(
    `/api/pages/${pageId}/settings`,
    session,
    onSessionUpdate,
  );
}

export async function updatePageSettings(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  pageId: number,
  payload: Record<string, unknown>,
): Promise<{ message: string; effective: Record<string, string>; overrides: Record<string, string> }> {
  return apiJson<{ message: string; effective: Record<string, string>; overrides: Record<string, string> }>(
    `/api/pages/${pageId}/settings`,
    session,
    onSessionUpdate,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export async function loadGlobalReferenceSheet(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  sheetKey: string,
): Promise<ReferenceSheetPayload> {
  return apiJson<ReferenceSheetPayload>(
    `/api/reference-sheets/${encodeURIComponent(sheetKey)}`,
    session,
    onSessionUpdate,
  );
}

export async function saveGlobalReferenceSheet(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  sheetKey: string,
  payload: Pick<ReferenceSheetPayload, "title" | "columns" | "rows">,
): Promise<ReferenceSheetPayload> {
  return apiJson<ReferenceSheetPayload>(
    `/api/reference-sheets/${encodeURIComponent(sheetKey)}`,
    session,
    onSessionUpdate,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export async function loadPageReferenceSheet(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  pageId: number,
  sheetKey: string,
): Promise<ReferenceSheetPayload> {
  return apiJson<ReferenceSheetPayload>(
    `/api/pages/${pageId}/reference-sheets/${encodeURIComponent(sheetKey)}`,
    session,
    onSessionUpdate,
  );
}

export async function savePageReferenceSheet(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  pageId: number,
  sheetKey: string,
  payload: Pick<ReferenceSheetPayload, "title" | "columns" | "rows">,
): Promise<ReferenceSheetPayload> {
  return apiJson<ReferenceSheetPayload>(
    `/api/pages/${pageId}/reference-sheets/${encodeURIComponent(sheetKey)}`,
    session,
    onSessionUpdate,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export async function loadUsers(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
): Promise<UserRecord[]> {
  const payload = await apiJson<unknown>("/api/users", session, onSessionUpdate);
  return normalizeArray<UserRecord>(payload);
}

export async function loadAnalyticsAccounts(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  platform = "all",
): Promise<AnalyticsAccountRecord[]> {
  const payload = await apiJson<unknown>(
    `/api/analytics/accounts?platform=${encodeURIComponent(platform)}`,
    session,
    onSessionUpdate,
  );
  return normalizeAnalyticsAccounts(payload);
}

export async function loadAnalyticsPosts(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  limit = 500,
  days = 3650,
): Promise<AnalyticsPostInsightRecord[]> {
  const payload = await apiJson<unknown>(
    `/api/analytics/posts?limit=${encodeURIComponent(String(limit))}&days=${encodeURIComponent(String(days))}`,
    session,
    onSessionUpdate,
  );
  return normalizeAnalyticsPosts(payload);
}

export async function loadAnalyticsRefreshStatus(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
): Promise<AnalyticsRefreshStatus> {
  const payload = await apiJson<unknown>(
    "/api/analytics/refresh/status",
    session,
    onSessionUpdate,
  );
  return normalizeAnalyticsRefreshStatus(payload);
}

export async function downloadAnalyticsReportWorkbook(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
): Promise<Blob> {
  return authorizedBlob(
    "/api/analytics/export-report.xlsx",
    session,
    onSessionUpdate,
  );
}

export type AnalyticsReportSyncResult = {
  message?: string;
  spreadsheet_id?: string;
  spreadsheet_title?: string;
  target_year?: number;
  target_month?: number;
  prepared_cells?: number;
  updated_cells?: number;
  dry_run?: boolean;
  skipped_sheets?: string[];
};

export async function syncAnalyticsReportSheet(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
): Promise<AnalyticsReportSyncResult> {
  const payload = await apiJson<AnalyticsReportSyncResult>(
    "/api/analytics/export-report",
    session,
    onSessionUpdate,
    { method: "POST" },
  );
  return payload;
}

export async function refreshAnalytics(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  accountId?: number,
  onProgress?: (status: AnalyticsRefreshStatus) => void,
  options?: AnalyticsRefreshOptions,
): Promise<Record<string, unknown>> {
  let activeSession = session;
  const trackSessionUpdate: SessionUpdater = (nextSession) => {
    if (nextSession) {
      activeSession = nextSession;
    }
    onSessionUpdate(nextSession);
  };
  const query = new URLSearchParams({ force: "true" });
  if (typeof accountId === "number") {
    query.set("account_id", String(accountId));
  }
  if (options?.range) {
    query.set("range", options.range);
  }
  if (options?.customStart) {
    query.set("start", options.customStart);
  }
  if (options?.customEnd) {
    query.set("end", options.customEnd);
  }
  let status = normalizeAnalyticsRefreshStatus(await apiJson<unknown>(
    `/api/analytics/refresh?${query.toString()}`,
    activeSession,
    trackSessionUpdate,
    { method: "POST" },
  ));
  onProgress?.(status);

  const timeoutAt = Date.now() + 90 * 60 * 1000;
  while (["queued", "running"].includes(status.status) && Date.now() < timeoutAt) {
    await delay(2000);
    status = await loadAnalyticsRefreshStatus(activeSession, trackSessionUpdate);
    onProgress?.(status);
  }

  if (["queued", "running"].includes(status.status)) {
    throw new ApiError("Analytics refresh is still running. Check refresh status again shortly.", 408);
  }
  if (status.status === "failed") {
    throw new ApiError(status.error || status.message || "Analytics refresh failed.", 500);
  }

  return status.result || (status as unknown as Record<string, unknown>);
}

export async function createUserRecord(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  payload: Record<string, unknown>,
): Promise<UserRecord> {
  return apiJson<UserRecord>("/api/users", session, onSessionUpdate, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateUserRecord(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  username: string,
  payload: Record<string, unknown>,
): Promise<UserRecord> {
  return apiJson<UserRecord>(
    `/api/users/${encodeURIComponent(username)}`,
    session,
    onSessionUpdate,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export async function deleteUserRecord(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  username: string,
): Promise<{ message: string }> {
  return apiJson<{ message: string }>(
    `/api/users/${encodeURIComponent(username)}`,
    session,
    onSessionUpdate,
    { method: "DELETE" },
  );
}

export async function loadWorkspaceData(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
): Promise<WorkspaceData> {
  const baseRequests = await Promise.all([
    authorizedJson<PageRecord[] | { items: PageRecord[] }>(
      "/api/pages?include_accounts=true",
      session,
      onSessionUpdate,
    ),
    authorizedJson<PlanningSheetSummary[]>(
      "/api/planning/sheets",
      session,
      onSessionUpdate,
    ),
    authorizedJson<SchedulerStatus>(
      "/api/scheduler/status",
      session,
      onSessionUpdate,
    ),
    authorizedJson<PostRecord[]>(
      "/api/posts",
      session,
      onSessionUpdate,
    ),
  ]);

  const [pagesPayload, planningSheetsPayload, schedulerPayload, postsPayload] = baseRequests;

  let tokenStatuses: TokenStatusRow[] = [];
  let integrations: IntegrationAccount[] = [];
  let settings: SettingsSnapshot | null = null;

  if (session.user.role === "developer") {
    const developerRequests = await Promise.all([
      authorizedJson<unknown>("/api/tokens/status", session, onSessionUpdate),
      authorizedJson<unknown>("/api/integrations/check", session, onSessionUpdate),
      authorizedJson<SettingsSnapshot>("/api/settings", session, onSessionUpdate),
    ]);
    tokenStatuses = normalizeArray<TokenStatusRow>(developerRequests[0]);
    integrations = normalizeArray<IntegrationAccount>(developerRequests[1], "accounts");
    settings = developerRequests[2];
  }

  return {
    pages: normalizePages(pagesPayload),
    planningSheets: normalizeArray<PlanningSheetSummary>(planningSheetsPayload),
    scheduler: normalizeScheduler(schedulerPayload),
    posts: normalizePosts(postsPayload),
    tokenStatuses,
    integrations,
    settings,
  };
}
