import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  ApiError,
  clearStoredSession,
  createPageRecord,
  createPlanningRow,
  createSocialAccount,
  createUserRecord,
  deletePostRecord,
  importPlanningCsvs,
  loadAnalyticsAccounts,
  loadAnalyticsPosts,
  loadGlobalSettings,
  loadPlanningPage,
  loadUsers,
  loadWorkspaceData,
  loginWithPassword,
  logoutSession,
  readStoredSession,
  refreshAnalytics,
  restoreStoredSession,
  reschedulePostRecord,
  retryPostRecord,
  schedulePlanningRow,
  testSocialAccount,
  updateGlobalSettings,
  updateLinkedInManualPost,
  updatePlanningRow,
  writeStoredSession,
} from "./api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Modal,
  PageHeader,
  ProgressBar,
  ResponsiveTable,
  StatCard,
  TextInput,
  Toggle,
} from "./components/ui";
import type {
  GlobalSettingsPayload,
  AnalyticsAccountRecord,
  AnalyticsPostInsightRecord,
  PageRecord,
  PlanningPagePayload,
  PlanningRowRecord,
  PostRecord,
  SessionPayload,
  SocialAccount,
  SocialInsightRecord,
  UserRecord,
  WorkspaceData,
} from "./types";

type SectionId =
  | "dashboard"
  | "projects"
  | "planner"
  | "analytics"
  | "activity"
  | "notifications"
  | "settings"
  | "help";

type ModalId = "campaign" | "post" | "invite" | "account" | "preferences" | null;
type CalendarMode = "month" | "week";
type ThemeMode = "light" | "dark";
type ThemePreference = "system" | ThemeMode;
type AnalyticsRange = "7d" | "30d" | "month" | "all" | "custom";
type InsightDisplayMode = "chart" | "bar" | "table" | "summary" | "export";

interface NavItem {
  id: SectionId;
  label: string;
  icon: string;
  description: string;
}

interface ChartItem {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
}

interface TimeSeriesPoint {
  date: string;
  value: number;
}

interface ComparisonPoint {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
}

interface AnalyticsPostRow {
  id: string;
  post: PostRecord;
  platform: string;
  platformPostId: string | null;
  permalink: string | null;
  thumbnail: string | null;
  caption: string;
  pageName: string;
  publishedAt: string | null;
  views: number | null;
  reach: number | null;
  engagement: number | null;
  comments: number | null;
  shares: number | null;
  state: "ready" | "missing_reference" | "no_metrics";
}

interface PlannerEvent {
  id: string;
  source: "planning" | "post";
  dateKey: string;
  time: string;
  title: string;
  subtitle: string;
  pageName: string;
  platforms: string[];
  status: string;
  tone: "neutral" | "good" | "warn" | "bad" | "info";
  mediaUrl?: string | null;
  row?: PlanningRowRecord;
  post?: PostRecord;
}

interface NotificationItem {
  id: string;
  title: string;
  detail: string;
  priority: "High" | "Medium" | "Low";
  source: SectionId;
  tone: "neutral" | "good" | "warn" | "bad" | "info";
}

const LOGO_SRC = "/mss-logo.png";
const READY_COLOR = "#34A853";

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", description: "Command center" },
  { id: "projects", label: "Projects", icon: "projects", description: "Pages and accounts" },
  { id: "planner", label: "Planner", icon: "planner", description: "Calendar and queue" },
  { id: "analytics", label: "Analytics", icon: "analytics", description: "Operational metrics" },
  { id: "activity", label: "Activity", icon: "activity", description: "Recent changes" },
  {
    id: "notifications",
    label: "Notifications",
    icon: "notifications",
    description: "Alerts and actions",
  },
  { id: "settings", label: "Settings", icon: "settings", description: "Workspace controls" },
  { id: "help", label: "Help", icon: "help", description: "Guides and support" },
];

const PLATFORM_OPTIONS = ["facebook", "instagram", "linkedin", "twitter", "pinterest"];
const THEME_STORAGE_KEY = "mss-ui-theme";

function resolveThemePreference(preference: ThemePreference): ThemeMode {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return preference;
}

function readInitialThemePreference(): ThemePreference {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "system" || saved === "light" || saved === "dark") {
    return saved;
  }
  return "system";
}

function todayMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  return toDateKey(next).slice(0, 7);
}

function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not set";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDateOnly(value: string | null | undefined): string {
  if (!value) {
    return "Not set";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
  }).format(date);
}

function parseRowDate(row: PlanningRowRecord): string | null {
  const raw = row.date_value.trim();
  if (!raw) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return toDateKey(parsed);
  }
  return null;
}

function rowStatus(row: PlanningRowRecord, readyColor = READY_COLOR): {
  label: string;
  tone: "neutral" | "good" | "warn" | "bad" | "info";
} {
  if (row.is_non_actionable) {
    return { label: "Disabled", tone: "neutral" };
  }
  if (row.scheduled_post_id) {
    return { label: "Scheduled", tone: "good" };
  }
  if ((row.job_color || "").toUpperCase() === readyColor.toUpperCase()) {
    return { label: "Ready", tone: "good" };
  }
  const missingCore = !row.theme.trim() || !row.post_copy.trim() || !row.date_value.trim();
  if (missingCore) {
    return { label: "Needs content", tone: "warn" };
  }
  return { label: "Draft", tone: "info" };
}

function postTone(status: string): "neutral" | "good" | "warn" | "bad" | "info" {
  if (status === "posted") {
    return "good";
  }
  if (status === "failed") {
    return "bad";
  }
  if (status === "posting" || status === "manual_pending") {
    return "warn";
  }
  if (status === "scheduled") {
    return "info";
  }
  return "neutral";
}

function pageImageUrl(page: PageRecord | null | undefined): string | null {
  if (!page?.image_path) {
    return null;
  }
  if (page.image_path.startsWith("http") || page.image_path.startsWith("/")) {
    return page.image_path;
  }
  return `/uploads/${page.image_path}`;
}

function firstPostMedia(post: PostRecord): string | null {
  const path = post.media_paths[0];
  if (!path) {
    return null;
  }
  if (path.startsWith("http") || path.startsWith("/")) {
    return path;
  }
  return `/uploads/${path}`;
}

function matchesQuery(values: Array<string | null | undefined>, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return values.join(" ").toLowerCase().includes(normalized);
}

function statusTone(value: string): "neutral" | "good" | "warn" | "bad" | "info" {
  if (["ready", "healthy", "posted", "scheduled", "running", "active"].includes(value.toLowerCase())) {
    return "good";
  }
  if (["blocked", "failed", "high", "needs content"].includes(value.toLowerCase())) {
    return "bad";
  }
  if (["manual_pending", "posting", "needs review", "medium"].includes(value.toLowerCase())) {
    return "warn";
  }
  return "info";
}

function buildStatusChart(posts: PostRecord[]): ChartItem[] {
  const statuses = ["draft", "scheduled", "posting", "manual_pending", "posted", "failed"];
  return statuses.map((status) => ({
    label: status.replace("_", " "),
    value: posts.filter((post) => post.status === status).length,
    tone: statusTone(status),
  }));
}

function buildPlatformChart(workspace: WorkspaceData | null): ChartItem[] {
  const counts = new Map<string, number>();
  workspace?.posts.forEach((post) => {
    post.platforms.forEach((platform) => counts.set(platform, (counts.get(platform) || 0) + 1));
  });
  workspace?.pages.forEach((page) => {
    page.social_accounts.forEach((account) => {
      if (!counts.has(account.platform)) {
        counts.set(account.platform, 0);
      }
    });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, tone: "info" }));
}

function buildPlannerEvents(
  planning: PlanningPagePayload | null,
  posts: PostRecord[],
  pages: PageRecord[],
): PlannerEvent[] {
  const pageMap = new Map(pages.map((page) => [page.id, page]));
  const rowEvents: PlannerEvent[] =
    planning?.rows
      .map((row): PlannerEvent | null => {
        const dateKey = parseRowDate(row);
        if (!dateKey) {
          return null;
        }
        const status = rowStatus(row, planning.job_color_rules.required_to_schedule);
        return {
          id: `row-${row.id}`,
          source: "planning" as const,
          dateKey,
          time: row.time_value || "Any time",
          title: row.theme || row.job_nr || "Untitled planner row",
          subtitle: row.post_copy || row.format || "Planning row",
          pageName: planning.page.name,
          platforms: row.linked_accounts.split(/\s+/).filter(Boolean),
          status: status.label,
          tone: status.tone,
          mediaUrl: row.creative_media_url,
          row,
        };
      })
      .filter((item): item is PlannerEvent => item !== null) || [];

  const postEvents = posts
    .filter((post) => post.scheduled_time)
    .map((post) => {
      const scheduled = new Date(post.scheduled_time || "");
      const page = pageMap.get(post.page_id || 0);
      return {
        id: `post-${post.id}`,
        source: "post" as const,
        dateKey: toDateKey(scheduled),
        time: new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit" }).format(
          scheduled,
        ),
        title: post.content?.split("\n")[0].slice(0, 80) || `Post #${post.id}`,
        subtitle: post.content || "Scheduled post",
        pageName: post.page_name || page?.name || "Unknown page",
        platforms: post.platforms,
        status: post.status,
        tone: postTone(post.status),
        mediaUrl: firstPostMedia(post),
        post,
      };
    });

  return [...rowEvents, ...postEvents].sort((a, b) =>
    `${a.dateKey} ${a.time}`.localeCompare(`${b.dateKey} ${b.time}`),
  );
}

