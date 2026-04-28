import type {
  AccountOperationResponse,
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
    const refreshedSession = await refreshAccessToken(session);
    if (!refreshedSession) {
      onSessionUpdate(null);
      throw new ApiError("Your session has expired. Please sign in again.", 401);
    }
    onSessionUpdate(refreshedSession);
    return authorizedJson(path, refreshedSession, onSessionUpdate, init, false);
  }

  return parseJsonResponse<T>(response, "The request failed.");
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

function normalizePages(payload: PageRecord[] | { items: PageRecord[] }): PageRecord[] {
  return Array.isArray(payload) ? payload : payload.items;
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
  return apiJson<PostRecord[]>("/api/posts", session, onSessionUpdate);
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

export async function loadPlanningSheets(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
): Promise<PlanningSheetSummary[]> {
  return apiJson<PlanningSheetSummary[]>("/api/planning/sheets", session, onSessionUpdate);
}

export async function loadPlanningPage(
  session: SessionPayload,
  onSessionUpdate: SessionUpdater,
  pageId: number,
  month: string,
): Promise<PlanningPagePayload> {
  return apiJson<PlanningPagePayload>(
    `/api/pages/${pageId}/planning?month=${encodeURIComponent(month)}`,
    session,
    onSessionUpdate,
  );
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
): Promise<{ message: string; row: PlanningRowRecord }> {
  return apiJson<{ message: string; row: PlanningRowRecord }>(
    `/api/planning/rows/${rowId}/schedule`,
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
  return Array.isArray(payload) ? payload : payload.accounts || [];
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
  return apiJson<TokenStatusRow[]>(path, session, onSessionUpdate);
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
  return apiJson<UserRecord[]>("/api/users", session, onSessionUpdate);
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

  const [pagesPayload, planningSheets, scheduler, posts] = baseRequests;

  let tokenStatuses: TokenStatusRow[] = [];
  let integrations: IntegrationAccount[] = [];
  let settings: SettingsSnapshot | null = null;

  if (session.user.role === "developer") {
    const developerRequests = await Promise.all([
      authorizedJson<TokenStatusRow[]>("/api/tokens/status", session, onSessionUpdate),
      authorizedJson<IntegrationAccount[]>("/api/integrations/check", session, onSessionUpdate),
      authorizedJson<SettingsSnapshot>("/api/settings", session, onSessionUpdate),
    ]);
    [tokenStatuses, integrations, settings] = developerRequests;
  }

  return {
    pages: normalizePages(pagesPayload),
    planningSheets,
    scheduler,
    posts,
    tokenStatuses,
    integrations,
    settings,
  };
}