function buildCalendarDays(monthKey: string, mode: CalendarMode, anchorDate: string): Date[] {
  if (mode === "week") {
    const anchor = new Date(`${anchorDate}T00:00:00`);
    const offset = (anchor.getDay() + 6) % 7;
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - offset);
    return Array.from({ length: 7 }, (_item, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }

  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - startOffset);
  return Array.from({ length: 42 }, (_item, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function deriveNotifications(
  workspace: WorkspaceData | null,
  planning: PlanningPagePayload | null,
): NotificationItem[] {
  if (!workspace) {
    return [];
  }

  const items: NotificationItem[] = [];

  const failedPosts = workspace.posts.filter((post) => post.status === "failed");

  const manualPosts = workspace.posts.filter(
    (post) => post.linkedin_manual.required && !post.linkedin_manual.done,
  );

  const tokenWarnings = workspace.tokenStatuses.filter((row) => row.needs_refresh);

  const integrations = Array.isArray(workspace.integrations)
    ? workspace.integrations
    : [];

  const blockedIntegrations = integrations.filter(
    (account) => !account.ready_for_publish,
  );

  const contentRows =
    planning?.rows.filter((row) => {
      const status = rowStatus(row, planning.job_color_rules.required_to_schedule);
      return status.tone === "warn" || status.tone === "bad";
    }) || [];

  if (failedPosts.length) {
    items.push({
      id: "failed-posts",
      title: `${failedPosts.length} failed post${failedPosts.length === 1 ? "" : "s"}`,
      detail: "Review failed publishing jobs before the next queue run.",
      priority: "High",
      source: "planner",
      tone: "bad",
    });
  }

  if (manualPosts.length) {
    items.push({
      id: "manual-linkedin",
      title: `${manualPosts.length} LinkedIn manual assist item${manualPosts.length === 1 ? "" : "s"}`,
      detail: "Manual LinkedIn completion is waiting for owner confirmation.",
      priority: "Medium",
      source: "planner",
      tone: "warn",
    });
  }

  if (contentRows.length) {
    items.push({
      id: "planning-content",
      title: `${contentRows.length} planner row${contentRows.length === 1 ? "" : "s"} need content`,
      detail: "Rows missing content, date, or readiness need attention.",
      priority: "Medium",
      source: "planner",
      tone: "warn",
    });
  }

  if (tokenWarnings.length) {
    items.push({
      id: "token-refresh",
      title: `${tokenWarnings.length} token warning${tokenWarnings.length === 1 ? "" : "s"}`,
      detail: "Developer token health checks show accounts nearing expiry.",
      priority: "High",
      source: "settings",
      tone: "bad",
    });
  }

  if (blockedIntegrations.length) {
    items.push({
      id: "blocked-integrations",
      title: `${blockedIntegrations.length} integration${blockedIntegrations.length === 1 ? "" : "s"} blocked`,
      detail: "Some connected accounts are missing fields required for publishing.",
      priority: "High",
      source: "projects",
      tone: "bad",
    });
  }

  return items;
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("dashboard");
  const [query, setQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem("mss-redesign-sidebar") === "collapsed",
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [modal, setModal] = useState<ModalId>(null);
  const [toast, setToast] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(todayMonthKey());
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [calendarAnchor, setCalendarAnchor] = useState(toDateKey(new Date()));
  const [themePreference, setThemePreference] = useState<ThemePreference>(readInitialThemePreference);
  const [theme, setTheme] = useState<ThemeMode>(() => resolveThemePreference(readInitialThemePreference()));
  const [planning, setPlanning] = useState<PlanningPagePayload | null>(null);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [settings, setSettings] = useState<GlobalSettingsPayload | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [analyticsAccounts, setAnalyticsAccounts] = useState<AnalyticsAccountRecord[]>([]);
  const [analyticsPosts, setAnalyticsPosts] = useState<AnalyticsPostInsightRecord[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [optimisticEventDates, setOptimisticEventDates] = useState<Record<string, string>>({});
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);
  const [dismissedNotifications, setDismissedNotifications] = useState<string[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem("mss-dismissed-notifications") || "[]") as string[];
    } catch {
      return [];
    }
  });

  function applySession(nextSession: SessionPayload | null): void {
    if (nextSession) {
      writeStoredSession(nextSession);
    } else {
      clearStoredSession();
    }
    setSession(nextSession);
    if (!nextSession) {
      setWorkspace(null);
      setPlanning(null);
      setSettings(null);
      setUsers([]);
    }
  }

  function notify(text: string, tone: "success" | "error" = "success"): void {
    setToast({ text, tone });
    window.setTimeout(() => {
      setToast((current) => (current?.text === text ? null : current));
    }, 3500);
  }

  async function refreshWorkspace(currentSession = session): Promise<void> {
    if (!currentSession) {
      return;
    }
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const nextWorkspace = await loadWorkspaceData(currentSession, applySession);
      setWorkspace(nextWorkspace);
      setSelectedPageId((current) => {
        if (current && nextWorkspace.pages.some((page) => page.id === current)) {
          return current;
        }
        return nextWorkspace.pages[0]?.id ?? null;
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        applySession(null);
      }
      setWorkspaceError(error instanceof Error ? error.message : "Unable to load workspace data.");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function refreshPlanning(): Promise<void> {
    if (!session || !selectedPageId) {
      setPlanning(null);
      return;
    }
    setPlannerLoading(true);
    try {
      const payload = await loadPlanningPage(session, applySession, selectedPageId, selectedMonth);
      setPlanning(payload);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load planner data.", "error");
    } finally {
      setPlannerLoading(false);
    }
  }

  async function refreshSettings(): Promise<void> {
    if (!session || session.user.role !== "developer") {
      return;
    }
    try {
      const [settingsPayload, userPayload] = await Promise.all([
        loadGlobalSettings(session, applySession),
        loadUsers(session, applySession),
      ]);
      setSettings(settingsPayload);
      setUsers(userPayload);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load settings.", "error");
    }
  }

  async function refreshAnalyticsAccounts(): Promise<void> {
    if (!session) {
      setAnalyticsAccounts([]);
      setAnalyticsPosts([]);
      return;
    }
    setAnalyticsLoading(true);
    try {
      const [accounts, posts] = await Promise.all([
        loadAnalyticsAccounts(session, applySession),
        loadAnalyticsPosts(session, applySession, 75),
      ]);
      setAnalyticsAccounts(accounts);
      setAnalyticsPosts(posts);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load analytics accounts.", "error");
    } finally {
      setAnalyticsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const stored = readStoredSession();
      if (!stored) {
        setBooting(false);
        return;
      }
      try {
        const restored = await restoreStoredSession(stored, (next) => {
          if (!cancelled) {
            applySession(next);
          }
        });
        if (!cancelled) {
          if (restored) {
            applySession(restored);
            await refreshWorkspace(restored);
          } else {
            applySession(null);
          }
        }
      } catch (error) {
        if (!cancelled) {
          applySession(null);
          setAuthError(error instanceof Error ? error.message : "Unable to restore your session.");
        }
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const applyResolvedTheme = () => setTheme(resolveThemePreference(themePreference));
    applyResolvedTheme();

    if (themePreference !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyResolvedTheme);
    return () => media.removeEventListener("change", applyResolvedTheme);
  }, [themePreference]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = themePreference;
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
  }, [theme, themePreference]);

  useEffect(() => {
    window.localStorage.setItem(
      "mss-redesign-sidebar",
      sidebarCollapsed ? "collapsed" : "expanded",
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (session && selectedPageId) {
      void refreshPlanning();
    }
  }, [session?.accessToken, selectedPageId, selectedMonth]);

  useEffect(() => {
    if (activeSection === "settings" || modal === "invite" || modal === "preferences") {
      void refreshSettings();
    }
  }, [activeSection, modal, session?.accessToken]);

  useEffect(() => {
    if (activeSection === "analytics") {
      void refreshAnalyticsAccounts();
    }
  }, [activeSection, session?.accessToken]);

  const activeNav = NAV_ITEMS.find((item) => item.id === activeSection) || NAV_ITEMS[0];
  const selectedPage = workspace?.pages.find((page) => page.id === selectedPageId) || null;
  const sourcePlannerEvents = useMemo(
    () => buildPlannerEvents(planning, workspace?.posts || [], workspace?.pages || []),
    [planning, workspace],
  );
  const plannerEvents = useMemo(
    () =>
      sourcePlannerEvents.map((event) =>
        optimisticEventDates[event.id] ? { ...event, dateKey: optimisticEventDates[event.id] } : event,
      ),
    [optimisticEventDates, sourcePlannerEvents],
  );
  const notifications = useMemo(() => {
    const items = deriveNotifications(workspace, planning);
    return items.filter((item) => !dismissedNotifications.includes(item.id));
  }, [dismissedNotifications, planning, workspace]);
  const unreadCount = notifications.length;
  const statusChart = useMemo(() => buildStatusChart(workspace?.posts || []), [workspace?.posts]);
  const platformChart = useMemo(() => buildPlatformChart(workspace), [workspace]);

  if (booting) {
    return (
      <main className="auth-shell">
        <section className="auth-panel auth-panel-compact">
          <img alt="MSS logo" className="auth-logo" src={LOGO_SRC} />
          <h1>Loading workspace</h1>
          <p>Restoring your signed-in session and live workspace data.</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <AuthScreen
        busy={authBusy}
        error={authError}
        onSubmit={(username, password) => {
          setAuthBusy(true);
          setAuthError(null);
          void loginWithPassword(username, password)
            .then(async (nextSession) => {
              applySession(nextSession);
              await refreshWorkspace(nextSession);
            })
            .catch((error: unknown) => {
              setAuthError(
                error instanceof Error ? error.message : "Unable to sign in with those credentials.",
              );
            })
            .finally(() => setAuthBusy(false));
        }}
      />
    );
  }

  function openSection(section: SectionId): void {
    setActiveSection(section);
    setMobileNavOpen(false);
  }

  async function reschedulePlannerItem(event: PlannerEvent, dateKey: string): Promise<void> {
    if (!session) {
      throw new Error("Sign in before rescheduling planner items.");
    }
    if (event.row) {
      await updatePlanningRow(session, applySession, event.row.id, {
        date_value: dateKey,
        planning_month: dateKey.slice(0, 7),
      });
      return;
    }

    if (event.post) {
      const current = event.post.scheduled_time ? new Date(event.post.scheduled_time) : new Date();
      const hours = String(current.getHours()).padStart(2, "0");
      const minutes = String(current.getMinutes()).padStart(2, "0");
      await reschedulePostRecord(session, applySession, event.post.id, `${dateKey}T${hours}:${minutes}:00`);
      return;
    }

    throw new Error("This calendar item cannot be rescheduled.");
  }

  async function handleCalendarDrop(event: PlannerEvent, dateKey: string): Promise<void> {
    if (event.dateKey === dateKey) {
      return;
    }

    setOptimisticEventDates((current) => ({ ...current, [event.id]: dateKey }));
    setCalendarAnchor(dateKey);
    setSelectedMonth(dateKey.slice(0, 7));

    try {
      await reschedulePlannerItem(event, dateKey);
      notify("Calendar item moved.");
      setOptimisticEventDates((current) => {
        const next = { ...current };
        delete next[event.id];
        return next;
      });
      await refreshWorkspace();
      await refreshPlanning();
    } catch (error) {
      setOptimisticEventDates((current) => {
        const next = { ...current };
        delete next[event.id];
        return next;
      });
      notify(error instanceof Error ? error.message : "Unable to move calendar item.", "error");
    } finally {
      setDraggingEventId(null);
    }
  }

  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className={`app-sidebar${mobileNavOpen ? " app-sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <button
            aria-label="Go to dashboard"
            className="brand-logo-button"
            onClick={() => openSection("dashboard")}
            type="button"
          >
            <img alt="MSS logo" src={LOGO_SRC} />
          </button>
          <div className="brand-copy">
            <strong>MSS SoME</strong>
            <span>{workspace?.settings?.app_name || "Workspace"}</span>
          </div>
          <IconButton
            className="sidebar-close"
            icon="close"
            label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>

        <nav aria-label="Primary navigation" className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              aria-current={item.id === activeSection ? "page" : undefined}
              className={item.id === activeSection ? "nav-item nav-item-active" : "nav-item"}
              key={item.id}
              onClick={() => openSection(item.id)}
              type="button"
            >
              <Icon name={item.icon} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="workspace-health">
            <span>Workspace health</span>
            <strong>{workspace ? `${workspaceHealth(workspace)}%` : "--"}</strong>
            <ProgressBar label="Workspace health" value={workspace ? workspaceHealth(workspace) : 0} />
          </div>
          <button
            className="profile-card profile-card-button"
            onClick={() => setModal("preferences")}
            type="button"
          >
            <div className="avatar" aria-hidden="true">
              {session.user.display_name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <strong>{session.user.display_name}</strong>
              <span>{session.user.role}</span>
            </div>
          </button>
        </div>
      </aside>

      {mobileNavOpen ? (
        <button
          aria-label="Close navigation overlay"
          className="mobile-scrim"
          onClick={() => setMobileNavOpen(false)}
          type="button"
        />
      ) : null}

      <div className="app-frame">
        <header className="topbar">
          <div className="topbar-left">
            <IconButton
              className="mobile-menu"
              icon="menu"
              label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
            />
            <IconButton
              className="collapse-toggle"
              icon="chevron"
              label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setSidebarCollapsed((current) => !current)}
            />
            <div className="breadcrumbs" aria-label="Breadcrumb">
              <span>Workspace</span>
              <Icon name="chevron" />
              <strong>{activeNav.label}</strong>
            </div>
          </div>

          <div className="topbar-search">
            <TextInput
              aria-label="Search workspace"
              icon="search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search pages, posts, accounts"
              value={query}
            />
          </div>

          <div className="topbar-actions">
            <Button icon="plus" onClick={() => setModal("campaign")} variant="primary">
              New page
            </Button>
            <IconButton
              className="theme-toggle"
              icon={theme === "dark" ? "sun" : "moon"}
              label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setThemePreference(theme === "dark" ? "light" : "dark")}
            />
            <button
              aria-label={`${unreadCount} active notifications`}
              className="notification-button"
              onClick={() => openSection("notifications")}
              type="button"
            >
              <Icon name="notifications" />
              {unreadCount ? <span>{unreadCount}</span> : null}
            </button>
            <button className="user-menu" onClick={() => setModal("preferences")} type="button">
              <span className="avatar" aria-hidden="true">
                {session.user.display_name.slice(0, 2).toUpperCase()}
              </span>
              <span>{session.user.display_name}</span>
            </button>
          </div>
        </header>

        <main className="content-shell">
          {workspaceError ? <div className="system-alert system-alert-error">{workspaceError}</div> : null}
          {workspaceLoading ? (
            <div className="system-alert">
              <Badge tone="info">Refreshing</Badge>
              <strong>Loading live workspace data</strong>
              <span>The dashboard is syncing with the API.</span>
            </div>
          ) : null}
          {notifications.length && ["dashboard", "planner"].includes(activeSection) ? (
            <div className="system-alert" role="status">
              <Badge tone={notifications[0].tone}>{notifications[0].priority}</Badge>
              <strong>{notifications[0].title}</strong>
              <span>{notifications[0].detail}</span>
              <Button onClick={() => openSection(notifications[0].source)} variant="ghost">
                Review
              </Button>
            </div>
          ) : null}

          {!workspace ? (
            <Card>
              <EmptyState
                action={<Button onClick={() => void refreshWorkspace()} variant="primary">Retry</Button>}
                description="The API did not return workspace data yet."
                title="Workspace unavailable"
              />
            </Card>
          ) : null}

          {workspace && activeSection === "dashboard" ? (
            <DashboardPage
              notifications={notifications}
              onOpenModal={setModal}
              onRefresh={() => void refreshWorkspace()}
              onSectionOpen={openSection}
              plannerEvents={plannerEvents}
              platformChart={platformChart}
              query={query}
              statusChart={statusChart}
              workspace={workspace}
            />
          ) : null}
          {workspace && activeSection === "projects" ? (
            <ProjectsPage
              onConnectAccount={(pageId) => {
                setSelectedPageId(pageId);
                setModal("account");
              }}
              onOpenModal={setModal}
              onPageSelect={setSelectedPageId}
              query={query}
              selectedPage={selectedPage}
              workspace={workspace}
            />
          ) : null}
          {workspace && activeSection === "planner" ? (
            <PlannerPage
              calendarAnchor={calendarAnchor}
              calendarMode={calendarMode}
              draggingEventId={draggingEventId}
              events={plannerEvents}
              loading={plannerLoading}
              onCreatePost={(dateKey) => {
                setCalendarAnchor(dateKey);
                setModal("post");
              }}
              onDeletePost={async (post) => {
                try {
                  await deletePostRecord(session, applySession, post.id);
                  notify("Post removed from the queue.");
                  await refreshWorkspace();
                  await refreshPlanning();
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Unable to delete post.", "error");
                }
              }}
              onDuplicateRow={async (row) => {
                if (!selectedPageId) {
                  notify("Select a page first.", "error");
                  return;
                }
                try {
                  await createPlanningRow(session, applySession, selectedPageId, {
                    planning_month: row.planning_month || selectedMonth,
                    linked_accounts: row.linked_accounts,
                    job_nr: `${row.job_nr || "Copy"} copy`,
                    date_value: row.date_value,
                    time_value: row.time_value,
                    theme: `${row.theme || "Untitled"} copy`,
                    post_copy: row.post_copy,
                    link: row.link,
                    format: row.format,
                    final_creative: row.final_creative,
                    deadline: row.deadline,
                    mss_notes: row.mss_notes,
                    designer: row.designer,
                    job_color: row.job_color,
                    is_non_actionable: row.is_non_actionable,
                  });
                  notify("Planner row duplicated.");
                  await refreshWorkspace();
                  await refreshPlanning();
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Unable to duplicate row.", "error");
                }
              }}
              onEventDragEnd={() => setDraggingEventId(null)}
              onEventDragStart={(event) => setDraggingEventId(event.id)}
              onEventDrop={handleCalendarDrop}
              onImport={async () => {
                if (!session) {
                  return;
                }
                try {
                  const result = await importPlanningCsvs(session, applySession);
                  notify(result.message || "Planner import finished.");
                  await refreshWorkspace();
                  await refreshPlanning();
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Unable to import planner CSVs.", "error");
                }
              }}
              onModeChange={setCalendarMode}
              onMonthChange={(delta) => {
                const next = shiftMonth(selectedMonth, delta);
                setSelectedMonth(next);
                setCalendarAnchor(`${next}-01`);
              }}
              onPageChange={setSelectedPageId}
              onSchedule={async (row) => {
                try {
                  const result = await schedulePlanningRow(session, applySession, row.id);
                  notify(result.message || "Planning row scheduled.");
                  await refreshWorkspace();
                  await refreshPlanning();
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Unable to schedule row.", "error");
                }
              }}
              onManualComplete={async (post) => {
                try {
                  await updateLinkedInManualPost(session, applySession, post.id, { done: true });
                  notify("Manual LinkedIn item marked complete.");
                  await refreshWorkspace();
                  await refreshPlanning();
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Unable to mark manual item complete.", "error");
                }
              }}
              onPreview={(event) => {
                notify(event.post?.error_message || event.subtitle || event.title);
              }}
              onRetryPost={async (post) => {
                try {
                  await retryPostRecord(session, applySession, post.id);
                  notify("Retry finished.");
                  await refreshWorkspace();
                  await refreshPlanning();
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Unable to retry post.", "error");
                }
              }}
              onWeekChange={(delta) => {
                const date = new Date(`${calendarAnchor}T00:00:00`);
                date.setDate(date.getDate() + delta * 7);
                const key = toDateKey(date);
                setCalendarAnchor(key);
                setSelectedMonth(key.slice(0, 7));
              }}
              planning={planning}
              query={query}
              selectedMonth={selectedMonth}
              selectedPageId={selectedPageId}
              workspace={workspace}
            />
          ) : null}
          {workspace && activeSection === "analytics" ? (
            <AnalyticsPage
              accounts={analyticsAccounts}
              analyticsPosts={analyticsPosts}
              loading={analyticsLoading}
              onRefreshInsights={async () => {
                try {
                  await refreshAnalytics(session, applySession);
                  notify("Analytics refresh requested.");
                  await refreshAnalyticsAccounts();
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Unable to refresh analytics.", "error");
                }
              }}
              platformChart={platformChart}
              query={query}
              statusChart={statusChart}
              workspace={workspace}
            />
          ) : null}
          {workspace && activeSection === "activity" ? (
            <ActivityPage planning={planning} query={query} workspace={workspace} />
          ) : null}
          {workspace && activeSection === "notifications" ? (
            <NotificationsPage
              notifications={notifications}
              onDismiss={(id) => {
                const next = [...dismissedNotifications, id];
                setDismissedNotifications(next);
                window.localStorage.setItem("mss-dismissed-notifications", JSON.stringify(next));
              }}
              onDismissAll={() => {
                const next = Array.from(new Set([...dismissedNotifications, ...notifications.map((item) => item.id)]));
                setDismissedNotifications(next);
                window.localStorage.setItem("mss-dismissed-notifications", JSON.stringify(next));
              }}
              onSectionOpen={openSection}
              query={query}
            />
          ) : null}
          {workspace && activeSection === "settings" ? (
            <SettingsPage
              onInvite={() => setModal("invite")}
              onRefresh={refreshSettings}
              onSave={async (payload) => {
                if (!session) {
                  return;
                }
                try {
                  const saved = await updateGlobalSettings(session, applySession, payload);
                  setSettings(saved);
                  notify(
                    saved.meta_token_result?.message
                      || saved.linkedin_token_result?.message
                      || saved.message
                      || "Settings saved.",
                  );
                  await refreshWorkspace();
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Unable to save settings.", "error");
                }
              }}
              settings={settings}
              theme={theme}
              themePreference={themePreference}
              onThemePreferenceChange={setThemePreference}
              users={users}
              workspace={workspace}
            />
          ) : null}
          {workspace && activeSection === "help" ? (
            <HelpPage
              onContactSupport={() => {
                window.location.href = "mailto:marcel@marketingss.co.za?subject=MSS%20SoME-Auto%20support";
              }}
              onOpenModal={setModal}
              onSectionOpen={openSection}
              workspace={workspace}
            />
          ) : null}
        </main>
      </div>

      <CreatePageModal
        onClose={() => setModal(null)}
        onSubmit={async (formData) => {
          try {
            const page = await createPageRecord(session, applySession, formData);
            notify("Page created.");
            setSelectedPageId(page.id);
            setModal(null);
            await refreshWorkspace();
          } catch (error) {
            notify(error instanceof Error ? error.message : "Unable to create page.", "error");
          }
        }}
        open={modal === "campaign"}
      />
      <CreatePlannerRowModal
        defaultDate={calendarAnchor}
        defaultMonth={selectedMonth}
        designerOptions={planning?.designer_options || []}
        onClose={() => setModal(null)}
        onSubmit={async (payload) => {
          if (!selectedPageId) {
            notify("Select a page first.", "error");
            return;
          }
          try {
            await createPlanningRow(session, applySession, selectedPageId, payload);
            notify("Planner row created.");
            setModal(null);
            await refreshWorkspace();
            await refreshPlanning();
          } catch (error) {
            notify(error instanceof Error ? error.message : "Unable to create planner row.", "error");
          }
        }}
        open={modal === "post"}
        page={selectedPage}
      />
      <ConnectAccountModal
        onClose={() => setModal(null)}
        onSubmit={async (payload) => {
          if (!selectedPageId) {
            notify("Select a page first.", "error");
            return;
          }
          try {
            await createSocialAccount(session, applySession, selectedPageId, payload);
            notify("Account connected.");
            setModal(null);
            await refreshWorkspace();
          } catch (error) {
            notify(error instanceof Error ? error.message : "Unable to connect account.", "error");
          }
        }}
        open={modal === "account"}
        page={selectedPage}
      />
      <InviteMemberModal
        onClose={() => setModal(null)}
        onSubmit={async (payload) => {
          try {
            await createUserRecord(session, applySession, payload);
            notify("Team member created.");
            setModal(null);
            await refreshSettings();
          } catch (error) {
            notify(error instanceof Error ? error.message : "Unable to create user.", "error");
          }
        }}
        open={modal === "invite"}
      />
      <Modal
        description="Session controls and workspace refresh."
        footer={
          <>
            <Button onClick={() => void refreshWorkspace()} variant="secondary">
              Refresh workspace
            </Button>
            <Button
              onClick={() => {
                void logoutSession(session, applySession);
                setModal(null);
              }}
              variant="danger"
            >
              Sign out
            </Button>
          </>
        }
        onClose={() => setModal(null)}
        open={modal === "preferences"}
        title="Account"
      >
        <div className="profile-summary">
          <div className="avatar">{session.user.display_name.slice(0, 2).toUpperCase()}</div>
          <div>
            <h3>{session.user.display_name}</h3>
            <p>{session.user.email || session.user.username}</p>
            <Badge tone="info">{session.user.role}</Badge>
          </div>
        </div>
        <Toggle
          checked={theme === "dark"}
          description="Persists on this browser. Full appearance options are available in Settings."
          label="Dark mode"
          onChange={(checked) => setThemePreference(checked ? "dark" : "light")}
        />
      </Modal>

      {toast ? (
        <div className={toast.tone === "error" ? "toast toast-error" : "toast"} role="status">
          <Badge tone={toast.tone === "error" ? "bad" : "good"}>
            {toast.tone === "error" ? "Error" : "Saved"}
          </Badge>
          <span>{toast.text}</span>
        </div>
      ) : null}
    </div>
  );
}

function workspaceHealth(workspace: WorkspaceData): number {
  const totalAccounts = workspace.pages.reduce(
    (count, page) => count + page.social_accounts.length,
    0,
  );

  const integrations = Array.isArray(workspace.integrations)
    ? workspace.integrations
    : [];

  const readyAccounts = integrations.length
    ? integrations.filter((account) => account.ready_for_publish).length
    : totalAccounts;

  const integrationScore = totalAccounts
    ? Math.round((readyAccounts / totalAccounts) * 100)
    : 100;

  const failedPenalty = Math.min(
    35,
    workspace.posts.filter((post) => post.status === "failed").length * 5,
  );

  const tokenPenalty = Math.min(
    25,
    workspace.tokenStatuses.filter((row) => row.needs_refresh).length * 8,
  );

  return Math.max(0, Math.min(100, integrationScore - failedPenalty - tokenPenalty));
}

function AuthScreen(props: {
  busy: boolean;
  error: string | null;
  onSubmit: (username: string, password: string) => void;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-copy">
          <img alt="MSS logo" className="auth-logo" src={LOGO_SRC} />
          <p className="eyebrow">MSS Social Media Manager</p>
          <h1>Sign in to your workspace</h1>
          <p>Live pages, planner rows, publishing queue, account health, and settings load through the API after sign-in.</p>
        </div>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            props.onSubmit(String(formData.get("username") || ""), String(formData.get("password") || ""));
          }}
        >
          <Field label="Username">
            <input autoComplete="username" disabled={props.busy} name="username" />
          </Field>
          <Field label="Password">
            <input autoComplete="current-password" disabled={props.busy} name="password" type="password" />
          </Field>
          {props.error ? <p className="form-error">{props.error}</p> : null}
          <Button disabled={props.busy} type="submit" variant="primary">
            {props.busy ? "Signing in..." : "Enter workspace"}
          </Button>
        </form>
      </section>
    </main>
  );
}

function DashboardPage(props: {
  workspace: WorkspaceData;
  plannerEvents: PlannerEvent[];
  notifications: NotificationItem[];
  statusChart: ChartItem[];
  platformChart: ChartItem[];
  query: string;
  onOpenModal: (modal: ModalId) => void;
  onRefresh: () => void;
  onSectionOpen: (section: SectionId) => void;
}) {
  const totalAccounts = props.workspace.pages.reduce((count, page) => count + page.social_accounts.length, 0);
  const queuedPosts = props.workspace.posts.filter((post) =>
    ["draft", "scheduled", "posting", "manual_pending"].includes(post.status),
  );
  const failedPosts = props.workspace.posts.filter((post) => post.status === "failed");
  const visibleEvents = props.plannerEvents
    .filter((event) =>
      matchesQuery([event.title, event.pageName, event.platforms.join(" "), event.status], props.query),
    )
    .slice(0, 5);
  const nextEvent = visibleEvents[0];

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <>
            <Button icon="plus" onClick={() => props.onOpenModal("post")} variant="primary">
              New planner row
            </Button>
            <Button icon="refresh" onClick={props.onRefresh}>
              Refresh
            </Button>
          </>
        }
        description="Schedule health, approvals, blockers, and recent movement from the live API."
        eyebrow="Command center"
        meta={
          <>
            <Badge tone={workspaceHealth(props.workspace) >= 80 ? "good" : "warn"}>
              {workspaceHealth(props.workspace)}% healthy
            </Badge>
            <Badge tone={props.notifications.length ? "bad" : "good"}>
              {props.notifications.length || 0} active alerts
            </Badge>
            <Badge tone="info">{visibleEvents.length} visible calendar items</Badge>
          </>
        }
        title="Dashboard"
      />

      <Card className="ops-summary-card">
        <div className="ops-summary">
          <div>
            <p className="eyebrow">Today at a glance</p>
            <h2>
              {props.notifications.length
                ? `${props.notifications.length} item${props.notifications.length === 1 ? "" : "s"} need attention`
                : "Publishing workspace is clear"}
            </h2>
            <p>
              {nextEvent
                ? `Next: ${nextEvent.time} ${nextEvent.title} on ${nextEvent.pageName}.`
                : "No upcoming calendar item is visible in the current view."}
            </p>
          </div>
          <div className="ops-summary-metrics">
            <span>
              <strong>{failedPosts.length}</strong>
              <small>Failed</small>
            </span>
            <span>
              <strong>{queuedPosts.length}</strong>
              <small>In motion</small>
            </span>
            <span>
              <strong>{props.workspace.scheduler.running ? "On" : "Off"}</strong>
              <small>Scheduler</small>
            </span>
          </div>
          <Button onClick={() => props.onSectionOpen(failedPosts.length ? "notifications" : "planner")} variant="primary">
            {failedPosts.length ? "Recover failures" : "Open planner"}
          </Button>
        </div>
      </Card>

      <section className="stats-grid" aria-label="Workspace metrics">
        <StatCard helper="Client pages saved in the database" label="Managed pages" value={String(props.workspace.pages.length)} />
        <StatCard helper="Connected social media accounts" label="Accounts" value={String(totalAccounts)} />
        <StatCard helper="Draft, scheduled, posting, or manual pending" label="Posts in motion" value={String(queuedPosts.length)} />
        <StatCard
          helper="Scheduler jobs registered by the backend"
          label="Scheduler"
          tone={props.workspace.scheduler.running ? "good" : "bad"}
          trend={props.workspace.scheduler.running ? "Running" : "Stopped"}
          value={String(props.workspace.scheduler.scheduled_jobs)}
        />
      </section>

      <div className="dashboard-grid">
        <Card
          actions={<Button onClick={() => props.onSectionOpen("notifications")} variant="ghost">Open inbox</Button>}
          description="The items most likely to block today's work."
          title="Needs attention"
        >
          <div className="attention-list">
            {props.notifications.length ? (
              props.notifications.slice(0, 4).map((item) => (
                <article className="attention-item" key={item.id}>
                  <Badge tone={item.tone}>{item.priority}</Badge>
                  <p>{item.title}. {item.detail}</p>
                  <Button onClick={() => props.onSectionOpen(item.source)} variant="ghost">
                    Review
                  </Button>
                </article>
              ))
            ) : (
              <EmptyState
                description="No failed posts, token warnings, or blocked integrations are active right now."
                title="No urgent blockers"
              />
            )}
          </div>
        </Card>

        <Card
          actions={<Button onClick={() => props.onSectionOpen("planner")} variant="ghost">Open calendar</Button>}
          description="Upcoming planner rows and scheduled posts."
          title="Publishing queue"
        >
          <div className="queue-list">
            {visibleEvents.length ? (
              visibleEvents.map((event) => <PlannerEventRow event={event} key={event.id} />)
            ) : (
              <EmptyState
                description="No queue items match the current search."
                title="No matching queue items"
              />
            )}
          </div>
        </Card>
      </div>

      <div className="split-grid">
        <Card description="Database-backed post state split by status." title="Post status">
          <BarChart items={props.statusChart} />
        </Card>
        <Card description="Publishing footprint across connected and scheduled platforms." title="Platform coverage">
          <BarChart items={props.platformChart} />
        </Card>
      </div>
    </div>
  );
}

function ProjectsPage(props: {
  workspace: WorkspaceData;
  selectedPage: PageRecord | null;
  query: string;
  onOpenModal: (modal: ModalId) => void;
  onPageSelect: (pageId: number) => void;
  onConnectAccount: (pageId: number) => void;
}) {
  const pages = props.workspace.pages.filter((page) =>
    matchesQuery(
      [
        page.name,
        page.description,
        page.social_accounts.map((account) => account.platform).join(" "),
        page.social_accounts.map((account) => account.account_name).join(" "),
      ],
      props.query,
    ),
  );
  const selected = props.selectedPage || pages[0] || null;

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <>
            <Button onClick={() => selected && props.onConnectAccount(selected.id)}>Connect account</Button>
            <Button icon="plus" onClick={() => props.onOpenModal("campaign")} variant="primary">
              New page
            </Button>
          </>
        }
        description="Live pages, connected accounts, saved page images, and publishing readiness."
        eyebrow="Workspace structure"
        meta={
          <>
            <Badge tone="info">{pages.length} shown</Badge>
            <Badge tone="good">{props.workspace.pages.length} total pages</Badge>
          </>
        }
        title="Projects"
      />

      <div className="projects-layout">
        <div className="project-list">
          {pages.length ? (
            pages.map((page) => (
              <button
                className={selected?.id === page.id ? "project-card project-card-active" : "project-card"}
                key={page.id}
                onClick={() => props.onPageSelect(page.id)}
                type="button"
              >
                <div className="project-card-top">
                  <div className="page-title-row">
                    <MediaThumb alt={page.name} src={pageImageUrl(page)} />
                    <div>
                      <p className="eyebrow">Page #{page.id}</p>
                      <h2>{page.name}</h2>
                      <p>{page.description || "No description saved yet."}</p>
                    </div>
                  </div>
                  <Badge tone={page.social_accounts.length ? "good" : "warn"}>
                    {page.social_accounts.length ? "Connected" : "No accounts"}
                  </Badge>
                </div>
                <div className="project-meta-grid">
                  <span>
                    <strong>{page.stats.scheduled_posts}</strong>
                    <small>Queued</small>
                  </span>
                  <span>
                    <strong>{page.stats.successful_posts}</strong>
                    <small>Posted</small>
                  </span>
                  <span>
                    <strong>{page.stats.failed_posts}</strong>
                    <small>Failed</small>
                  </span>
                </div>
                <div className="chip-row">
                  {page.social_accounts.length ? (
                    page.social_accounts.map((account) => (
                      <span className="chip" key={account.id}>
                        {account.platform}
                      </span>
                    ))
                  ) : (
                    <span className="chip">No accounts connected</span>
                  )}
                </div>
              </button>
            ))
          ) : (
            <Card>
              <EmptyState
                action={<Button onClick={() => props.onOpenModal("campaign")} variant="primary">Create page</Button>}
                description="Create a page or clear search to see your saved pages."
                title="No pages found"
              />
            </Card>
          )}
        </div>

        <Card
          actions={selected ? <Button onClick={() => props.onConnectAccount(selected.id)} variant="ghost">Connect</Button> : null}
          className="project-detail"
          description="Accounts and settings saved for the selected page."
          title="Page snapshot"
        >
          {selected ? (
            <>
              <div className="snapshot-header">
                <div className="page-title-row">
                  <MediaThumb alt={selected.name} src={pageImageUrl(selected)} size="large" />
                  <div>
                    <p className="eyebrow">Selected page</p>
                    <h3>{selected.name}</h3>
                    <p>{selected.linkedin_page_url || "No LinkedIn page URL saved."}</p>
                  </div>
                </div>
              </div>
              <div className="snapshot-metrics">
                <span>
                  <strong>{selected.social_accounts.length}</strong>
                  <small>Accounts</small>
                </span>
                <span>
                  <strong>{selected.stats.scheduled_posts}</strong>
                  <small>Queued</small>
                </span>
                <span>
                  <strong>{selected.stats.failed_posts}</strong>
                  <small>Failed</small>
                </span>
              </div>
              <div className="account-stack">
                {selected.social_accounts.length ? (
                  selected.social_accounts.map((account) => (
                    <AccountRow account={account} key={account.id} />
                  ))
                ) : (
                  <EmptyState
                    action={<Button onClick={() => props.onConnectAccount(selected.id)}>Connect account</Button>}
                    description="This page has no connected social accounts yet."
                    title="No accounts"
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState description="Select a page to view details." title="No page selected" />
          )}
        </Card>
      </div>
    </div>
  );
}

function PlannerPage(props: {
  workspace: WorkspaceData;
  planning: PlanningPagePayload | null;
  selectedPageId: number | null;
  selectedMonth: string;
  calendarMode: CalendarMode;
  calendarAnchor: string;
  events: PlannerEvent[];
  draggingEventId: string | null;
  query: string;
  loading: boolean;
  onPageChange: (pageId: number) => void;
  onMonthChange: (delta: number) => void;
  onWeekChange: (delta: number) => void;
  onModeChange: (mode: CalendarMode) => void;
  onCreatePost: (dateKey: string) => void;
  onEventDragStart: (event: PlannerEvent) => void;
  onEventDragEnd: () => void;
  onEventDrop: (event: PlannerEvent, dateKey: string) => Promise<void>;
  onPreview: (event: PlannerEvent) => void;
  onDuplicateRow: (row: PlanningRowRecord) => Promise<void>;
  onDeletePost: (post: PostRecord) => Promise<void>;
  onManualComplete: (post: PostRecord) => Promise<void>;
  onRetryPost: (post: PostRecord) => Promise<void>;
  onImport: () => Promise<void>;
  onSchedule: (row: PlanningRowRecord) => Promise<void>;
}) {
  const calendarDays = buildCalendarDays(props.selectedMonth, props.calendarMode, props.calendarAnchor);
  const visibleEvents = props.events.filter((event) =>
    matchesQuery([event.title, event.pageName, event.status, event.platforms.join(" ")], props.query),
  );
  const unscheduledRows = props.planning?.rows.filter((row) => !parseRowDate(row)) || [];

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <>
            <Button onClick={props.onImport}>Import planner</Button>
            <Button icon="plus" onClick={() => props.onCreatePost(props.calendarAnchor)} variant="primary">
              New planner row
            </Button>
          </>
        }
        description="Calendar-first planning for what gets posted, when, and where."
        eyebrow="Publishing workflow"
        meta={
          <>
            <Badge tone="info">{formatMonth(props.selectedMonth)}</Badge>
            <Badge tone={props.loading ? "warn" : "good"}>{props.loading ? "Loading" : "Synced"}</Badge>
            <Badge tone="info">{visibleEvents.length} calendar items</Badge>
          </>
        }
        title="Planner"
      />

      <Card>
        <div className="planner-toolbar">
          <select
            aria-label="Select page"
            onChange={(event) => props.onPageChange(Number(event.target.value))}
            value={props.selectedPageId || ""}
          >
            {props.workspace.pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.name}
              </option>
            ))}
          </select>
          <div className="segmented-control">
            <button
              aria-pressed={props.calendarMode === "month"}
              className={props.calendarMode === "month" ? "active" : ""}
              onClick={() => props.onModeChange("month")}
              type="button"
            >
              Month
            </button>
            <button
              aria-pressed={props.calendarMode === "week"}
              className={props.calendarMode === "week" ? "active" : ""}
              onClick={() => props.onModeChange("week")}
              type="button"
            >
              Week
            </button>
          </div>
          <div className="inline-actions">
            <Button
              onClick={() =>
                props.calendarMode === "month" ? props.onMonthChange(-1) : props.onWeekChange(-1)
              }
            >
              Previous
            </Button>
            <Button
              onClick={() =>
                props.calendarMode === "month" ? props.onMonthChange(1) : props.onWeekChange(1)
              }
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      <div className="planner-layout planner-layout-calendar">
        <Card className="calendar-card" title={props.calendarMode === "month" ? formatMonth(props.selectedMonth) : "Week view"}>
          <CalendarGrid
            days={calendarDays}
            draggingEventId={props.draggingEventId}
            events={visibleEvents}
            mode={props.calendarMode}
            monthKey={props.selectedMonth}
            onCreatePost={props.onCreatePost}
            onEventDragEnd={props.onEventDragEnd}
            onEventDragStart={props.onEventDragStart}
            onEventDrop={props.onEventDrop}
          />
        </Card>

        <Card description="Rows that need action are pulled out of the calendar for quick follow-up." title="Readiness">
          <div className="queue-list">
            {visibleEvents.slice(0, 8).map((event) => (
              <PlannerEventRow
                action={
                  <PlannerEventActions
                    event={event}
                    onDeletePost={props.onDeletePost}
                    onDuplicateRow={props.onDuplicateRow}
                    onManualComplete={props.onManualComplete}
                    onPreview={props.onPreview}
                    onRetryPost={props.onRetryPost}
                    onSchedule={props.onSchedule}
                  />
                }
                event={event}
                key={event.id}
              />
            ))}
            {!visibleEvents.length ? (
              <EmptyState
                description="No dated rows or scheduled posts match this view."
                title="No calendar items"
              />
            ) : null}
          </div>
        </Card>
      </div>

      {unscheduledRows.length ? (
        <Card description="These planner rows are saved, but do not have a calendar date yet." title="Unscheduled rows">
          <div className="queue-list">
            {unscheduledRows.map((row) => {
              const status = rowStatus(row, props.planning?.job_color_rules.required_to_schedule || READY_COLOR);
              return (
                <article className="planner-row" key={row.id}>
                  <div className="planner-time">Row {row.row_order}</div>
                  <div className="planner-content">
                    <div>
                      <strong>{row.theme || row.job_nr || "Untitled row"}</strong>
                      <span>{row.post_copy || "No post copy saved yet."}</span>
                    </div>
                    <div className="chip-row">
                      <span className="chip">{row.linked_accounts || "No accounts"}</span>
                      {row.designer ? <span className="chip">{row.designer}</span> : null}
                    </div>
                  </div>
                  <div className="planner-row-actions">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <Button onClick={() => props.onDuplicateRow(row)} variant="ghost">
                      Duplicate
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function buildInsightChart(
  accounts: AnalyticsAccountRecord[],
  range: AnalyticsRange,
  customStart?: string,
  customEnd?: string,
): ChartItem[] {
  const insights = accounts.flatMap((account) => accountInsightsForDisplay(account));
  return buildInsightChartFromRecords(filterInsightsByRange(insights, range, customStart, customEnd));
}

function isSupportedInsightMetric(metricName: string | null | undefined): boolean {
  const normalized = String(metricName || "").trim().toLowerCase();
  return Boolean(normalized) && normalized !== "fans" && normalized !== "fan_count" && !normalized.startsWith("page_fan");
}

function isDisplayInsight(insight: SocialInsightRecord): boolean {
  return insight.metric_value !== null && !insight.error_message && isSupportedInsightMetric(insight.metric_name);
}

function accountInsightsForDisplay(account: AnalyticsAccountRecord): SocialInsightRecord[] {
  return (Array.isArray(account.insights) ? account.insights : []).filter(isDisplayInsight);
}

function formatMetricName(metricName: string): string {
  const labels: Record<string, string> = {
    views: "Views",
    page_media_view: "Views",
    page_views_total: "Views",
    engagement: "Engagement",
    page_post_engagements: "Engagement",
    followers: "Followers",
    followers_count: "Followers",
    reach: "Reach",
    visits: "Visits",
    media_count: "Media count",
    profile_views: "Visits",
    online_followers: "Online followers",
    reactions: "Reactions",
    likes: "Likes",
    comments: "Comments",
    shares: "Shares",
    saved: "Saves",
    total_interactions: "Total interactions",
  };
  const normalized = metricName.trim().toLowerCase();
  if (labels[normalized]) {
    return labels[normalized];
  }
  return metricName
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function analyticsMetricCategory(metricName: string | null | undefined): string {
  const normalized = String(metricName || "").trim().toLowerCase();
  if (["views", "page_media_view", "page_views_total"].includes(normalized)) {
    return "views";
  }
  if (["engagement", "page_post_engagements", "total_interactions", "accounts_engaged"].includes(normalized)) {
    return "engagement";
  }
  if (["followers", "followers_count", "follower_count", "page_follows"].includes(normalized)) {
    return "followers";
  }
  if (["reach"].includes(normalized)) {
    return "reach";
  }
  if (["visits", "profile_views"].includes(normalized)) {
    return "visits";
  }
  if (["media_count"].includes(normalized)) {
    return "media_count";
  }
  return normalized || "metric";
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function accountMetricValue(
  account: AnalyticsAccountRecord,
  metric: string,
  range: AnalyticsRange,
  customStart?: string,
  customEnd?: string,
): number {
  const rows = filterInsightsByRange(accountInsightsForDisplay(account), range, customStart, customEnd)
    .filter((insight) => analyticsMetricCategory(insight.metric_name) === metric);
  if (!rows.length) {
    return 0;
  }
  const lifetimeRows = rows
    .filter((insight) => insight.period === "lifetime")
    .sort((a, b) => (insightDate(b)?.getTime() || 0) - (insightDate(a)?.getTime() || 0));
  if (lifetimeRows.length) {
    return Math.round(Number(lifetimeRows[0].metric_value || 0));
  }
  return Math.round(rows.reduce((sum, insight) => sum + Number(insight.metric_value || 0), 0));
}

function buildMetricTimeSeries(
  accounts: AnalyticsAccountRecord[],
  metric: string,
  range: AnalyticsRange,
  customStart?: string,
  customEnd?: string,
): TimeSeriesPoint[] {
  const buckets = new Map<string, number>();
  accounts.forEach((account) => {
    filterInsightsByRange(accountInsightsForDisplay(account), range, customStart, customEnd)
      .filter((insight) => analyticsMetricCategory(insight.metric_name) === metric)
      .forEach((insight) => {
        const date = insightDate(insight);
        if (!date) {
          return;
        }
        const key = toDateKey(date);
        buckets.set(key, (buckets.get(key) || 0) + Number(insight.metric_value || 0));
      });
  });
  const series = Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value: Math.round(value) }));
  return expandMetricSeries(series, range, customStart, customEnd);
}

function dateKeyToDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function expandMetricSeries(
  series: TimeSeriesPoint[],
  range: AnalyticsRange,
  customStart?: string,
  customEnd?: string,
): TimeSeriesPoint[] {
  const values = new Map(series.map((point) => [point.date, point.value]));
  let start: Date | null = null;
  let end: Date | null = null;
  if (range === "all") {
    const dates = series.map((point) => dateKeyToDate(point.date)).filter((date): date is Date => Boolean(date));
    if (!dates.length) {
      return series;
    }
    start = new Date(Math.min(...dates.map((date) => date.getTime())));
    end = new Date();
  } else {
    const bounds = rangeBounds(range, customStart, customEnd);
    start = bounds.start;
    end = bounds.end || new Date();
  }
  if (!start || !end) {
    return series;
  }
  const expanded: TimeSeriesPoint[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const stop = new Date(end);
  stop.setHours(0, 0, 0, 0);
  while (cursor <= stop && expanded.length < 4000) {
    const key = toDateKey(cursor);
    expanded.push({ date: key, value: values.get(key) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return expanded;
}

function daysInclusive(start: Date | null, end: Date | null): number {
  if (!start || !end) {
    return 0;
  }
  const startTime = new Date(start).setHours(0, 0, 0, 0);
  const endTime = new Date(end).setHours(0, 0, 0, 0);
  if (endTime < startTime) {
    return 0;
  }
  return Math.round((endTime - startTime) / 86400000) + 1;
}

function seriesMeta(data: TimeSeriesPoint[]) {
  const dates = data.map((point) => dateKeyToDate(point.date)).filter((date): date is Date => Boolean(date));
  const start = dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;
  const end = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null;
  return {
    start,
    end,
    total: data.reduce((sum, point) => sum + Number(point.value || 0), 0),
    days: daysInclusive(start, end),
  };
}

function compactDateRange(start: Date | null, end: Date | null): string {
  if (!start || !end) {
    return "No date range";
  }
  const formatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function previousRangeFromSeries(data: TimeSeriesPoint[]): { start: Date | null; end: Date | null } {
  const meta = seriesMeta(data);
  if (!meta.start || !meta.end || !meta.days) {
    return { start: null, end: null };
  }
  const end = new Date(meta.start);
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - meta.days + 1);
  return { start, end };
}

function sumMetricForExplicitRange(
  accounts: AnalyticsAccountRecord[],
  metric: string,
  start: Date | null,
  end: Date | null,
): number {
  if (!start || !end) {
    return 0;
  }
  return accounts.reduce((sum, account) => {
    const accountSum = accountInsightsForDisplay(account)
      .filter((insight) => analyticsMetricCategory(insight.metric_name) === metric)
      .filter((insight) => {
        const date = insightDate(insight);
        return Boolean(date && date >= start && date <= end);
      })
      .reduce((metricSum, insight) => metricSum + Number(insight.metric_value || 0), 0);
    return sum + accountSum;
  }, 0);
}

function buildPlatformMetricComparison(
  accounts: AnalyticsAccountRecord[],
  metric: string,
  range: AnalyticsRange,
  customStart?: string,
  customEnd?: string,
): ComparisonPoint[] {
  return ["facebook", "instagram"]
    .map((platform) => ({
      label: formatMetricName(platform),
      value: accounts
        .filter((account) => account.platform === platform)
        .reduce((sum, account) => sum + accountMetricValue(account, metric, range, customStart, customEnd), 0),
      tone: platform === "facebook" ? "info" as const : "good" as const,
    }))
    .filter((item) => item.value > 0);
}

function buildAccountComparison(
  accounts: AnalyticsAccountRecord[],
  metric: string,
  range: AnalyticsRange,
  customStart?: string,
  customEnd?: string,
): ComparisonPoint[] {
  return accounts
    .map((account) => ({
      label: account.account_name || account.page_name || `${account.platform} account`,
      value: accountMetricValue(account, metric, range, customStart, customEnd),
      tone: account.ready ? "info" as const : "warn" as const,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

function latestAnalyticsRefresh(accounts: AnalyticsAccountRecord[]): string | null {
  const timestamps = accounts
    .map((account) => account.last_refreshed_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));
  if (!timestamps.length) {
    return null;
  }
  return new Date(Math.max(...timestamps)).toISOString();
}

function analyticsNextRefresh(workspace: WorkspaceData): string | null {
  const job = workspace.scheduler.jobs.find((item) => item.id === "refresh_social_insights");
  return job?.next_run || null;
}

function postPlatformId(post: PostRecord, platform: string): string | null {
  const ids = post.platform_ids || {};
  return ids[platform] || null;
}

function buildPostAnalyticsRows(
  posts: PostRecord[],
  pages: PageRecord[],
  accounts: AnalyticsAccountRecord[],
  analyticsPosts: AnalyticsPostInsightRecord[],
  options: {
    range: AnalyticsRange;
    customStart: string;
    customEnd: string;
    platform: "all" | "facebook" | "instagram";
    pageId: number | "all";
    query: string;
  },
): AnalyticsPostRow[] {
  const { start, end } = rangeBounds(options.range, options.customStart, options.customEnd);
  const pageNames = new Map(pages.map((page) => [page.id, page.name]));
  const postInsightsByPostPlatform = new Map(
    (Array.isArray(analyticsPosts) ? analyticsPosts : []).map((item) => [`${item.internal_post_id}-${item.platform}`, item]),
  );
  const postInsightsByRemoteId = new Map(
    (Array.isArray(analyticsPosts) ? analyticsPosts : [])
      .filter((item) => item.platform_post_id)
      .map((item) => [`${item.platform}-${item.platform_post_id}`, item]),
  );
  const rows: AnalyticsPostRow[] = [];
  posts.forEach((post) => {
    const publishedAt = post.posted_at || post.scheduled_time || post.created_at;
    const postDate = publishedAt ? new Date(publishedAt) : null;
    if (options.range !== "all" && postDate && !Number.isNaN(postDate.getTime())) {
      if (start && postDate < start) {
        return;
      }
      if (end && postDate > end) {
        return;
      }
    }
    if (options.pageId !== "all" && post.page_id !== options.pageId) {
      return;
    }
    const platforms = (Array.isArray(post.platforms) ? post.platforms : []).filter((platform) =>
      ["facebook", "instagram"].includes(platform) && (options.platform === "all" || platform === options.platform),
    );
    platforms.forEach((platform) => {
      const platformPostId = postPlatformId(post, platform);
      const postInsight = postInsightsByPostPlatform.get(`${post.id}-${platform}`)
        || (platformPostId ? postInsightsByRemoteId.get(`${platform}-${platformPostId}`) : undefined);
      const account = accounts.find((item) => item.page_id === post.page_id && item.platform === platform);
      const views = postInsight ? Number(postInsight.views || 0) : account ? accountMetricValue(account, "views", options.range, options.customStart, options.customEnd) : null;
      const engagement = postInsight ? Number(postInsight.engagement || 0) : account ? accountMetricValue(account, "engagement", options.range, options.customStart, options.customEnd) : null;
      const row: AnalyticsPostRow = {
        id: `${post.id}-${platform}`,
        post,
        platform,
        platformPostId,
        permalink: postInsight?.permalink || post.platform_urls?.[platform] || null,
        thumbnail: postInsight?.thumbnail || firstPostMedia(post),
        caption: postInsight?.caption || post.content || "No caption saved.",
        pageName: postInsight?.page_name || post.page_name || pageNames.get(post.page_id) || "Unknown page",
        publishedAt: postInsight?.published_at || publishedAt,
        views: platformPostId ? views : null,
        reach: postInsight ? Number(postInsight.reach || 0) : null,
        engagement: platformPostId ? engagement : null,
        comments: postInsight ? Number(postInsight.comments || 0) : null,
        shares: postInsight ? Number(postInsight.shares || 0) : null,
        state: !platformPostId ? "missing_reference" : postInsight ? "ready" : "no_metrics",
      };
      if (matchesQuery([row.caption, row.pageName, row.platform, row.platformPostId], options.query)) {
        rows.push(row);
      }
    });
  });
  return rows
    .sort((a, b) => {
      const aScore = (a.engagement || 0) + (a.views || 0);
      const bScore = (b.engagement || 0) + (b.views || 0);
      return bScore - aScore;
    });
}

function insightDate(insight: SocialInsightRecord): Date | null {
  const rawDate = insight.end_date || insight.start_date || insight.refreshed_at;
  if (!rawDate) {
    return null;
  }
  const date = new Date(rawDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rangeBounds(
  range: AnalyticsRange,
  customStart?: string,
  customEnd?: string,
): { start: Date | null; end: Date | null } {
  const now = new Date();
  let start: Date | null = null;
  let end: Date | null = null;
  if (range === "7d") {
    start = new Date(now);
    start.setDate(now.getDate() - 7);
  } else if (range === "30d") {
    start = new Date(now);
    start.setDate(now.getDate() - 30);
  } else if (range === "month") {
    start = new Date(now);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (range === "custom") {
    start = customStart ? new Date(`${customStart}T00:00:00`) : null;
    end = customEnd ? new Date(`${customEnd}T23:59:59`) : null;
  }
  return { start, end };
}

function isInsightInRange(
  insight: SocialInsightRecord,
  range: AnalyticsRange,
  customStart?: string,
  customEnd?: string,
): boolean {
  if (range === "all") {
    return true;
  }
  const date = insightDate(insight);
  if (!date) {
    return false;
  }
  const { start, end } = rangeBounds(range, customStart, customEnd);
  if (start && date < start) {
    return false;
  }
  if (end && date > end) {
    return false;
  }
  return true;
}

function filterInsightsByRange(
  insights: SocialInsightRecord[],
  range: AnalyticsRange,
  customStart?: string,
  customEnd?: string,
): SocialInsightRecord[] {
  return insights.filter((insight) => isInsightInRange(insight, range, customStart, customEnd));
}

function buildInsightChartFromRecords(insights: SocialInsightRecord[]): ChartItem[] {
  const totals = new Map<string, number>();
  insights.forEach((insight) => {
    if (insight.metric_value === null || insight.error_message) {
      return;
    }
    totals.set(insight.metric_name, (totals.get(insight.metric_name) || 0) + Number(insight.metric_value || 0));
  });

  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value: Math.round(value), tone: "info" }));
}

function metricOptionsForAccounts(accounts: AnalyticsAccountRecord[]): string[] {
  return Array.from(
    new Set(
      accounts.flatMap((account) =>
        accountInsightsForDisplay(account).map((insight) => insight.metric_name),
      ),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function downloadTextFile(filename: string, content: string, type = "text/plain"): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportInsightsAsCsv(filename: string, rows: Array<{ account: AnalyticsAccountRecord; insight: SocialInsightRecord }>): void {
  const header = ["page", "account", "platform", "metric", "value", "period", "start_date", "end_date", "refreshed_at", "error"];
  const escapeCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [
    header.map(escapeCell).join(","),
    ...rows.map(({ account, insight }) =>
      [
        account.page_name,
        account.account_name,
        account.platform,
        insight.metric_name,
        insight.metric_value,
        insight.period,
        insight.start_date,
        insight.end_date,
        insight.refreshed_at,
        insight.error_message,
      ]
        .map(escapeCell)
        .join(","),
    ),
  ];
  downloadTextFile(filename, lines.join("\n"), "text/csv");
}

function exportAnalyticsReportAsCsv(
  filename: string,
  summary: {
    posted: number;
    scheduled: number;
    failed: number;
    successRate: number;
    postsInRange: number;
    accounts: AnalyticsAccountRecord[];
  },
): void {
  const escapeCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const accountRows = summary.accounts.flatMap((account) =>
    accountInsightsForDisplay(account).map((insight) => [
      "insight",
      account.page_name,
      account.account_name,
      account.platform,
      insight.metric_name,
      insight.metric_value,
      insight.period,
      insight.end_date || insight.start_date || insight.refreshed_at,
    ]),
  );
  const lines = [
    ["section", "page", "account", "platform", "metric", "value", "period", "date"].map(escapeCell).join(","),
    ["summary", "", "", "", "posted", summary.posted, "", ""].map(escapeCell).join(","),
    ["summary", "", "", "", "scheduled", summary.scheduled, "", ""].map(escapeCell).join(","),
    ["summary", "", "", "", "failed", summary.failed, "", ""].map(escapeCell).join(","),
    ["summary", "", "", "", "success_rate", `${summary.successRate}%`, "", ""].map(escapeCell).join(","),
    ["summary", "", "", "", "posts_in_range", summary.postsInRange, "", ""].map(escapeCell).join(","),
    ...accountRows.map((row) => row.map(escapeCell).join(",")),
  ];
  downloadTextFile(filename, lines.join("\n"), "text/csv");
}

function exportChartAsSvg(filename: string, title: string, items: ChartItem[]): void {
  const width = 920;
  const rowHeight = 44;
  const height = Math.max(220, 96 + items.length * rowHeight);
  const maxValue = Math.max(1, ...items.map((item) => item.value));
  const rows = items
    .map((item, index) => {
      const y = 78 + index * rowHeight;
      const barWidth = Math.max(4, (item.value / maxValue) * 560);
      return `
        <text x="32" y="${y + 18}" fill="#111827" font-size="15" font-family="Inter, Arial">${item.label}</text>
        <rect x="230" y="${y}" width="560" height="22" rx="7" fill="#e5e7eb" />
        <rect x="230" y="${y}" width="${barWidth}" height="22" rx="7" fill="#2563eb" />
        <text x="812" y="${y + 17}" fill="#111827" font-size="15" font-weight="700" font-family="Inter, Arial">${item.value}</text>
      `;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" rx="18" fill="#f8fafc" />
    <text x="32" y="42" fill="#111827" font-size="24" font-weight="800" font-family="Inter, Arial">${title}</text>
    ${rows}
  </svg>`;
  downloadTextFile(filename, svg, "image/svg+xml");
}

function exportTimeSeriesAsSvg(filename: string, title: string, data: TimeSeriesPoint[]): void {
  const width = 920;
  const height = 420;
  const padX = 88;
  const padY = 62;
  const points = Array.isArray(data) ? data.filter((point) => Number.isFinite(point.value)) : [];
  if (!points.length) {
    return;
  }
  const maxValue = Math.max(1, ...points.map((point) => point.value));
  const minValue = Math.min(0, ...points.map((point) => point.value));
  const step = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;
  const scaleY = (value: number) => height - padY - ((value - minValue) / (maxValue - minValue || 1)) * (height - padY * 2);
  const plotted = points.map((point, index) => ({
    ...point,
    x: padX + index * step,
    y: scaleY(point.value),
  }));
  const path = plotted.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const meta = seriesMeta(points);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = padY + ratio * (height - padY * 2);
    const value = Math.round(maxValue - ratio * (maxValue - minValue));
    return `<line x1="${padX}" x2="${width - padX}" y1="${y}" y2="${y}" stroke="#d7dee9" /><text x="34" y="${y + 4}" fill="#475569" font-size="13" font-family="Inter, Arial">${value}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" rx="18" fill="#f8fafc" />
    <text x="32" y="36" fill="#111827" font-size="24" font-weight="800" font-family="Inter, Arial">${title}</text>
    <text x="32" y="62" fill="#475569" font-size="14" font-weight="700" font-family="Inter, Arial">${compactDateRange(meta.start, meta.end)}   Total: ${Math.round(meta.total)}   ${meta.days} days</text>
    <text x="22" y="${height / 2}" transform="rotate(-90 22 ${height / 2})" fill="#111827" font-size="14" font-weight="800" font-family="Inter, Arial">${title}</text>
    ${grid}
    <path d="${path}" fill="none" stroke="#0891b2" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
  downloadTextFile(filename, svg, "image/svg+xml");
}

function AnalyticsPage(props: {
  workspace: WorkspaceData;
  accounts: AnalyticsAccountRecord[];
  analyticsPosts: AnalyticsPostInsightRecord[];
  loading: boolean;
  statusChart: ChartItem[];
  platformChart: ChartItem[];
  query: string;
  onRefreshInsights: () => Promise<void>;
}) {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [customStart, setCustomStart] = useState(toDateKey(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [customEnd, setCustomEnd] = useState(toDateKey(new Date()));
  const [platformFilter, setPlatformFilter] = useState<"all" | "facebook" | "instagram">("all");
  const [pageFilter, setPageFilter] = useState<number | "all">("all");
  const [metricFilter, setMetricFilter] = useState("views");
  const [accountSearch, setAccountSearch] = useState("");
  const [accountPage, setAccountPage] = useState(1);
  const [selectedInsightAccountId, setSelectedInsightAccountId] = useState<number | null>(null);
  const [accountTab, setAccountTab] = useState<"overview" | "trends" | "posts" | "raw" | "errors">("overview");
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerPageId, setExplorerPageId] = useState<number | null>(null);
  const [explorerMetric, setExplorerMetric] = useState<string>("");
  const [explorerPlatform, setExplorerPlatform] = useState<"all" | "facebook" | "instagram">("all");
  const [explorerRange, setExplorerRange] = useState<AnalyticsRange>("30d");
  const [explorerCustomStart, setExplorerCustomStart] = useState(toDateKey(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [explorerCustomEnd, setExplorerCustomEnd] = useState(toDateKey(new Date()));
  const [explorerDisplay, setExplorerDisplay] = useState<InsightDisplayMode>("chart");
  const [coverageMode, setCoverageMode] = useState<"platform" | "insights">("platform");
  const [rawOpen, setRawOpen] = useState(false);
  const [manualRefreshState, setManualRefreshState] = useState<"idle" | "refreshing" | "error" | "partial">("idle");
  const accountPageSize = 12;
  const filteredPosts = useMemo(
    () =>
      buildPostAnalyticsRows(props.workspace.posts, props.workspace.pages, props.accounts, props.analyticsPosts, {
        range,
        customStart,
        customEnd,
        platform: platformFilter,
        pageId: pageFilter,
        query: props.query,
      }),
    [props.workspace.posts, props.workspace.pages, props.accounts, props.analyticsPosts, range, customStart, customEnd, platformFilter, pageFilter, props.query],
  );
  const visibleAccounts = props.accounts.filter((account) => {
    const platformMatches = platformFilter === "all" || account.platform === platformFilter;
    const pageMatches = pageFilter === "all" || account.page_id === pageFilter;
    const searchMatches = matchesQuery(
      [account.account_name, account.page_name, account.platform],
      [props.query, accountSearch].filter(Boolean).join(" "),
    );
    return platformMatches && pageMatches && searchMatches;
  });
  const totalAccountPages = Math.max(1, Math.ceil(visibleAccounts.length / accountPageSize));
  const pagedAccounts = visibleAccounts.slice((accountPage - 1) * accountPageSize, accountPage * accountPageSize);
  const selectedInsightAccount = selectedInsightAccountId
    ? props.accounts.find((account) => account.id === selectedInsightAccountId) || null
    : null;
  const trendSeries = buildMetricTimeSeries(visibleAccounts, metricFilter, range, customStart, customEnd);
  const viewsSeries = buildMetricTimeSeries(visibleAccounts, "views", range, customStart, customEnd);
  const engagementSeries = buildMetricTimeSeries(visibleAccounts, "engagement", range, customStart, customEnd);
  const platformComparison = buildPlatformMetricComparison(visibleAccounts, metricFilter, range, customStart, customEnd);
  const accountComparison = buildAccountComparison(visibleAccounts, metricFilter, range, customStart, customEnd);
  const totalViews = visibleAccounts.reduce((sum, account) => sum + accountMetricValue(account, "views", range, customStart, customEnd), 0);
  const totalEngagement = visibleAccounts.reduce((sum, account) => sum + accountMetricValue(account, "engagement", range, customStart, customEnd), 0);
  const totalFollowers = visibleAccounts.reduce((sum, account) => sum + accountMetricValue(account, "followers", range, customStart, customEnd), 0);
  const bestAccount = buildAccountComparison(visibleAccounts, "engagement", range, customStart, customEnd)[0] || null;
  const bestPost = filteredPosts[0] || null;
  const lastRefreshed = latestAnalyticsRefresh(props.accounts);
  const nextRefresh = analyticsNextRefresh(props.workspace);
  const refreshStatus = props.loading || manualRefreshState === "refreshing"
    ? "refreshing"
    : manualRefreshState === "error"
      ? "error"
      : visibleAccounts.some((account) => account.last_error)
        ? "partial success"
        : "idle";
  const selectedAccountInsights = selectedInsightAccount
    ? filterInsightsByRange(
        accountInsightsForDisplay(selectedInsightAccount),
        range,
        customStart,
        customEnd,
      )
    : [];
  const selectedAccountSeries = selectedInsightAccount
    ? buildMetricTimeSeries([selectedInsightAccount], metricFilter, range, customStart, customEnd)
    : [];
  const selectedAccountChart = buildInsightChartFromRecords(selectedAccountInsights);
  const metricOptions = metricOptionsForAccounts(props.accounts);
  const explorerAccounts = props.accounts.filter((account) => {
    const pageMatches = explorerPageId !== null && account.page_id === explorerPageId;
    const platformMatches = explorerPlatform === "all" || account.platform === explorerPlatform;
    return pageMatches && platformMatches;
  });
  const explorerRows = explorerAccounts.flatMap((account) =>
    filterInsightsByRange(accountInsightsForDisplay(account), explorerRange, explorerCustomStart, explorerCustomEnd)
      .filter((insight) => explorerMetric && insight.metric_name === explorerMetric)
      .map((insight) => ({ account, insight })),
  );
  const explorerMetricKey = explorerMetric ? analyticsMetricCategory(explorerMetric) : metricFilter;
  const explorerSeries = buildMetricTimeSeries(explorerAccounts, explorerMetricKey, explorerRange, explorerCustomStart, explorerCustomEnd);
  const explorerBars = buildPlatformMetricComparison(explorerAccounts, explorerMetricKey, explorerRange, explorerCustomStart, explorerCustomEnd);
  const explorerPreviousRange = previousRangeFromSeries(explorerSeries);
  const explorerPreviousTotal = sumMetricForExplicitRange(explorerAccounts, explorerMetricKey, explorerPreviousRange.start, explorerPreviousRange.end);
  const explorerCurrentTotal = Math.round(explorerSeries.reduce((sum, point) => sum + point.value, 0));
  const explorerSummary = {
    total: explorerCurrentTotal,
    previousTotal: Math.round(explorerPreviousTotal),
    delta: Math.round(explorerCurrentTotal - explorerPreviousTotal),
    previousLabel: compactDateRange(explorerPreviousRange.start, explorerPreviousRange.end),
    latest: explorerRows.slice().sort((a, b) => (insightDate(b.insight)?.getTime() || 0) - (insightDate(a.insight)?.getTime() || 0))[0]?.insight.metric_value ?? null,
  };
  const explorerPageLabel = props.workspace.pages.find((page) => page.id === explorerPageId)?.name || "selected page";
  const explorerMetricLabel = explorerMetric ? formatMetricName(explorerMetric) : "selected metric";
  const coverageDescription = coverageMode === "insights"
    ? `Showing ${explorerMetricLabel} from ${explorerPageLabel}.`
    : "Publishing footprint across connected and scheduled platforms.";
  const selectedAccountPosts = selectedInsightAccount
    ? filteredPosts.filter((row) => row.post.page_id === selectedInsightAccount.page_id && row.platform === selectedInsightAccount.platform)
    : [];

  useEffect(() => {
    setAccountPage(1);
  }, [accountSearch, platformFilter, pageFilter, range, customStart, customEnd]);

  useEffect(() => {
    if (explorerPageId === null && props.workspace.pages.length) {
      setExplorerPageId(props.workspace.pages[0].id);
    }
  }, [explorerPageId, props.workspace.pages]);

  useEffect(() => {
    if (!explorerMetric && metricOptions.length) {
      setExplorerMetric(metricOptions[0]);
    }
  }, [explorerMetric, metricOptions]);

  async function handleManualRefresh(): Promise<void> {
    setManualRefreshState("refreshing");
    try {
      await props.onRefreshInsights();
      setManualRefreshState("idle");
    } catch {
      setManualRefreshState("error");
    }
  }

  return (
    <div className="page-stack analytics-dashboard">
      <PageHeader
        actions={
          <>
            <Button disabled={manualRefreshState === "refreshing" || props.loading} icon="refresh" onClick={() => void handleManualRefresh()}>
              {manualRefreshState === "refreshing" || props.loading ? "Refreshing..." : "Refresh insights"}
            </Button>
            <Button
              onClick={() =>
                exportAnalyticsReportAsCsv("mss-analytics-report.csv", {
                  posted: props.workspace.posts.filter((post) => post.status === "posted").length,
                  scheduled: props.workspace.posts.filter((post) => post.status === "scheduled").length,
                  failed: props.workspace.posts.filter((post) => post.status === "failed").length,
                  successRate: 0,
                  postsInRange: filteredPosts.length,
                  accounts: visibleAccounts,
                })
              }
              variant="primary"
            >
              Export report
            </Button>
          </>
        }
        description="Client-friendly Facebook and Instagram reporting from account snapshots, post references, and scheduler-managed insight pulls."
        eyebrow="Performance"
        meta={
          <>
            <Badge tone={refreshStatus === "error" ? "bad" : refreshStatus === "partial success" ? "warn" : "good"}>{refreshStatus}</Badge>
            <Badge tone="info">Last refreshed {lastRefreshed ? formatDateTime(lastRefreshed) : "not yet"}</Badge>
            <Badge tone="neutral">Next {nextRefresh ? formatDateTime(nextRefresh) : "not scheduled"}</Badge>
          </>
        }
        title="Analytics"
      />

      <Card className="analytics-filter-card" title="Report filters">
        <div className="analytics-filter-grid">
          <Field label="Date range">
            <select onChange={(event) => setRange(event.target.value as AnalyticsRange)} value={range}>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="month">This month</option>
              <option value="all">All time</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          <Field label="Page/client">
            <select onChange={(event) => setPageFilter(event.target.value === "all" ? "all" : Number(event.target.value))} value={String(pageFilter)}>
              <option value="all">All clients</option>
              {props.workspace.pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
            </select>
          </Field>
          <Field label="Platform">
            <select onChange={(event) => setPlatformFilter(event.target.value as "all" | "facebook" | "instagram")} value={platformFilter}>
              <option value="all">All platforms</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
            </select>
          </Field>
          <Field label="Metric">
            <select onChange={(event) => setMetricFilter(event.target.value)} value={metricFilter}>
              {["views", "engagement", "followers", "reach", "visits", "media_count"].map((metric) => (
                <option key={metric} value={metric}>{formatMetricName(metric)}</option>
              ))}
            </select>
          </Field>
          <Field label="Account search">
            <input onChange={(event) => setAccountSearch(event.target.value)} placeholder="Search account or client" value={accountSearch} />
          </Field>
        </div>
        {range === "custom" ? (
          <div className="inline-actions analytics-date-range">
            <label><span>From</span><input onChange={(event) => setCustomStart(event.target.value)} type="date" value={customStart} /></label>
            <label><span>To</span><input onChange={(event) => setCustomEnd(event.target.value)} type="date" value={customEnd} /></label>
          </div>
        ) : null}
      </Card>

      <section className="stats-grid analytics-executive-grid">
        <StatCard helper="Across selected accounts" label="Total views" value={formatCompactNumber(totalViews)} />
        <StatCard helper="Selected date range" label="Total engagement" value={formatCompactNumber(totalEngagement)} />
        <StatCard helper="Latest available follower counts" label="Followers" value={formatCompactNumber(totalFollowers)} />
        <StatCard helper={bestAccount?.label || "No account data yet"} label="Best account" value={bestAccount ? formatCompactNumber(bestAccount.value) : "-"} />
        <StatCard helper={bestPost ? bestPost.caption.slice(0, 80) : "No platform post references yet"} label="Best post" value={bestPost ? formatCompactNumber((bestPost.views || 0) + (bestPost.engagement || 0)) : "-"} />
        <StatCard helper="Accounts with warnings or missing setup" label="Needs attention" tone={visibleAccounts.some((account) => account.last_error || !account.ready) ? "warn" : "good"} value={String(visibleAccounts.filter((account) => account.last_error || !account.ready).length)} />
      </section>

      <div className="analytics-main-grid">
        <Card description={`${formatMetricName(metricFilter)} by day for the active filter set.`} title="Primary trend">
          <MetricAreaChart data={trendSeries} label={formatMetricName(metricFilter)} />
        </Card>
        <Card description="Filtered Facebook vs Instagram comparison." title="Platform comparison">
          <MetricBarChart items={platformComparison} />
        </Card>
        <Card description="Top accounts for the selected metric." title="Account comparison">
          <MetricBarChart items={accountComparison} />
        </Card>
      </div>

      <div className="analytics-grid">
        <Card title="Views over time">
          <MetricLineChart data={viewsSeries} label="Views" />
        </Card>
        <Card title="Engagement over time">
          <MetricLineChart data={engagementSeries} label="Engagement" tone="good" />
        </Card>
        <Card
          actions={<Button onClick={() => setExplorerOpen(true)}>Open explorer</Button>}
          className="platform-coverage-card"
          description={coverageDescription}
          title="Platform coverage"
        >
          {coverageMode === "insights" ? (
            <ExplorerDisplay
              bars={explorerBars}
              display={explorerDisplay}
              rows={explorerRows}
              series={explorerSeries}
              summary={explorerSummary}
            />
          ) : (
            <button className="chart-card-button" onClick={() => setExplorerOpen(true)} type="button">
              <MetricBarChart items={platformComparison} />
              <span>Open explorer to choose a metric, account/page, date range, and display mode.</span>
            </button>
          )}
        </Card>
      </div>

      {explorerOpen ? (
        <Modal
          description="Choose a page, metric, display mode, and date range. The selected data also renders inside Platform coverage."
          footer={
            <>
              <Button
                disabled={!explorerSeries.length && !explorerBars.length}
                onClick={() =>
                  explorerDisplay === "bar"
                    ? exportChartAsSvg("mss-insight-export.svg", explorerMetric || "Insight export", explorerBars)
                    : exportTimeSeriesAsSvg("mss-insight-export.svg", explorerMetric || "Insight export", explorerSeries)
                }
              >
                Download image
              </Button>
              <Button
                disabled={!explorerRows.length}
                onClick={() => exportInsightsAsCsv("mss-insight-export.csv", explorerRows)}
                variant="primary"
              >
                Download text
              </Button>
              <Button onClick={() => setExplorerOpen(false)} variant="secondary">
                Close
              </Button>
            </>
          }
          onClose={() => setExplorerOpen(false)}
          open={explorerOpen}
          title="Insight explorer"
        >
          <div className="insight-explorer-controls">
            <Field label="Page">
              <select
                onChange={(event) => {
                  setExplorerPageId(Number(event.target.value));
                  setCoverageMode("insights");
                }}
                value={String(explorerPageId ?? "")}
              >
                {props.workspace.pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Insight">
              <select
                onChange={(event) => {
                  setExplorerMetric(event.target.value);
                  setCoverageMode("insights");
                }}
                value={explorerMetric}
              >
                {metricOptions.map((metric) => (
                  <option key={metric} value={metric}>
                    {formatMetricName(metric)} ({metric})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Platform">
              <select
                onChange={(event) => {
                  setExplorerPlatform(event.target.value as "all" | "facebook" | "instagram");
                  setCoverageMode("insights");
                }}
                value={explorerPlatform}
              >
                <option value="all">Facebook and Instagram</option>
                <option value="facebook">Facebook only</option>
                <option value="instagram">Instagram only</option>
              </select>
            </Field>
            <Field label="Date range">
              <select
                onChange={(event) => {
                  setExplorerRange(event.target.value as AnalyticsRange);
                  setCoverageMode("insights");
                }}
                value={explorerRange}
              >
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="month">This month</option>
                <option value="all">All time</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
            {explorerRange === "custom" ? (
              <>
                <Field label="From">
                  <input
                    onChange={(event) => setExplorerCustomStart(event.target.value)}
                    type="date"
                    value={explorerCustomStart}
                  />
                </Field>
                <Field label="To">
                  <input
                    onChange={(event) => setExplorerCustomEnd(event.target.value)}
                    type="date"
                    value={explorerCustomEnd}
                  />
                </Field>
              </>
            ) : null}
            <Field label="Display">
              <select
                onChange={(event) => {
                  setExplorerDisplay(event.target.value as InsightDisplayMode);
                  setCoverageMode("insights");
                }}
                value={explorerDisplay}
              >
                <option value="chart">Chart</option>
                <option value="bar">Bar chart</option>
                <option value="table">Table</option>
                <option value="summary">Summary</option>
                <option value="export">Export</option>
              </select>
            </Field>
          </div>
          <ExplorerDisplay
            bars={explorerBars}
            display={explorerDisplay}
            rows={explorerRows}
            series={explorerSeries}
            summary={explorerSummary}
          />
        </Modal>
      ) : null}

      <Card
        actions={
          <div className="inline-actions">
            <Badge tone="info">{visibleAccounts.length} accounts</Badge>
            <Button disabled={accountPage <= 1} onClick={() => setAccountPage((current) => Math.max(1, current - 1))}>Previous</Button>
            <Button disabled={accountPage >= totalAccountPages} onClick={() => setAccountPage((current) => Math.min(totalAccountPages, current + 1))}>Next</Button>
          </div>
        }
        description="Compact account performance. Select a row for drilldown."
        title="Connected account insights"
      >
        {visibleAccounts.length ? (
          <ResponsiveTable
            columns={[
              { key: "account", label: "Account", render: (account) => <strong>{account.account_name || account.page_name || `${account.platform} account`}</strong> },
              { key: "platform", label: "Platform", render: (account) => <Badge tone={account.platform === "instagram" ? "good" : "info"}>{formatMetricName(account.platform)}</Badge> },
              { key: "page", label: "Client", render: (account) => account.page_name || "Unassigned" },
              { key: "followers", label: "Followers", render: (account) => formatCompactNumber(accountMetricValue(account, "followers", range, customStart, customEnd)) },
              { key: "views", label: "Views", render: (account) => formatCompactNumber(accountMetricValue(account, "views", range, customStart, customEnd)) },
              { key: "engagement", label: "Engagement", render: (account) => formatCompactNumber(accountMetricValue(account, "engagement", range, customStart, customEnd)) },
              { key: "refreshed", label: "Last refreshed", render: (account) => account.last_refreshed_at ? formatDateTime(account.last_refreshed_at) : "Not yet" },
              { key: "state", label: "State", render: (account) => <Badge tone={account.last_error ? "warn" : account.ready ? "good" : "bad"}>{account.last_error ? "Warning" : account.ready ? "Ready" : "Needs setup"}</Badge> },
              { key: "actions", label: "Actions", render: (account) => <Button onClick={() => { setSelectedInsightAccountId(account.id); setAccountTab("overview"); }} variant="ghost">Details</Button> },
            ]}
            getKey={(account) => account.id}
            items={pagedAccounts}
          />
        ) : (
          <EmptyState
            description="Connect Facebook or Instagram accounts, then refresh insights. Missing permissions and empty API responses will show here without breaking the page."
            title="No insight accounts"
          />
        )}
        <p className="table-footnote">Page {accountPage} of {totalAccountPages}. Showing up to {accountPageSize} accounts at a time.</p>
      </Card>

      <Card description="Post-level reporting starts with saved platform post/media IDs. Metrics fill in after platform post insights are available." title="Top posts">
        <ResponsiveTable
          columns={[
            { key: "post", label: "Post", render: (row) => (
              <div className="top-post-cell">
                {row.thumbnail ? <img alt="" src={row.thumbnail} /> : <span className="post-thumb-placeholder" />}
                <div><strong>{row.caption.slice(0, 84)}</strong><small>{row.pageName}</small></div>
              </div>
            ) },
            { key: "platform", label: "Platform", render: (row) => <Badge tone={row.platform === "instagram" ? "good" : "info"}>{formatMetricName(row.platform)}</Badge> },
            { key: "date", label: "Published", render: (row) => row.publishedAt ? formatDateOnly(row.publishedAt) : "No date" },
            { key: "views", label: "Views", render: (row) => row.state === "missing_reference" ? "No platform post reference saved." : formatCompactNumber(row.views) },
            { key: "reach", label: "Reach", render: (row) => row.state === "missing_reference" ? "-" : formatCompactNumber(row.reach) },
            { key: "engagement", label: "Engagement", render: (row) => row.state === "missing_reference" ? "-" : formatCompactNumber(row.engagement) },
            { key: "comments", label: "Comments", render: (row) => formatCompactNumber(row.comments) },
            { key: "shares", label: "Shares", render: (row) => formatCompactNumber(row.shares) },
            { key: "link", label: "Permalink", render: (row) => row.permalink ? <a href={row.permalink} rel="noreferrer" target="_blank">Open</a> : "-" },
          ]}
          getKey={(row) => row.id}
          items={filteredPosts.slice(0, 10)}
        />
      </Card>

      <Card
        actions={<Button onClick={() => setRawOpen((current) => !current)}>{rawOpen ? "Hide raw data" : "View raw data"}</Button>}
        description="Hidden debug/export view. It respects the active dashboard filters."
        title="Raw data"
      >
        {rawOpen ? (
          <div className="raw-data-panel">
            <Button
              disabled={!explorerRows.length}
              onClick={() => exportInsightsAsCsv("mss-raw-insights.csv", explorerRows)}
              variant="primary"
            >
              Export filtered raw CSV
            </Button>
            <InsightRowsTable rows={explorerRows.slice(0, 150)} />
          </div>
        ) : (
          <p className="settings-note">Raw insight rows are hidden by default to keep the report readable.</p>
        )}
      </Card>

      {selectedInsightAccount ? (
        <div className="analytics-drawer-backdrop" role="presentation">
          <aside aria-label="Account analytics detail" className="analytics-drawer">
            <div className="modal-header">
              <div>
                <h2>{selectedInsightAccount.account_name || selectedInsightAccount.page_name || "Selected account"}</h2>
                <p>{formatMetricName(selectedInsightAccount.platform)} - {selectedInsightAccount.page_name || "Unassigned client"}</p>
              </div>
              <IconButton icon="close" label="Close account details" onClick={() => setSelectedInsightAccountId(null)} />
            </div>
            <div className="drawer-summary-grid">
              <StatCard helper="Selected range" label="Views" value={formatCompactNumber(accountMetricValue(selectedInsightAccount, "views", range, customStart, customEnd))} />
              <StatCard helper="Selected range" label="Engagement" value={formatCompactNumber(accountMetricValue(selectedInsightAccount, "engagement", range, customStart, customEnd))} />
              <StatCard helper="Latest value" label="Followers" value={formatCompactNumber(accountMetricValue(selectedInsightAccount, "followers", range, customStart, customEnd))} />
            </div>
            <div className="segmented-control drawer-tabs" aria-label="Account detail tabs">
              {["overview", "trends", "posts", "raw", "errors"].map((tab) => (
                <button
                  aria-pressed={accountTab === tab}
                  className={accountTab === tab ? "active" : ""}
                  key={tab}
                  onClick={() => setAccountTab(tab as typeof accountTab)}
                  type="button"
                >
                  {formatMetricName(tab)}
                </button>
              ))}
            </div>
            {accountTab === "overview" ? (
              <div className="drawer-panel">
                <div className="detail-list">
                  <div><span>Connection</span><strong>{selectedInsightAccount.ready ? "Ready" : "Needs setup"}</strong></div>
                  <div><span>Last refreshed</span><strong>{selectedInsightAccount.last_refreshed_at ? formatDateTime(selectedInsightAccount.last_refreshed_at) : "Not yet"}</strong></div>
                  <div><span>Object ID</span><strong>{selectedInsightAccount.page_id_external || "Missing"}</strong></div>
                </div>
                {selectedInsightAccount.last_error ? <p className="inline-warning">{selectedInsightAccount.last_error}</p> : null}
              </div>
            ) : null}
            {accountTab === "trends" ? <MetricAreaChart data={selectedAccountSeries} label={formatMetricName(metricFilter)} /> : null}
            {accountTab === "posts" ? (
              selectedAccountPosts.length ? (
                <ResponsiveTable
                  columns={[
                    { key: "caption", label: "Post", render: (row) => <strong>{row.caption.slice(0, 80)}</strong> },
                    { key: "date", label: "Published", render: (row) => row.publishedAt ? formatDateOnly(row.publishedAt) : "-" },
                    { key: "reference", label: "Reference", render: (row) => row.platformPostId || "No platform post reference saved." },
                    { key: "link", label: "Permalink", render: (row) => row.permalink ? <a href={row.permalink} rel="noreferrer" target="_blank">Open</a> : "-" },
                  ]}
                  getKey={(row) => row.id}
                  items={selectedAccountPosts.slice(0, 20)}
                />
              ) : <EmptyState description="No post references match this account and date range." title="No account posts" />
            ) : null}
            {accountTab === "raw" ? (
              <InsightRowsTable rows={selectedAccountInsights.map((insight) => ({ account: selectedInsightAccount, insight }))} />
            ) : null}
            {accountTab === "errors" ? (
              <div className="drawer-panel">
                {selectedInsightAccount.last_error ? (
                  <p className="inline-warning">{selectedInsightAccount.last_error}</p>
                ) : (
                  <EmptyState description="No current account-level insight errors are saved." title="No errors" />
                )}
              </div>
            ) : null}
            <div className="modal-footer">
              <Button onClick={() => exportChartAsSvg(`mss-${selectedInsightAccount.id}-insights.svg`, "Account insights", selectedAccountChart)}>Download image</Button>
              <Button onClick={() => exportInsightsAsCsv(`mss-${selectedInsightAccount.id}-insights.csv`, selectedAccountInsights.map((insight) => ({ account: selectedInsightAccount, insight })))} variant="primary">Download CSV</Button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function ActivityPage(props: {
  workspace: WorkspaceData;
  planning: PlanningPagePayload | null;
  query: string;
}) {
  const [viewFilter, setViewFilter] = useState<"all" | "failed" | "manual" | "scheduled" | "planner">("all");
  const allEntries = [
    ...props.workspace.posts.map((post) => ({
      id: `post-${post.id}`,
      title: `Post #${post.id} ${post.status}`,
      detail: post.content || "No post content saved.",
      time: formatDateTime(post.posted_at || post.scheduled_time || post.created_at),
      actor: post.page_name || "Unknown page",
      tone: postTone(post.status),
      kind: "post" as const,
      status: post.status,
      manual: Boolean(post.linkedin_manual.required && !post.linkedin_manual.done),
    })),
    ...(props.planning?.rows.map((row) => {
      const status = rowStatus(row, props.planning?.job_color_rules.required_to_schedule || READY_COLOR);
      return {
        id: `row-${row.id}`,
        title: `Planner row ${status.label}`,
        detail: row.theme || row.post_copy || "Planning row updated.",
        time: formatDateTime(row.updated_at),
        actor: row.designer || props.planning?.page.name || "Planner",
        tone: status.tone,
        kind: "planner" as const,
        status: status.label,
        manual: false,
      };
    }) || []),
  ];
  const entries = allEntries
    .filter((item) => {
      if (viewFilter === "failed") {
        return item.status === "failed";
      }
      if (viewFilter === "manual") {
        return item.manual;
      }
      if (viewFilter === "scheduled") {
        return item.status === "scheduled";
      }
      if (viewFilter === "planner") {
        return item.kind === "planner";
      }
      return true;
    })
    .filter((item) => matchesQuery([item.title, item.detail, item.actor], props.query))
    .slice(0, 20);
  const savedViews: Array<{ label: string; value: typeof viewFilter }> = [
    { label: "All activity", value: "all" },
    { label: "Failed publishing", value: "failed" },
    { label: "Manual LinkedIn", value: "manual" },
    { label: "Scheduled posts", value: "scheduled" },
    { label: "Planner updates", value: "planner" },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        description="Recent posts and planner updates from the API."
        eyebrow="Workspace history"
        title="Activity"
      />
      <div className="activity-layout">
        <Card description="Most recent saved post and planner movement." title="Recent activity">
          {entries.length ? <ActivityFeed items={entries} /> : <EmptyState description="No activity matches your search." title="No activity found" />}
        </Card>
        <Card description="Useful saved views for operational reviews." title="Audit views">
          <div className="saved-view-list">
            {savedViews.map((view) => (
              <button
                aria-pressed={viewFilter === view.value}
                className={viewFilter === view.value ? "saved-view-active" : ""}
                key={view.value}
                onClick={() => setViewFilter(view.value)}
                type="button"
              >
                <span>{view.label}</span>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function NotificationsPage(props: {
  notifications: NotificationItem[];
  query: string;
  onSectionOpen: (section: SectionId) => void;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}) {
  const items = props.notifications.filter((item) =>
    matchesQuery([item.title, item.detail, item.priority], props.query),
  );

  return (
    <div className="page-stack">
      <PageHeader
        actions={<Button onClick={props.onDismissAll} variant="primary">Mark all handled</Button>}
        description="Prioritized alerts derived from failed posts, planner state, tokens, and integration readiness."
        eyebrow="Inbox"
        meta={<Badge tone={items.length ? "bad" : "good"}>{items.length} active</Badge>}
        title="Notifications"
      />
      <div className="notification-layout">
        <Card title="Priority inbox">
          <div className="notification-list">
            {items.length ? (
              items.map((item) => (
                <article className="notification-item unread" key={item.id}>
                  <div>
                    <Badge tone={item.tone}>{item.priority}</Badge>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                  </div>
                  <div className="inline-actions">
                    <Button onClick={() => props.onSectionOpen(item.source)} variant="ghost">Open</Button>
                    <Button onClick={() => props.onDismiss(item.id)} variant="ghost">Done</Button>
                  </div>
                </article>
              ))
            ) : (
              <EmptyState
                description="No unresolved alerts match the current view."
                title="Inbox clear"
              />
            )}
          </div>
        </Card>
        <Card description="Where alerts are coming from." title="Alert sources">
          <BarChart
            items={[
              { label: "Planner", value: props.notifications.filter((item) => item.source === "planner").length, tone: "warn" },
              { label: "Projects", value: props.notifications.filter((item) => item.source === "projects").length, tone: "info" },
              { label: "Settings", value: props.notifications.filter((item) => item.source === "settings").length, tone: "bad" },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

function SettingsPage(props: {
  workspace: WorkspaceData;
  settings: GlobalSettingsPayload | null;
  theme: ThemeMode;
  themePreference: ThemePreference;
  users: UserRecord[];
  onThemePreferenceChange: (preference: ThemePreference) => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onRefresh: () => Promise<void>;
  onInvite: () => void;
}) {
  const [draft, setDraft] = useState<GlobalSettingsPayload | null>(props.settings);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const metaTokenStatus = draft?.meta_global?.configured
    ? `${draft.meta_global.status}${draft.meta_global.time_left_text ? ` - ${draft.meta_global.time_left_text} left` : ""}`
    : "No global Meta token saved";

  useEffect(() => {
    setDraft(props.settings);
    setSaveState("idle");
  }, [props.settings]);

  const hasUnsavedChanges = Boolean(
    draft && props.settings && JSON.stringify(draft) !== JSON.stringify(props.settings),
  );

  useEffect(() => {
    if (hasUnsavedChanges && saveState !== "saving") {
      setSaveState("dirty");
    }
  }, [hasUnsavedChanges, saveState]);

  async function saveDraft(): Promise<void> {
    if (!draft) {
      return;
    }
    setSaveState("saving");
    try {
      await props.onSave({
        app_name: draft.app_name,
        default_post_time: draft.default_post_time,
        timezone: draft.timezone,
        auto_schedule: draft.auto_schedule,
        notification_enabled: draft.notification_enabled,
        live_posting_enabled: draft.live_posting_enabled,
        designer_email_map: draft.designer_email_map,
        facebook_app_id: draft.facebook_app_id,
        facebook_app_secret: draft.facebook_app_secret,
        global_meta_user_token: draft.global_meta_user_token,
        global_linkedin_access_token: draft.global_linkedin_access_token,
        global_linkedin_refresh_token: draft.global_linkedin_refresh_token,
        global_linkedin_token_expires_at: draft.global_linkedin_token_expires_at,
        global_linkedin_refresh_token_expires_at:
          draft.global_linkedin_refresh_token_expires_at,
      });
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <>
            <Badge
              tone={
                saveState === "error"
                  ? "bad"
                  : saveState === "saving" || saveState === "dirty"
                    ? "warn"
                    : saveState === "saved"
                      ? "good"
                      : "neutral"
              }
            >
              {saveState === "dirty"
                ? "Unsaved changes"
                : saveState === "saving"
                  ? "Saving"
                  : saveState === "saved"
                    ? "Saved"
                    : saveState === "error"
                      ? "Save failed"
                      : "No changes"}
            </Badge>
            <Button onClick={props.onInvite}>Invite member</Button>
            <Button disabled={!hasUnsavedChanges || saveState === "saving"} onClick={() => void saveDraft()} variant="primary">
              {saveState === "saving" ? "Saving..." : "Save changes"}
            </Button>
          </>
        }
        description="Workspace defaults, access, integrations, and automation."
        eyebrow="Administration"
        title="Settings"
      />

      {!draft ? (
        <Card>
          <EmptyState
            action={<Button onClick={() => void props.onRefresh()}>Load settings</Button>}
            description="Developer settings are available after loading the settings API."
            title="Settings not loaded"
          />
        </Card>
      ) : (
        <div className="settings-layout">
          <Card description="Global defaults saved in the database." title="Workspace defaults">
            <div className="form-grid">
              <Field label="Workspace name">
                <input
                  onChange={(event) => setDraft((current) => current && { ...current, app_name: event.target.value })}
                  value={draft.app_name}
                />
              </Field>
              <Field label="Timezone">
                <input
                  onChange={(event) => setDraft((current) => current && { ...current, timezone: event.target.value })}
                  value={draft.timezone}
                />
              </Field>
              <Field label="Default publish time">
                <input
                  onChange={(event) =>
                    setDraft((current) => current && { ...current, default_post_time: event.target.value })
                  }
                  type="time"
                  value={draft.default_post_time}
                />
              </Field>
              <Field label="Designer email routing">
                <textarea
                  onChange={(event) =>
                    setDraft((current) => current && { ...current, designer_email_map: event.target.value })
                  }
                  rows={4}
                  value={draft.designer_email_map}
                />
              </Field>
            </div>
          </Card>

          <Card description="Theme preference is saved on this browser and applied immediately." title="Appearance">
            <div className="theme-option-grid" role="radiogroup" aria-label="Theme preference">
              {[
                {
                  value: "system",
                  title: "System",
                  description: "Follow this device automatically.",
                  swatches: ["#ffffff", "#111827"],
                },
                {
                  value: "light",
                  title: "Light",
                  description: "Bright SaaS workspace for daytime use.",
                  swatches: ["#f8fafc", "#2563eb"],
                },
                {
                  value: "dark",
                  title: "Dark",
                  description: "Charcoal workspace with higher contrast.",
                  swatches: ["#070706", "#f5c542"],
                },
              ].map((option) => (
                <button
                  aria-checked={props.themePreference === option.value}
                  className={
                    props.themePreference === option.value
                      ? "theme-option theme-option-active"
                      : "theme-option"
                  }
                  key={option.value}
                  onClick={() => props.onThemePreferenceChange(option.value as ThemePreference)}
                  role="radio"
                  type="button"
                >
                  <span className="theme-option-preview" aria-hidden="true">
                    {option.swatches.map((swatch) => (
                      <span key={swatch} style={{ background: swatch }} />
                    ))}
                  </span>
                  <span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                  </span>
                </button>
              ))}
            </div>
            <p className="settings-note">
              Current resolved theme: <strong>{props.theme}</strong>
            </p>
          </Card>

          <Card description="Automation flags saved in app settings." title="Automation">
            <div className="form-stack">
              <Toggle
                checked={draft.auto_schedule === "true"}
                description="Let the scheduler create queued posts from ready planner rows."
                label="Auto schedule"
                onChange={(checked) =>
                  setDraft((current) => current && { ...current, auto_schedule: String(checked) })
                }
              />
              <Toggle
                checked={draft.notification_enabled === "true"}
                description="Send workflow warning notifications."
                label="Notifications"
                onChange={(checked) =>
                  setDraft((current) => current && { ...current, notification_enabled: String(checked) })
                }
              />
              <Toggle
                checked={draft.live_posting_enabled === "true"}
                description="Allow live platform publishing checks and scheduler publishing."
                label="Live posting"
                onChange={(checked) =>
                  setDraft((current) => current && { ...current, live_posting_enabled: String(checked) })
                }
              />
            </div>
          </Card>

          <Card
            description="Paste a Meta user token here. On save, the backend exchanges it for a long-lived token and propagates it to connected Facebook and Instagram accounts."
            title="Meta token"
          >
            <div className="form-grid">
              <Field label="Facebook App ID">
                <input
                  autoComplete="off"
                  onChange={(event) => setDraft((current) => current && { ...current, facebook_app_id: event.target.value })}
                  value={draft.facebook_app_id}
                />
              </Field>
              <Field label="Facebook App Secret">
                <input
                  autoComplete="off"
                  onChange={(event) => setDraft((current) => current && { ...current, facebook_app_secret: event.target.value })}
                  type="password"
                  value={draft.facebook_app_secret}
                />
              </Field>
              <Field
                hint="Required scopes for insights depend on the account type; see the notes below."
                label="Meta user token"
              >
                <textarea
                  autoComplete="off"
                  onChange={(event) => setDraft((current) => current && { ...current, global_meta_user_token: event.target.value })}
                  rows={5}
                  value={draft.global_meta_user_token}
                />
              </Field>
              <div className="token-status-panel">
                <p className="detail-label">Current Meta token</p>
                <Badge tone={draft.meta_global?.configured ? "good" : "warn"}>{draft.meta_global?.status || "missing"}</Badge>
                <p>{metaTokenStatus}</p>
                <small>
                  Saving a changed token or changed app credentials runs the long-lived token normalization flow.
                </small>
              </div>
            </div>
            <div className="settings-note-list">
              <p><strong>Facebook Page insights:</strong> generate the token with <code>pages_show_list</code>, <code>pages_read_engagement</code>, and <code>read_insights</code>.</p>
              <p><strong>Instagram insights through Facebook Login:</strong> include <code>instagram_basic</code>, <code>instagram_manage_insights</code>, and <code>pages_read_engagement</code>.</p>
              <p><strong>Instagram Login option:</strong> use <code>instagram_business_basic</code> and <code>instagram_business_manage_insights</code>.</p>
            </div>
          </Card>

          <Card description="Users saved in the auth store." title="Team access">
            <ResponsiveTable
              columns={[
                { key: "name", label: "Name", render: (item) => <strong>{item.display_name}</strong> },
                { key: "username", label: "Username", render: (item) => item.username },
                { key: "role", label: "Role", render: (item) => <Badge tone="info">{item.role}</Badge> },
                { key: "status", label: "Status", render: (item) => <Badge tone={item.is_active ? "good" : "warn"}>{item.is_active ? "Active" : "Inactive"}</Badge> },
              ]}
              getKey={(item) => item.username}
              items={props.users}
            />
          </Card>

          <Card description="Global tokens and connected account readiness." title="Integration health">
            <div className="integration-grid">
              <article>
                <div>
                  <strong>Meta</strong>
                  <Badge tone={draft.meta_global?.configured ? "good" : "warn"}>
                    {draft.meta_global?.status || "unknown"}
                  </Badge>
                </div>
                <p>{draft.meta_global?.time_left_text || "No expiry data"}</p>
              </article>
              <article>
                <div>
                  <strong>LinkedIn</strong>
                  <Badge tone={draft.linkedin_global?.configured ? "good" : "warn"}>
                    {draft.linkedin_global?.status || "manual"}
                  </Badge>
                </div>
                <p>{draft.linkedin_global?.time_left_text || "Manual assist mode available"}</p>
              </article>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function HelpPage(props: {
  workspace: WorkspaceData;
  onOpenModal: (modal: ModalId) => void;
  onSectionOpen: (section: SectionId) => void;
  onContactSupport: () => void;
}) {
  const hasPages = props.workspace.pages.length > 0;
  const hasAccounts = props.workspace.pages.some((page) => page.social_accounts.length > 0);
  const hasPlanner = props.workspace.planningSheets.length > 0;
  const hasScheduled = props.workspace.posts.some((post) => post.status === "scheduled");
  const guideActions: Array<{ label: string; action: () => void }> = [
    { label: "Create page", action: () => props.onOpenModal("campaign") },
    {
      label: "Connect account",
      action: () => {
        props.onSectionOpen("projects");
        props.onOpenModal("account");
      },
    },
    {
      label: "Create planner row",
      action: () => {
        props.onSectionOpen("planner");
        props.onOpenModal("post");
      },
    },
    { label: "Schedule post", action: () => props.onSectionOpen("planner") },
    { label: "Fix failed post", action: () => props.onSectionOpen("notifications") },
  ];
  const workflowActions: Array<{ title: string; detail: string; action: () => void }> = [
    { title: "Create page", detail: "Start a new managed client workspace", action: () => props.onOpenModal("campaign") },
    {
      title: "Connect account",
      detail: "Add Facebook, Instagram, LinkedIn, or another platform",
      action: () => {
        props.onSectionOpen("projects");
        props.onOpenModal("account");
      },
    },
    { title: "Plan calendar", detail: "Create dated rows and review upcoming work", action: () => props.onSectionOpen("planner") },
    { title: "Recover failure", detail: "Find failed posts and retry after fixing the cause", action: () => props.onSectionOpen("notifications") },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        description="Guides, system status, and operational support context."
        eyebrow="Guidance"
        actions={<Button onClick={props.onContactSupport} variant="primary">Contact support</Button>}
        title="Help"
      />
      <div className="help-grid">
        <Card description="Short, task-based guides for common workflows." title="Guides">
          <div className="saved-view-list">
            {guideActions.map((guide) => (
              <button key={guide.label} onClick={guide.action} type="button">
                <span>{guide.label}</span>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
        </Card>
        <Card description="A quick readiness path for setting up a usable workspace." title="Onboarding checklist">
          <div className="checklist">
            {[
              ["Create a client page", hasPages],
              ["Connect at least one account", hasAccounts],
              ["Import or create planner rows", hasPlanner],
              ["Schedule the first post", hasScheduled],
            ].map(([label, complete]) => (
              <div className={complete ? "checklist-item checklist-item-complete" : "checklist-item"} key={String(label)}>
                <Badge tone={complete ? "good" : "warn"}>{complete ? "Done" : "Next"}</Badge>
                <strong>{label}</strong>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="help-grid">
        <Card description="Fast routes to the workflows teams use most." title="Common workflows">
          <div className="quick-action-grid">
            {workflowActions.map((workflow) => (
              <button key={workflow.title} onClick={workflow.action} type="button">
                <Icon name="chevron" />
                <span>
                  <strong>{workflow.title}</strong>
                  <small>{workflow.detail}</small>
                </span>
              </button>
            ))}
          </div>
        </Card>
        <Card description="Current backend state from the scheduler API." title="System status">
          <div className="detail-list">
            <div>
              <span>Scheduler</span>
              <strong>{props.workspace.scheduler.running ? "Running" : "Stopped"}</strong>
            </div>
            <div>
              <span>Jobs</span>
              <strong>{props.workspace.scheduler.scheduled_jobs}</strong>
            </div>
            <div>
              <span>Queued posts</span>
              <strong>{props.workspace.scheduler.queued_posts.length}</strong>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function MediaThumb(props: { src: string | null; alt: string; size?: "normal" | "large" }) {
  return (
    <div className={props.size === "large" ? "media-thumb media-thumb-large" : "media-thumb"}>
      {props.src ? <img alt={props.alt} src={props.src} /> : <img alt="MSS logo" src={LOGO_SRC} />}
    </div>
  );
}

function AccountRow(props: { account: SocialAccount }) {
  return (
    <article className="account-row">
      <div>
        <strong>{props.account.account_name || props.account.platform}</strong>
        <span>{props.account.platform}</span>
      </div>
      <Badge tone={props.account.is_active ? "good" : "warn"}>
        {props.account.is_active ? "Active" : "Inactive"}
      </Badge>
    </article>
  );
}

function PlannerEventRow(props: { event: PlannerEvent; action?: React.ReactNode }) {
  return (
    <article className="planner-row">
      <div className="planner-time">{props.event.time}</div>
      <div className="planner-content">
        <div className="planner-event-title">
          <MediaThumb alt={props.event.title} src={props.event.mediaUrl || null} />
          <div>
            <strong>{props.event.title}</strong>
            <span>{props.event.pageName}</span>
          </div>
        </div>
        <div className="chip-row">
          {props.event.platforms.length ? (
            props.event.platforms.slice(0, 4).map((platform) => (
              <span className="chip" key={platform}>
                {platform}
              </span>
            ))
          ) : (
            <span className="chip">No platform</span>
          )}
        </div>
      </div>
      <div className="planner-row-actions">
        <Badge tone={props.event.tone}>{props.event.status}</Badge>
        {props.action}
      </div>
    </article>
  );
}

function PlannerEventActions(props: {
  event: PlannerEvent;
  onPreview: (event: PlannerEvent) => void;
  onDuplicateRow: (row: PlanningRowRecord) => Promise<void>;
  onDeletePost: (post: PostRecord) => Promise<void>;
  onManualComplete: (post: PostRecord) => Promise<void>;
  onRetryPost: (post: PostRecord) => Promise<void>;
  onSchedule: (row: PlanningRowRecord) => Promise<void>;
}) {
  const event = props.event;
  const isFailed = event.post?.status === "failed";
  const isManualPending = event.post?.status === "manual_pending" || Boolean(event.post?.linkedin_manual.required && !event.post.linkedin_manual.done);

  return (
    <div className="post-action-strip">
      <Button onClick={() => props.onPreview(event)} variant="ghost">
        Preview
      </Button>
      {event.row && !event.row.scheduled_post_id && !event.row.is_non_actionable ? (
        <Button onClick={() => props.onSchedule(event.row as PlanningRowRecord)} variant="ghost">
          Schedule
        </Button>
      ) : null}
      {event.row ? (
        <Button onClick={() => props.onDuplicateRow(event.row as PlanningRowRecord)} variant="ghost">
          Duplicate
        </Button>
      ) : null}
      {isManualPending && event.post ? (
        <Button onClick={() => props.onManualComplete(event.post as PostRecord)} variant="ghost">
          Mark posted
        </Button>
      ) : null}
      {isFailed && event.post ? (
        <>
          <Button onClick={() => props.onPreview(event)} variant="ghost">
            View error
          </Button>
          <Button onClick={() => props.onRetryPost(event.post as PostRecord)} variant="ghost">
            Retry
          </Button>
        </>
      ) : null}
      {event.post ? (
        <Button onClick={() => props.onDeletePost(event.post as PostRecord)} variant="danger">
          Delete
        </Button>
      ) : null}
    </div>
  );
}

function CalendarGrid(props: {
  days: Date[];
  events: PlannerEvent[];
  monthKey: string;
  mode: CalendarMode;
  onCreatePost: (dateKey: string) => void;
  draggingEventId: string | null;
  onEventDragStart: (event: PlannerEvent) => void;
  onEventDragEnd: () => void;
  onEventDrop: (event: PlannerEvent, dateKey: string) => Promise<void>;
}) {
  const eventsByDate = new Map<string, PlannerEvent[]>();
  props.events.forEach((event) => {
    const current = eventsByDate.get(event.dateKey) || [];
    current.push(event);
    eventsByDate.set(event.dateKey, current);
  });

  return (
    <div className={props.mode === "week" ? "calendar-grid calendar-grid-week" : "calendar-grid"}>
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
        <div className="calendar-head" key={day}>
          {day}
        </div>
      ))}
      {props.days.map((day) => {
        const key = toDateKey(day);
        const items = eventsByDate.get(key) || [];
        const outside = key.slice(0, 7) !== props.monthKey;
        return (
          <div
            aria-label={`Create planner row on ${key}`}
            className={[
              outside ? "calendar-cell calendar-cell-muted" : "calendar-cell",
              props.draggingEventId ? "calendar-cell-drop-target" : "",
            ].filter(Boolean).join(" ")}
            key={key}
            onClick={() => props.onCreatePost(key)}
            onDragOver={(event) => {
              if (props.draggingEventId) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const eventId = event.dataTransfer.getData("text/plain");
              const dragged = props.events.find((item) => item.id === eventId);
              if (dragged) {
                void props.onEventDrop(dragged, key);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                props.onCreatePost(key);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <span className="calendar-date">{day.getDate()}</span>
            <div className="calendar-events">
              {items.slice(0, props.mode === "week" ? 6 : 3).map((event) => (
                <button
                  aria-label={`Move ${event.title}`}
                  className={[
                    `calendar-event calendar-event-${event.tone}`,
                    props.draggingEventId === event.id ? "calendar-event-dragging" : "",
                  ].filter(Boolean).join(" ")}
                  draggable
                  key={event.id}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                  }}
                  onDragEnd={props.onEventDragEnd}
                  onDragStart={(dragEvent) => {
                    dragEvent.stopPropagation();
                    dragEvent.dataTransfer.effectAllowed = "move";
                    dragEvent.dataTransfer.setData("text/plain", event.id);
                    props.onEventDragStart(event);
                  }}
                  type="button"
                >
                  <span>{event.time}</span>
                  <strong>{event.title}</strong>
                </button>
              ))}
              {items.length > (props.mode === "week" ? 6 : 3) ? (
                <small>+{items.length - (props.mode === "week" ? 6 : 3)} more</small>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BarChart(props: { items: ChartItem[] }) {
  const maxValue = Math.max(1, ...props.items.map((item) => item.value));
  return (
    <div className="metric-chart">
      {props.items.length ? (
        props.items.map((item) => (
          <div className="metric-bar-row" key={item.label}>
            <span>{item.label}</span>
            <div className="metric-bar-track">
              <div
                className={`metric-bar metric-bar-${item.tone || "info"}`}
                style={{ width: `${Math.max(4, (item.value / maxValue) * 100)}%` }}
              />
            </div>
            <strong>{item.value}</strong>
          </div>
        ))
      ) : (
        <EmptyState description="No saved data is available for this chart yet." title="No chart data" />
      )}
    </div>
  );
}

function chartStroke(tone?: "neutral" | "good" | "warn" | "bad" | "info"): string {
  if (tone === "good") {
    return "#22c55e";
  }
  if (tone === "warn") {
    return "#f5c542";
  }
  if (tone === "bad") {
    return "#ef4444";
  }
  if (tone === "neutral") {
    return "#94a3b8";
  }
  return "#38bdf8";
}

function EmptyChartState(props: { label?: string }) {
  return (
    <div className="empty-chart-state">
      <strong>No chart data</strong>
      <span>{props.label || "No supported insight rows match this filter yet."}</span>
    </div>
  );
}

type ChartPoint = TimeSeriesPoint & { x: number; y: number };

function chartHoverIndex(
  event: MouseEvent<SVGSVGElement>,
  width: number,
  points: ChartPoint[],
): number | null {
  if (!points.length) {
    return null;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * width;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const distance = Math.abs(point.x - x);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function ChartHoverOverlay(props: {
  point: ChartPoint | null;
  height: number;
  padY: number;
  stroke: string;
  label: string;
}) {
  if (!props.point) {
    return null;
  }
  const tooltipX = Math.min(Math.max(props.point.x - 42, 62), 510);
  const tooltipY = Math.max(props.padY + 6, props.point.y - 76);
  return (
    <g className="chart-hover-layer">
      <line
        className="chart-hover-line"
        x1={props.point.x}
        x2={props.point.x}
        y1={props.padY}
        y2={props.height - props.padY}
      />
      <circle className="chart-hover-point" cx={props.point.x} cy={props.point.y} fill={props.stroke} r={6} />
      <g transform={`translate(${tooltipX} ${tooltipY})`}>
        <rect className="chart-tooltip-box" height="58" rx="8" width="118" />
        <text className="chart-tooltip-date" x="12" y="20">{formatDateOnly(props.point.date)}</text>
        <text className="chart-tooltip-label" x="12" y="38">{props.label}</text>
        <text className="chart-tooltip-value" x="12" y="54">{formatCompactNumber(props.point.value)}</text>
      </g>
    </g>
  );
}

function ChartMetaBar(props: { data: TimeSeriesPoint[] }) {
  const meta = seriesMeta(props.data);
  return (
    <div className="chart-meta-bar">
      <span>{compactDateRange(meta.start, meta.end)}</span>
      <span>Total: {formatCompactNumber(meta.total)}</span>
      <span>{meta.days} day{meta.days === 1 ? "" : "s"}</span>
    </div>
  );
}

function MetricLineChart(props: { data: TimeSeriesPoint[]; label: string; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  const data = Array.isArray(props.data) ? props.data.filter((point) => Number.isFinite(point.value)) : [];
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  if (!data.length) {
    return <EmptyChartState />;
  }
  const width = 640;
  const height = 260;
  const padX = 74;
  const padY = 28;
  const maxValue = Math.max(1, ...data.map((point) => point.value));
  const minValue = Math.min(0, ...data.map((point) => point.value));
  const xStep = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const scaleY = (value: number) => height - padY - ((value - minValue) / (maxValue - minValue || 1)) * (height - padY * 2);
  const points = data.map((point, index) => ({
    ...point,
    x: padX + index * xStep,
    y: scaleY(point.value),
  }));
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const stroke = chartStroke(props.tone);
  const hoverPoint = hoverIndex === null ? null : points[Math.min(hoverIndex, points.length - 1)] || null;
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="metric-svg-shell">
      <ChartMetaBar data={data} />
      <svg
        className="metric-svg-chart"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => setHoverIndex(chartHoverIndex(event, width, points))}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{props.label}</title>
        <text className="chart-axis-title" transform={`rotate(-90 17 ${height / 2})`} x="17" y={height / 2}>
          {props.label}
        </text>
        {points.map((point, index) => (
          <line
            className={index === hoverIndex ? "chart-day-line chart-day-line-active" : "chart-day-line"}
            key={`day-${point.date}-${index}`}
            x1={point.x}
            x2={point.x}
            y1={padY}
            y2={height - padY}
          />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padY + ratio * (height - padY * 2);
          const value = Math.round(maxValue - ratio * (maxValue - minValue));
          return (
            <g key={ratio}>
              <line className="chart-grid-line" x1={padX} x2={width - padX} y1={y} y2={y} />
              <text className="chart-axis-label" x={30} y={y + 4}>{formatCompactNumber(value)}</text>
            </g>
          );
        })}
        <path className="chart-line" d={path} stroke={stroke} />
        {points.map((point, index) => (
          <g key={`${point.date}-${index}`}>
            <circle className="chart-point" cx={point.x} cy={point.y} fill={stroke} r={4}>
              <title>{`${formatDateOnly(point.date)}: ${formatCompactNumber(point.value)}`}</title>
            </circle>
            {(index === 0 || index === points.length - 1 || index % labelEvery === 0) ? (
              <text className="chart-axis-label" textAnchor="middle" x={point.x} y={height - 6}>{formatDateOnly(point.date).slice(0, 6)}</text>
            ) : null}
          </g>
        ))}
        <ChartHoverOverlay height={height} label={props.label} padY={padY} point={hoverPoint} stroke={stroke} />
      </svg>
    </div>
  );
}

function MetricAreaChart(props: { data: TimeSeriesPoint[]; label: string; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  const data = Array.isArray(props.data) ? props.data.filter((point) => Number.isFinite(point.value)) : [];
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  if (!data.length) {
    return <EmptyChartState />;
  }
  const width = 640;
  const height = 260;
  const padX = 74;
  const padY = 28;
  const maxValue = Math.max(1, ...data.map((point) => point.value));
  const minValue = Math.min(0, ...data.map((point) => point.value));
  const xStep = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const scaleY = (value: number) => height - padY - ((value - minValue) / (maxValue - minValue || 1)) * (height - padY * 2);
  const points = data.map((point, index) => ({ ...point, x: padX + index * xStep, y: scaleY(point.value) }));
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const area = `${line} L ${points[points.length - 1].x} ${height - padY} L ${points[0].x} ${height - padY} Z`;
  const stroke = chartStroke(props.tone || "warn");
  const hoverPoint = hoverIndex === null ? null : points[Math.min(hoverIndex, points.length - 1)] || null;
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="metric-svg-shell">
      <ChartMetaBar data={data} />
      <svg
        className="metric-svg-chart"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => setHoverIndex(chartHoverIndex(event, width, points))}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{props.label}</title>
        <text className="chart-axis-title" transform={`rotate(-90 17 ${height / 2})`} x="17" y={height / 2}>
          {props.label}
        </text>
        <defs>
          <linearGradient id={`area-${props.label.replace(/\W/g, "")}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.38" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {points.map((point, index) => (
          <line
            className={index === hoverIndex ? "chart-day-line chart-day-line-active" : "chart-day-line"}
            key={`area-day-${point.date}-${index}`}
            x1={point.x}
            x2={point.x}
            y1={padY}
            y2={height - padY}
          />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padY + ratio * (height - padY * 2);
          const value = Math.round(maxValue - ratio * (maxValue - minValue));
          return (
            <g key={ratio}>
              <line className="chart-grid-line" x1={padX} x2={width - padX} y1={y} y2={y} />
              <text className="chart-axis-label" x={30} y={y + 4}>{formatCompactNumber(value)}</text>
            </g>
          );
        })}
        <path d={area} fill={`url(#area-${props.label.replace(/\W/g, "")})`} />
        <path className="chart-line" d={line} stroke={stroke} />
        {points.map((point, index) => (
          <g key={`${point.date}-${index}`}>
            <circle className="chart-point" cx={point.x} cy={point.y} fill={stroke} r={4}>
              <title>{`${formatDateOnly(point.date)}: ${formatCompactNumber(point.value)}`}</title>
            </circle>
            {(index === 0 || index === points.length - 1 || index % labelEvery === 0) ? (
              <text className="chart-axis-label" textAnchor="middle" x={point.x} y={height - 6}>{formatDateOnly(point.date).slice(0, 6)}</text>
            ) : null}
          </g>
        ))}
        <ChartHoverOverlay height={height} label={props.label} padY={padY} point={hoverPoint} stroke={stroke} />
      </svg>
    </div>
  );
}

function MetricBarChart(props: { items: ComparisonPoint[] }) {
  const items = Array.isArray(props.items) ? props.items.slice(0, 10) : [];
  if (!items.length) {
    return <EmptyChartState />;
  }
  const width = 640;
  const rowHeight = 34;
  const height = Math.max(180, 44 + items.length * rowHeight);
  const maxValue = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="metric-svg-shell">
      <svg className="metric-svg-chart metric-svg-bars" role="img" viewBox={`0 0 ${width} ${height}`}>
        <title>Metric comparison</title>
        {items.map((item, index) => {
          const y = 24 + index * rowHeight;
          const barWidth = Math.max(2, (item.value / maxValue) * 370);
          return (
            <g key={`${item.label}-${index}`}>
              <text className="chart-bar-label" x={16} y={y + 16}>{item.label.slice(0, 28)}</text>
              <rect className="chart-bar-track" height="14" rx="5" width="370" x="210" y={y + 3} />
              <rect fill={chartStroke(item.tone)} height="14" rx="5" width={barWidth} x="210" y={y + 3}>
                <title>{`${item.label}: ${formatCompactNumber(item.value)}`}</title>
              </rect>
              <text className="chart-bar-value" x={592} y={y + 16}>{formatCompactNumber(item.value)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ExplorerDisplay(props: {
  display: InsightDisplayMode;
  rows: Array<{ account: AnalyticsAccountRecord; insight: SocialInsightRecord }>;
  series: TimeSeriesPoint[];
  bars: ComparisonPoint[];
  summary: { total: number; previousTotal: number; delta: number; previousLabel: string; latest: number | null };
}) {
  return (
    <div className="coverage-insight-panel">
      <div className="coverage-insight-summary">
        <Badge tone={props.rows.length ? "good" : "warn"}>{props.rows.length} matching rows</Badge>
        <span>{props.display === "chart" ? "Line chart" : props.display === "bar" ? "Bar chart" : formatMetricName(props.display)}</span>
      </div>
      {props.display === "chart" ? <MetricLineChart data={props.series} label="Explorer metric" tone="warn" /> : null}
      {props.display === "bar" ? <MetricBarChart items={props.bars} /> : null}
      {props.display === "table" ? <MetricTotalsTable items={props.bars} /> : null}
      {props.display === "summary" ? (
        <div className="analytics-summary-grid">
          <StatCard helper="Selected date range" label="Total" value={formatCompactNumber(props.summary.total)} />
          <StatCard helper={props.summary.previousLabel} label="Previous period" value={formatCompactNumber(props.summary.previousTotal)} />
          <StatCard
            helper="Current minus previous"
            label="Change"
            tone={props.summary.delta >= 0 ? "good" : "warn"}
            value={formatCompactNumber(props.summary.delta)}
          />
        </div>
      ) : null}
      {props.display === "export" ? (
        <div className="drawer-panel">
          <MetricLineChart data={props.series} label="Explorer metric" tone="warn" />
          <Button disabled={!props.rows.length} onClick={() => exportInsightsAsCsv("mss-selected-insights.csv", props.rows)} variant="primary">
            Download selected CSV
          </Button>
          <Button disabled={!props.series.length} onClick={() => exportTimeSeriesAsSvg("mss-selected-insights.svg", "Selected insights", props.series)}>
            Download chart image
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function MetricTotalsTable(props: { items: ComparisonPoint[] }) {
  const items = Array.isArray(props.items) ? props.items : [];
  if (!items.length) {
    return <EmptyState description="No totals match this explorer filter." title="No totals" />;
  }
  return (
    <ResponsiveTable
      columns={[
        { key: "segment", label: "Segment", render: (item) => <strong>{item.label}</strong> },
        { key: "total", label: "Total", render: (item) => formatCompactNumber(item.value) },
      ]}
      getKey={(item) => item.label}
      items={items}
    />
  );
}

function InsightRowsTable(props: {
  rows: Array<{ account: AnalyticsAccountRecord; insight: SocialInsightRecord }>;
}) {
  const rows = props.rows
    .slice()
    .sort((a, b) => {
      const aDate = insightDate(a.insight)?.getTime() || 0;
      const bDate = insightDate(b.insight)?.getTime() || 0;
      return bDate - aDate;
    });

  if (!rows.length) {
    return (
      <EmptyState
        description="No insight records match the current account, metric, and date range."
        title="No matching insights"
      />
    );
  }

  return (
    <ResponsiveTable
      columns={[
        {
          key: "metric",
          label: "Metric",
          render: (row) => <strong>{row.insight.metric_name}</strong>,
        },
        {
          key: "account",
          label: "Account",
          render: (row) => row.account.account_name || row.account.page_name || row.account.platform,
        },
        {
          key: "value",
          label: "Value",
          render: (row) => row.insight.metric_value ?? "Unavailable",
        },
        {
          key: "period",
          label: "Period",
          render: (row) => row.insight.period || "unknown",
        },
        {
          key: "date",
          label: "Date",
          render: (row) => formatDateOnly(row.insight.end_date || row.insight.start_date || row.insight.refreshed_at),
        },
        {
          key: "state",
          label: "State",
          render: (row) => (
            <Badge tone={row.insight.error_message ? "warn" : row.insight.metric_value === null ? "neutral" : "good"}>
              {row.insight.error_message ? "Error" : row.insight.metric_value === null ? "Unavailable" : "Ready"}
            </Badge>
          ),
        },
      ]}
      getKey={(row) => row.insight.id}
      items={rows}
    />
  );
}

function ActivityFeed(props: {
  items: Array<{
    id: string;
    title: string;
    detail: string;
    time: string;
    actor: string;
    tone: "neutral" | "good" | "warn" | "bad" | "info";
  }>;
}) {
  return (
    <div className="activity-feed">
      {props.items.map((item) => (
        <article className="activity-entry" key={item.id}>
          <span className={`activity-dot activity-dot-${item.tone}`} />
          <div>
            <div className="activity-entry-top">
              <strong>{item.title}</strong>
              <span>{item.time}</span>
            </div>
            <p>{item.detail}</p>
            <small>{item.actor}</small>
          </div>
        </article>
      ))}
    </div>
  );
}

function CreatePageModal(props: {
  open: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => Promise<void>;
}) {
  return (
    <Modal
      description="Create a client page/project. A planner sheet is created by the backend automatically."
      footer={
        <>
          <Button onClick={props.onClose} variant="secondary">Cancel</Button>
          <Button form="create-page-form" type="submit" variant="primary">Create page</Button>
        </>
      }
      onClose={props.onClose}
      open={props.open}
      title="Create page"
    >
      <form
        className="form-grid"
        id="create-page-form"
        onSubmit={(event) => {
          event.preventDefault();
          void props.onSubmit(new FormData(event.currentTarget));
        }}
      >
        <Field label="Page name">
          <input name="name" required />
        </Field>
        <Field label="LinkedIn URL">
          <input name="linkedin_page_url" />
        </Field>
        <Field label="Description">
          <textarea name="description" rows={4} />
        </Field>
        <Field label="Page image">
          <input accept="image/*" name="image" type="file" />
        </Field>
      </form>
    </Modal>
  );
}

function CreatePlannerRowModal(props: {
  open: boolean;
  page: PageRecord | null;
  defaultDate: string;
  defaultMonth: string;
  designerOptions: string[];
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <Modal
      description={props.page ? `Add a calendar row for ${props.page.name}.` : "Select a page first."}
      footer={
        <>
          <Button onClick={props.onClose} variant="secondary">Cancel</Button>
          <Button disabled={!props.page} form="create-row-form" type="submit" variant="primary">Save row</Button>
        </>
      }
      onClose={props.onClose}
      open={props.open}
      title="New planner row"
    >
      <form
        className="form-grid"
        id="create-row-form"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          void props.onSubmit({
            planning_month: String(formData.get("date_value") || props.defaultDate).slice(0, 7) || props.defaultMonth,
            date_value: String(formData.get("date_value") || props.defaultDate),
            time_value: String(formData.get("time_value") || ""),
            theme: String(formData.get("theme") || ""),
            post_copy: String(formData.get("post_copy") || ""),
            format: String(formData.get("format") || ""),
            designer: String(formData.get("designer") || ""),
            job_color: String(formData.get("job_color") || "#D9D9D9"),
          });
        }}
      >
        <Field label="Date">
          <input defaultValue={props.defaultDate} name="date_value" type="date" />
        </Field>
        <Field label="Time">
          <input name="time_value" type="time" />
        </Field>
        <Field label="Theme">
          <input name="theme" required />
        </Field>
        <Field label="Format">
          <input name="format" placeholder="Carousel, image, video" />
        </Field>
        <Field label="Designer">
          <select name="designer">
            <option value="">Unassigned</option>
            {props.designerOptions.map((designer) => (
              <option key={designer} value={designer}>{designer}</option>
            ))}
          </select>
        </Field>
        <Field label="Readiness color">
          <input defaultValue="#D9D9D9" name="job_color" type="color" />
        </Field>
        <Field label="Post copy">
          <textarea name="post_copy" rows={5} />
        </Field>
      </form>
    </Modal>
  );
}

function ConnectAccountModal(props: {
  open: boolean;
  page: PageRecord | null;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <Modal
      description={props.page ? `Connect a platform account to ${props.page.name}.` : "Select a page first."}
      footer={
        <>
          <Button onClick={props.onClose} variant="secondary">Cancel</Button>
          <Button disabled={!props.page} form="connect-account-form" type="submit" variant="primary">Connect account</Button>
        </>
      }
      onClose={props.onClose}
      open={props.open}
      title="Connect account"
    >
      <form
        className="form-grid"
        id="connect-account-form"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          void props.onSubmit({
            platform: String(formData.get("platform") || "facebook"),
            account_name: String(formData.get("account_name") || ""),
            page_id_external: String(formData.get("page_id_external") || ""),
            access_token: String(formData.get("access_token") || ""),
            refresh_token: String(formData.get("refresh_token") || ""),
            is_active: true,
          });
        }}
      >
        <Field label="Platform">
          <select name="platform">
            {PLATFORM_OPTIONS.map((platform) => (
              <option key={platform} value={platform}>{platform}</option>
            ))}
          </select>
        </Field>
        <Field label="Account name">
          <input name="account_name" />
        </Field>
        <Field label="External page/account ID">
          <input name="page_id_external" />
        </Field>
        <Field label="Access token">
          <textarea name="access_token" rows={4} />
        </Field>
        <Field label="Refresh token">
          <textarea name="refresh_token" rows={4} />
        </Field>
      </form>
    </Modal>
  );
}

function InviteMemberModal(props: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <Modal
      description="Create a user in the auth store."
      footer={
        <>
          <Button onClick={props.onClose} variant="secondary">Cancel</Button>
          <Button form="invite-member-form" type="submit" variant="primary">Create user</Button>
        </>
      }
      onClose={props.onClose}
      open={props.open}
      title="Invite teammate"
    >
      <form
        className="form-grid"
        id="invite-member-form"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          void props.onSubmit({
            username: String(formData.get("username") || "").trim(),
            display_name: String(formData.get("display_name") || "").trim(),
            email: String(formData.get("email") || "").trim(),
            role: String(formData.get("role") || "designer"),
            password: String(formData.get("password") || ""),
            is_active: true,
          });
        }}
      >
        <Field label="Username">
          <input name="username" required />
        </Field>
        <Field label="Display name">
          <input name="display_name" required />
        </Field>
        <Field label="Email">
          <input name="email" type="email" />
        </Field>
        <Field label="Role">
          <select name="role">
            <option value="developer">developer</option>
            <option value="admin">admin</option>
            <option value="designer">designer</option>
          </select>
        </Field>
        <Field label="Password">
          <input minLength={8} name="password" required type="password" />
        </Field>
      </form>
    </Modal>
  );
}
