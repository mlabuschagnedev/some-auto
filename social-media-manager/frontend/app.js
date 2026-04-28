const API_BASE = `${window.location.origin}/api`;
const STORAGE_KEY = "mss_some_auto_session";
const TABS = ["pages", "scheduled", "posted", "planning", "settings", "integrations"];
const PLATFORMS = ["facebook", "instagram", "linkedin", "twitter", "pinterest"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PLANNING_LAYOUT_KEY_PREFIX = "mss_planning_layout_";
const PLANNING_READY_COLOR = "#34A853";
const PLANNING_SCHEDULED_COLOR = "#0B57D0";
const PLANNING_POSTED_COLOR = "#666666";
const INSTAGRAM_IMAGE_RATIO_MIN = 4 / 5;
const INSTAGRAM_IMAGE_RATIO_MAX = 1.91;
const INSTAGRAM_CROP_PRESETS = [
  { id: "portrait", label: "Portrait 4:5", ratio: 4 / 5 },
  { id: "square", label: "Square 1:1", ratio: 1 },
  { id: "landscape", label: "Landscape 1.91:1", ratio: 1.91 },
];
const PAGE_REFERENCE_SHEETS = [
  { key: "contact_info", label: "Contact info" },
  { key: "login_details", label: "Login details" },
];
const PAGE_REFERENCE_FONT_SIZES = [12, 14, 16, 18, 24, 32];
const LINKEDIN_MANUAL_POLL_MS = 30000;
let planningCreativeTempSeed = 0;
let linkedinManualPollHandle = null;

const PLANNING_JOB_COLORS = [
  { hex: "#D9D9D9", label: "planning" },
  { hex: PLANNING_POSTED_COLOR, label: "job complete" },
  { hex: "#4285F4", label: "waiting for approval" },
  { hex: "#9FC5FF", label: "other instructions" },
  { hex: "#FBBC04", label: "content approved" },
  { hex: "#FF6D01", label: "design started" },
  { hex: "#34A853", label: "content approved, schedule post" },
  { hex: "#137333", label: "Image has been sent to Reviewer." },
  { hex: "#0B57D0", label: "Post in scheduler" },
  { hex: "#980000", label: "stop post" },
  { hex: "#9900FF", label: "share" },
];

const PLANNING_COLUMNS = [
  { key: "linked_accounts", label: "Linked Accounts", width: 170, type: "textarea", rows: 3 },
  { key: "job_nr", label: "Job Nr", width: 120, type: "text" },
  { key: "date_value", label: "Date", width: 140, type: "date" },
  { key: "time_value", label: "Time", width: 110, type: "time" },
  { key: "theme", label: "Theme", width: 170, type: "text" },
  { key: "post_copy", label: "Post Copy", width: 360, type: "textarea", rows: 4 },
  { key: "link", label: "Link", width: 220, type: "text" },
  { key: "format", label: "Format", width: 120, type: "text" },
  { key: "final_creative", label: "Final Creative", width: 300, type: "textarea", rows: 4 },
  { key: "deadline", label: "Deadline", width: 140, type: "date" },
  { key: "mss_notes", label: "MSS Notes", width: 240, type: "textarea", rows: 4 },
  { key: "creative_media", label: "Creative", width: 220, type: "media" },
  { key: "designer", label: "Designer", width: 140, type: "select" },
  { key: "schedule_action", label: "Schedule", width: 170, type: "action" },
];
const PLANNING_EDITABLE_COLUMNS = PLANNING_COLUMNS.filter(
  (column) => !["media", "action"].includes(column.type)
).map((column) => column.key);

const FAQ_ITEMS = [
  {
    question: "How do I connect a social account safely?",
    answer:
      "Use the Pages tab, add the account credentials, then run Test Connection. Keep live posting disabled until all checks pass in Integrations.",
  },
  {
    question: "Can I edit posts after scheduling?",
    answer:
      "Planner rows are the source of truth. Create or change posts in the Planning page, then re-schedule there if needed. The queue/history views are for monitoring and backend cleanup, not direct post editing or publishing.",
  },
  {
    question: "Why do Instagram/Pinterest posts require PUBLIC_BASE_URL?",
    answer:
      "Those APIs need externally reachable media URLs. Sample SoMe-Auto creates signed temporary links from your uploads when PUBLIC_BASE_URL is configured.",
  },
  {
    question: "What does live_posting_enabled do?",
    answer:
      "false = safe simulation only. true = real provider API calls. Keep it false while onboarding credentials.",
  },
  {
    question: "How does token refresh work?",
    answer:
      "Facebook and Instagram now use one global Meta user token from Settings. Sample SoMe-Auto exchanges that token immediately, warns when it has less than 3 days left, re-derives Facebook Page tokens from it, and applies it automatically to Instagram accounts so the admin only rotates one Meta token in one place.",
  },
  {
    question: "What Meta Graph API details do I need?",
    answer:
      "Create a Meta app in the Meta for Developers dashboard, add Facebook Login plus the Facebook/Instagram permissions you need, store the Facebook App ID and App Secret once in Global Settings, generate a Meta user token in your OAuth flow or Graph API Explorer, then paste that token into Global Settings. Facebook page setup only needs the Facebook Page ID, and Instagram setup only needs the Instagram business account ID. Sample SoMe-Auto exchanges the Meta token automatically and uses it to derive Facebook Page tokens.",
  },
  {
    question: "How do I get LinkedIn API credentials?",
    answer:
      "LinkedIn API automation is paused in this build. Add LinkedIn as a page platform, store the page URL in the page editor, then use the Scheduled Queue manual-assist card to copy text, download creatives, open the LinkedIn page, and mark the task done after you schedule it manually.",
  },
  {
    question: "How do I get X API keys and tokens?",
    answer:
      "Create a Project and App in the X developer portal, enable Read and Write permissions, generate OAuth 1.0a user credentials, then paste the API key, API secret, access token, and access token secret into the X account form. This implementation expects all four values.",
  },
  {
    question: "How do I get Pinterest API details?",
    answer:
      "Create an app in the Pinterest Developers portal, configure scopes and redirect URLs, run the OAuth flow to obtain an access token, then paste that token into the Pinterest account form. Keep PINTEREST_APP_ID and PINTEREST_APP_SECRET on the backend for refresh support, and use a board ID as the external ID if you want posting pinned to a specific board.",
  },
  {
    question: "How do I get TikTok API details?",
    answer:
      "Create an app in TikTok for Developers, add the Login Kit or Content Posting products you need, configure redirect URLs, and complete TikTok OAuth to obtain access and refresh tokens plus the creator identifier for the authorized account. Keep the app key and app secret for backend use. TikTok publishing is not wired into this build yet, so this FAQ entry is preparation-only.",
  },
  {
    question: "How do I get Threads API details?",
    answer:
      "Create a Meta app with Threads API access, request the Threads permissions needed for your use case, configure the OAuth redirect URL, and authorize against the Threads account you want to use. Keep the Meta app ID and secret plus the resulting Threads access token and account details ready. Threads publishing is not wired into this build yet, so this FAQ entry is preparation-only.",
  },
  {
    question: "Who can manage data in this app?",
    answer:
      "Any authenticated user in the current deployment can create, edit, delete, schedule, and publish content within configured platform constraints.",
  },
  {
    question: "Why is my media upload failing on publish?",
    answer:
      "Check file size, format support, account permissions, and the Integrations tab warnings. For external-media platforms, verify PUBLIC_BASE_URL reachability.",
  },
  {
    question: "Can managers filter content by page/team?",
    answer:
      "Yes. Scheduled and Posted tabs have left-side page filters with Select All/Deselect All and list/calendar view switching.",
  },
  {
    question: "How should we roll out this app to a team?",
    answer:
      "Start with simulation mode, validate account readiness, train with FAQ, then enable live posting in settings with staged platform rollout.",
  },
  {
    question: "What if a boss asks where something failed?",
    answer:
      "Use Posted tab for failed details, Integrations tab for readiness checks, and token status in Settings for expiry/refresh context.",
  },
];

const state = {
  accessToken: null,
  refreshToken: null,
  user: null,
  users: [],
  designerOptions: [],
  activeTab: "pages",
  pages: [],
  posts: [],
  settings: {},
  schedulerStatus: null,
  tokenStatus: [],
  integrationCheck: null,
  monthlyInsightsSyncResult: null,
  settingsMeta: { scopeType: "global", pageName: null, overrides: {} },
  planningSheets: [],
  planningPageId: null,
  planningMonth: null,
  planningMonthOptions: [],
  planningRows: [],
  planningImportResult: null,
  planningJobColor: "#D9D9D9",
  planningRowHeights: {},
  planningCellHeights: {},
  planningColumnWidths: {},
  planningActiveCell: null,
  filters: {
    scheduled: [],
    posted: [],
  },
  viewMode: {
    scheduled: "list",
    posted: "list",
  },
  calendarMonth: {
    scheduled: monthStart(new Date()),
    posted: monthStart(new Date()),
  },
  calendarSelectedDate: {
    scheduled: null,
    posted: null,
  },
  pageSearch: "",
  settingsScopePageId: null,
  integrationsScopePageId: null,
  createPageOpen: false,
  createPostPageId: null,
  manageConnectionsPageId: null,
  pageReferenceSheetEditor: null,
  editingPageId: null,
  pageEditorSettings: null,
  pageEditorInitialSettings: null,
  editingPostId: null,
  editingAccountId: null,
  planningCreativeEditor: null,
  planningCreativeCropper: null,
  linkedinManualPopupPostId: null,
  linkedinManualPopupDismissedIds: [],
  metaTokenReminderKey: null,
  userEditor: {
    mode: "create",
    username: "",
    display_name: "",
    email: "",
    role: "designer",
    is_active: true,
    password: "",
    is_owner: false,
  },
};

const appEl = document.getElementById("app");

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function currentPlanningMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function normalizePlanningMonthValue(value) {
  const cleaned = String(value || "").trim();
  const match = cleaned.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const month = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}`;
}

function planningMonthLabel(monthKey) {
  const normalized = normalizePlanningMonthValue(monthKey);
  if (!normalized) return String(monthKey || "");
  const [yearRaw, monthRaw] = normalized.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function isPastPlanningMonth(monthKey) {
  const normalized = normalizePlanningMonthValue(monthKey);
  if (!normalized) return false;
  return normalized < currentPlanningMonthKey();
}

function sortPlanningMonthOptions() {
  state.planningMonthOptions = [...(state.planningMonthOptions || [])].sort((a, b) =>
    String(a?.value || "").localeCompare(String(b?.value || ""))
  );
}

function adjustPlanningMonthOptionCount(monthKey, delta) {
  const normalized = normalizePlanningMonthValue(monthKey);
  if (!normalized || !delta) return;
  const options = state.planningMonthOptions || [];
  const existing = options.find((option) => option.value === normalized);
  if (existing) {
    existing.row_count = Math.max(0, Number(existing.row_count || 0) + delta);
    existing.label = existing.label || planningMonthLabel(normalized);
    existing.is_past = isPastPlanningMonth(normalized);
  } else if (delta > 0) {
    options.push({
      value: normalized,
      label: planningMonthLabel(normalized),
      row_count: delta,
      is_past: isPastPlanningMonth(normalized),
    });
  }
  sortPlanningMonthOptions();
}

function comparePlanningRowsByDisplayOrder(a, b) {
  const rowOrderDelta = Number(a?.row_order || 0) - Number(b?.row_order || 0);
  if (rowOrderDelta !== 0) return rowOrderDelta;
  return Number(a?.id || 0) - Number(b?.id || 0);
}

function insertPlanningRowLocally(createdRow) {
  if (!createdRow) return;
  state.planningRows.push(createdRow);
  state.planningRows.sort(comparePlanningRowsByDisplayOrder);
  const sheetMeta = state.planningSheets.find((sheet) => sheet.page_id === state.planningPageId);
  if (sheetMeta) sheetMeta.row_count = Number(sheetMeta.row_count || 0) + 1;
  adjustPlanningMonthOptionCount(createdRow?.planning_month || state.planningMonth, 1);
}

function pageReferenceSheetDefinition(sheetKey) {
  return PAGE_REFERENCE_SHEETS.find((item) => item.key === sheetKey) || PAGE_REFERENCE_SHEETS[0];
}

function pageReferenceColumnLabel(index) {
  let value = Math.max(Number(index) || 0, 0);
  let label = "";
  while (true) {
    const remainder = value % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor(value / 26) - 1;
    if (value < 0) return label;
  }
}

function pageReferenceBlankRow(columnCount) {
  return Array.from({ length: Math.max(1, columnCount) }, () => "");
}

function pageReferenceCellSelector(rowIndex, columnIndex) {
  return `[data-page-reference-cell="${rowIndex}:${columnIndex}"]`;
}

function currentPageReferenceCellElement() {
  const activeCell = state.pageReferenceSheetEditor?.activeCell;
  if (!activeCell) return null;
  return document.querySelector(pageReferenceCellSelector(activeCell.rowIndex, activeCell.columnIndex));
}

function syncPageReferenceCellValueFromElement(cellEl) {
  const editor = state.pageReferenceSheetEditor;
  if (!editor || !cellEl) return;
  const token = String(cellEl.getAttribute("data-page-reference-cell") || "");
  const [rowRaw, columnRaw] = token.split(":");
  const rowIndex = Number(rowRaw);
  const columnIndex = Number(columnRaw);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return;
  if (!Array.isArray(editor.rows[rowIndex])) return;
  editor.rows[rowIndex][columnIndex] = cellEl.innerHTML === "<br>" ? "" : cellEl.innerHTML;
  editor.dirty = true;
}

function syncActivePageReferenceCellValue() {
  syncPageReferenceCellValueFromElement(currentPageReferenceCellElement());
}

function withActivePageReferenceCell(run) {
  const cell = currentPageReferenceCellElement();
  if (!state.pageReferenceSheetEditor || !cell) {
    notify("Select a sheet cell first.", "error");
    return;
  }
  cell.focus();
  run(cell);
  syncPageReferenceCellValueFromElement(cell);
}

function applyPageReferenceCommand(command, value = null) {
  withActivePageReferenceCell(() => {
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(command, false, value);
  });
}

function applyPageReferenceFontSize(sizePx) {
  withActivePageReferenceCell((cell) => {
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("fontSize", false, "7");
    cell.querySelectorAll('font[size="7"]').forEach((node) => {
      const span = document.createElement("span");
      span.style.fontSize = `${sizePx}px`;
      span.innerHTML = node.innerHTML;
      node.replaceWith(span);
    });
  });
}

function closePageReferenceSheetEditor(force = false) {
  if (!force && state.pageReferenceSheetEditor?.dirty) {
    const proceed = window.confirm("Discard unsaved changes to this page sheet?");
    if (!proceed) return false;
  }
  state.pageReferenceSheetEditor = null;
  renderApp();
  return true;
}

function normalizeScopePageId(value) {
  if (value === null || value === undefined || value === "" || value === "global") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function settingBool(value, fallback = false) {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function currentRole() {
  return String(state.user?.role || "").trim().toLowerCase() || "designer";
}

function isOwnerUser() {
  return Boolean(state.user?.is_owner);
}

function currentUserDisplayName() {
  return String(state.user?.display_name || state.user?.username || "user").trim() || "user";
}

function availableTabs() {
  if (currentRole() === "developer") return TABS;
  if (currentRole() === "admin") return ["pages", "scheduled", "posted", "planning"];
  return ["scheduled", "posted", "planning"];
}

function ensureActiveTabAllowed() {
  const tabs = availableTabs();
  if (!tabs.includes(state.activeTab)) {
    state.activeTab = tabs[0] || "scheduled";
  }
}

function canAccessSettings() {
  return isOwnerUser() || currentRole() === "developer";
}

function canAccessIntegrations() {
  return isOwnerUser() || currentRole() === "developer";
}

function canManageUsers() {
  return isOwnerUser() || currentRole() === "developer";
}

function canCreatePages() {
  return isOwnerUser() || currentRole() === "developer";
}

function canEditPages() {
  return ["developer", "admin"].includes(currentRole());
}

function canManagePageReferenceSheets() {
  return ["developer", "admin"].includes(currentRole()) || isOwnerUser();
}

function canManageConnections() {
  return isOwnerUser() || currentRole() === "developer";
}

function canCreateOrEditPosts() {
  return ["developer", "admin"].includes(currentRole());
}

function canDeletePlanningRows() {
  return ["developer", "admin"].includes(currentRole());
}

function canImportPlanningCsv() {
  return ["developer", "admin"].includes(currentRole());
}

function canManageOwnerRecord(user) {
  return !Boolean(user?.is_owner) || isOwnerUser();
}

function emptyUserEditor() {
  return {
    mode: "create",
    username: "",
    display_name: "",
    email: "",
    role: "designer",
    is_active: true,
    password: "",
    is_owner: false,
  };
}

function resetUserEditor() {
  state.userEditor = emptyUserEditor();
}

function setUserEditor(user) {
  state.userEditor = {
    mode: "edit",
    username: String(user?.username || ""),
    display_name: String(user?.display_name || ""),
    email: String(user?.email || ""),
    role: String(user?.role || "designer"),
    is_active: Boolean(user?.is_active),
    password: "",
    is_owner: Boolean(user?.is_owner),
  };
}

function plannerDesignerOptions(currentValue = "") {
  const options = ["", ...(state.designerOptions || [])];
  if (currentValue && !options.includes(currentValue)) {
    options.push(currentValue);
  }
  return Array.from(new Set(options));
}

function renderScopeOptions(selectedPageId, globalLabel = "Global (all pages)") {
  const selected = normalizeScopePageId(selectedPageId);
  return [
    `<option value="global"${selected === null ? " selected" : ""}>${escapeHtml(globalLabel)}</option>`,
    ...state.pages.map(
      (page) =>
        `<option value="${page.id}"${selected === page.id ? " selected" : ""}>${escapeHtml(page.name)}</option>`
    ),
  ].join("");
}

function planningLayoutStorageKey(pageId) {
  return `${PLANNING_LAYOUT_KEY_PREFIX}${pageId}`;
}

function planningColumnMinWidth(column) {
  if (column.type === "action") return 104;
  if (column.type === "media") return 118;
  if (column.type === "date" || column.type === "time") return 88;
  if (column.type === "textarea") return 108;
  return 84;
}

function fitPlanningColumnWidthsToViewport(columnWidths) {
  const availableWidth = Math.max((window.innerWidth || 1600) - 84, 980);
  const fitted = {};
  let total = 56;
  let minimumTotal = 56;

  for (const column of PLANNING_COLUMNS) {
    const minWidth = planningColumnMinWidth(column);
    const raw = Number(columnWidths[column.key] ?? column.width);
    const safe = Number.isFinite(raw) ? Math.max(raw, minWidth) : Math.max(column.width, minWidth);
    fitted[column.key] = safe;
    total += safe;
    minimumTotal += minWidth;
  }

  if (total <= availableWidth) {
    return fitted;
  }

  if (minimumTotal >= availableWidth) {
    return Object.fromEntries(PLANNING_COLUMNS.map((column) => [column.key, planningColumnMinWidth(column)]));
  }

  const scale = (availableWidth - minimumTotal) / (total - minimumTotal);
  return Object.fromEntries(
    PLANNING_COLUMNS.map((column) => {
      const minWidth = planningColumnMinWidth(column);
      const raw = fitted[column.key];
      const adjusted = Math.round(minWidth + (raw - minWidth) * scale);
      return [column.key, Math.max(adjusted, minWidth)];
    })
  );
}

function loadPlanningLayout(pageId) {
  const defaults = {
    columnWidths: fitPlanningColumnWidthsToViewport(Object.fromEntries(PLANNING_COLUMNS.map((col) => [col.key, col.width]))),
    rowHeights: {},
    cellHeights: {},
  };
  if (!pageId) {
    state.planningColumnWidths = { ...defaults.columnWidths };
    state.planningRowHeights = {};
    state.planningCellHeights = {};
    return;
  }

  const raw = localStorage.getItem(planningLayoutStorageKey(pageId));
  if (!raw) {
    state.planningColumnWidths = { ...defaults.columnWidths };
    state.planningRowHeights = {};
    state.planningCellHeights = {};
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    state.planningColumnWidths = fitPlanningColumnWidthsToViewport({
      ...defaults.columnWidths,
      ...(parsed.columnWidths || {}),
    });
    state.planningRowHeights = { ...(parsed.rowHeights || {}) };
    state.planningCellHeights = { ...(parsed.cellHeights || {}) };
  } catch {
    state.planningColumnWidths = { ...defaults.columnWidths };
    state.planningRowHeights = {};
    state.planningCellHeights = {};
  }
}

function savePlanningLayout() {
  if (!state.planningPageId) return;
  localStorage.setItem(
    planningLayoutStorageKey(state.planningPageId),
    JSON.stringify({
      columnWidths: state.planningColumnWidths,
      rowHeights: state.planningRowHeights,
      cellHeights: state.planningCellHeights,
    })
  );
}

function planningColumnWidth(columnKey) {
  const fallback = PLANNING_COLUMNS.find((col) => col.key === columnKey)?.width ?? 140;
  const value = Number(state.planningColumnWidths[columnKey] ?? fallback);
  return Math.max(value, 80);
}

function planningRowHeight(rowId) {
  const value = Number(state.planningRowHeights[String(rowId)] ?? 96);
  return Math.max(value, 64);
}

function planningCellHeight(rowId, columnKey, fallbackRows = 3) {
  const key = `${rowId}:${columnKey}`;
  const fallback = Math.max(42, Number(fallbackRows) * 24);
  const value = Number(state.planningCellHeights[key] ?? fallback);
  return Math.max(value, fallback);
}

function planningEditorHeight(rowId) {
  return Math.max(planningRowHeight(rowId), 42);
}

function planningRenderedCellHeight(cellEl, rowId) {
  if (!cellEl) return planningEditorHeight(rowId);
  const rectHeight = Math.ceil(cellEl.getBoundingClientRect().height || 0);
  return Math.max(rectHeight - 2, planningEditorHeight(rowId), 42);
}

function applyPlanningRowEditorHeights(rowId, rowEl = null) {
  const targetRow = rowEl || document.querySelector(`tr[data-planning-row="${rowId}"]`);
  if (!targetRow) return;

  targetRow.querySelectorAll(".planning-editor-cell").forEach((cell) => {
    const controlHeight = `${planningRenderedCellHeight(cell, rowId)}px`;
    cell.style.height = controlHeight;
    cell.style.minHeight = controlHeight;
    cell.querySelectorAll(".planning-editor-shell").forEach((shell) => {
      shell.style.height = controlHeight;
      shell.style.minHeight = controlHeight;
    });
    cell.querySelectorAll(".planning-editor-control").forEach((control) => {
      control.style.height = controlHeight;
      control.style.minHeight = controlHeight;
    });
  });
}

function syncPlanningEditorHeightsInDom() {
  if (state.activeTab !== "planning") return;
  requestAnimationFrame(() => {
    document.querySelectorAll("tr[data-planning-row]").forEach((rowEl) => {
      const rowId = rowEl.getAttribute("data-planning-row");
      if (!rowId) return;
      applyPlanningRowEditorHeights(rowId, rowEl);
    });
  });
}

function planningRowIndexById(rowId) {
  return state.planningRows.findIndex((row) => Number(row.id) === Number(rowId));
}

function planningColumnIndexByKey(columnKey) {
  return PLANNING_EDITABLE_COLUMNS.indexOf(columnKey);
}

function planningCellSelector(rowId, columnKey) {
  return `[data-row-id="${rowId}"][data-planning-field="${columnKey}"]`;
}

function isVideoAsset(value) {
  return /\.(mp4|mov|avi|mkv|webm)$/i.test(String(value || ""));
}

function postMediaPreviewItems(post) {
  const mediaPaths = Array.isArray(post?.media_paths) ? post.media_paths : [];
  return mediaPaths
    .map((rawPath, index) => {
      const path = String(rawPath || "").trim();
      if (!path) return null;
      const url = /^https?:\/\//i.test(path) ? path : path.startsWith("/") ? path : `/uploads/${path}`;
      return {
        key: `${post?.id || "post"}-${index}-${path}`,
        path,
        url,
        isVideo: isVideoAsset(path) || isVideoAsset(url),
        label: path.split("/").pop() || `Media ${index + 1}`,
      };
    })
    .filter(Boolean);
}

function renderPostMediaPreview(post) {
  const items = postMediaPreviewItems(post);
  if (!items.length) return "";

  const visibleItems = items.slice(0, 4);
  const remainingCount = Math.max(0, items.length - visibleItems.length);
  const mediaTiles = visibleItems
    .map((item, index) => {
      const overflowBadge =
        remainingCount && index === visibleItems.length - 1
          ? `<span class="post-media-more">+${remainingCount}</span>`
          : "";
      return `
        <a
          class="post-media-thumb"
          href="${escapeHtml(item.url)}"
          target="_blank"
          rel="noopener noreferrer"
          title="${escapeHtml(item.label)}"
        >
          ${
            item.isVideo
              ? `<video src="${escapeHtml(item.url)}" muted playsinline preload="metadata" class="post-media-asset"></video><span class="post-media-badge">Video</span>`
              : `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.label)}" class="post-media-asset" />`
          }
          ${overflowBadge}
        </a>
      `;
    })
    .join("");

  return `
    <section class="post-media-section">
      <div class="post-media-strip">${mediaTiles}</div>
      <p class="muted post-media-caption">${items.length} media file${items.length === 1 ? "" : "s"}</p>
    </section>
  `;
}

function renderFacebookRemoteStatus(post) {
  const remote = post?.facebook_remote || {};
  if (!remote.post_id && !remote.state && !remote.last_error) return "";

  const stateMap = {
    scheduled: "scheduled in Meta",
    published: "published by Meta",
    sync_error: "sync error",
  };
  const stateLabel = stateMap[String(remote.state || "").trim()] || String(remote.state || "tracked in Meta").trim();
  const scheduledLabel = remote.scheduled_time ? formatDateTime(remote.scheduled_time) : null;
  const detail = scheduledLabel ? `${stateLabel} for ${scheduledLabel}` : stateLabel;

  return `
    <div class="post-remote-status">
      <p class="muted">Facebook handoff: ${escapeHtml(detail)}</p>
      ${remote.last_error ? `<p class="muted">Facebook sync issue: ${escapeHtml(remote.last_error)}</p>` : ""}
    </div>
  `;
}

function focusPlanningCellByPosition(rowIndex, columnIndex) {
  const clampedRow = Math.max(0, Math.min(rowIndex, state.planningRows.length - 1));
  const clampedCol = Math.max(0, Math.min(columnIndex, PLANNING_EDITABLE_COLUMNS.length - 1));
  const row = state.planningRows[clampedRow];
  if (!row) return;
  const columnKey = PLANNING_EDITABLE_COLUMNS[clampedCol];
  const element = document.querySelector(planningCellSelector(row.id, columnKey));
  if (!element) return;
  element.focus();
  if (typeof element.select === "function" && element.type !== "time" && element.type !== "date") {
    element.select();
  }
}

function parseClipboardMatrix(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((line, index, array) => !(index === array.length - 1 && line === ""));
  return lines.map((line) => line.split("\t"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function notify(message, level = "info", durationMs = null) {
  const host = document.getElementById("toast-host");
  if (!host) return;

  const toast = document.createElement("div");
  toast.className = `toast ${level}`;
  toast.textContent = message;
  host.appendChild(toast);

  const duration =
    durationMs ??
    Math.min(Math.max(5000, String(message || "").length * 55), 14000);
  setTimeout(() => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

function saveSession() {
  if (!state.accessToken || !state.refreshToken || !state.user) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      user: state.user,
    })
  );
}

function restoreSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.accessToken = parsed.accessToken || null;
    state.refreshToken = parsed.refreshToken || null;
    state.user = parsed.user || null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function clearSession() {
  state.accessToken = null;
  state.refreshToken = null;
  state.user = null;
  state.linkedinManualPopupPostId = null;
  state.linkedinManualPopupDismissedIds = [];
  saveSession();
}

async function refreshAfterManualAction() {
  await loadDashboardData();
  renderApp();
}

function stopLinkedInManualPolling() {
  if (linkedinManualPollHandle) {
    window.clearInterval(linkedinManualPollHandle);
    linkedinManualPollHandle = null;
  }
}

function shouldPauseLinkedInManualPolling() {
  const activeTag = String(document.activeElement?.tagName || "").toUpperCase();
  if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTag)) {
    return true;
  }

  return Boolean(
    state.createPageOpen ||
    state.createPostPageId ||
    state.manageConnectionsPageId ||
    state.editingPageId ||
    state.editingPostId ||
    state.editingAccountId ||
    state.planningCreativeEditor ||
    state.planningCreativeCropper
  );
}

function linkedInManualPostSignature(posts = state.posts) {
  return pendingLinkedInManualPosts(posts)
    .map((post) => `${post.id}:${post.status}:${post.linkedin_manual?.done ? "1" : "0"}`)
    .join("|");
}

async function pollLinkedInManualPosts() {
  if (!state.accessToken || !isOwnerUser() || shouldPauseLinkedInManualPolling()) {
    return;
  }

  const previousSignature = linkedInManualPostSignature();
  const previousPopupId = state.linkedinManualPopupPostId;
  await loadPostsData();
  const popupChanged = syncLinkedInManualPopup();
  const nextSignature = linkedInManualPostSignature();
  if (popupChanged || previousPopupId !== state.linkedinManualPopupPostId || previousSignature !== nextSignature) {
    renderApp();
  }
}

function syncLinkedInManualPolling() {
  if (!state.accessToken || !isOwnerUser()) {
    stopLinkedInManualPolling();
    return;
  }

  if (linkedinManualPollHandle) {
    return;
  }

  linkedinManualPollHandle = window.setInterval(() => {
    pollLinkedInManualPosts().catch(() => {});
  }, LINKEDIN_MANUAL_POLL_MS);
}

async function refreshAccessToken() {
  if (!state.refreshToken) return false;

  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.refreshToken}` },
  });

  if (!response.ok) {
    clearSession();
    return false;
  }

  const payload = await response.json();
  state.accessToken = payload.access_token;
  saveSession();
  return true;
}

async function api(path, options = {}, retry = true) {
  const request = { ...options, headers: { ...(options.headers || {}) } };

  if (state.accessToken) {
    request.headers.Authorization = `Bearer ${state.accessToken}`;
  }

  if (request.body && !(request.body instanceof FormData)) {
    request.headers["Content-Type"] = "application/json";
    request.body = JSON.stringify(request.body);
  }

  const response = await fetch(`${API_BASE}${path}`, request);

  if (response.status === 401 && retry && state.refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return api(path, options, false);
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `Request failed (${response.status})`);
  }
  return payload;
}

function setLoading(text = "Loading...") {
  appEl.innerHTML = `<section class="panel"><p>${escapeHtml(text)}</p></section>`;
}

function formatDateTime(iso) {
  if (!iso) return "N/A";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  let timezone = state.settings?.timezone || "Africa/Johannesburg";
  try {
    new Intl.DateTimeFormat("en-ZA", { timeZone: timezone });
  } catch {
    timezone = "Africa/Johannesburg";
  }
  return date.toLocaleString("en-ZA", { timeZone: timezone });
}

function linkedInManualScheduledLabel(post) {
  if (!post?.scheduled_time) return "No scheduled date/time set.";
  return formatDateTime(post.scheduled_time);
}

function datetimeLocalValue(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInputToIso(inputValue) {
  if (!inputValue) return "";
  const date = new Date(inputValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function allPageIds() {
  return state.pages.map((page) => page.id);
}

function ensureFilterState() {
  const validIds = new Set(allPageIds());

  ["scheduled", "posted"].forEach((tab) => {
    if (!state.filters[tab].length) {
      state.filters[tab] = allPageIds();
      return;
    }

    state.filters[tab] = state.filters[tab].filter((id) => validIds.has(id));
    if (!state.filters[tab].length) state.filters[tab] = allPageIds();
  });

  if (state.settingsScopePageId !== null && !validIds.has(state.settingsScopePageId)) {
    state.settingsScopePageId = null;
  }
  if (state.integrationsScopePageId !== null && !validIds.has(state.integrationsScopePageId)) {
    state.integrationsScopePageId = null;
  }
  if (state.planningPageId !== null && !validIds.has(state.planningPageId)) {
    state.planningPageId = null;
    state.planningRows = [];
    state.planningSheets = state.planningSheets.filter((sheet) => validIds.has(sheet.page_id));
    closePlanningCreativeEditor();
  }
}

function flattenAccounts() {
  const rows = [];
  for (const page of state.pages) {
    for (const account of page.social_accounts || []) {
      rows.push({ ...account, page_name: page.name, page_id: page.id });
    }
  }
  return rows;
}

function getPostById(id) {
  return state.posts.find((item) => item.id === id) || null;
}

function getAccountById(id) {
  return flattenAccounts().find((item) => item.id === id) || null;
}

function getPlanningRowById(id) {
  return state.planningRows.find((item) => Number(item.id) === Number(id)) || null;
}

function getPageById(id) {
  return state.pages.find((item) => Number(item.id) === Number(id)) || null;
}

function pageHasActivePlatform(page, platform) {
  if (!page) return false;
  return (page.social_accounts || []).some(
    (account) => account?.is_active && String(account.platform || "").trim().toLowerCase() === platform
  );
}

function currentPlanningPage() {
  return getPageById(state.planningPageId);
}

function planningCreativePage(editor = state.planningCreativeEditor) {
  if (!editor) return currentPlanningPage();
  const row = getPlanningRowById(editor.rowId);
  return getPageById(row?.page_id || state.planningPageId);
}

function planningCreativeInstagramEnabled(editor = state.planningCreativeEditor) {
  return pageHasActivePlatform(planningCreativePage(editor), "instagram");
}

function planningCreativeFacebookInstagramGuard(editor = state.planningCreativeEditor) {
  const page = planningCreativePage(editor);
  return pageHasActivePlatform(page, "instagram") && pageHasActivePlatform(page, "facebook");
}

function nextPlanningCreativeTempId() {
  planningCreativeTempSeed += 1;
  return `pending-${planningCreativeTempSeed}`;
}

function createPlanningPendingCreativeItem(file) {
  return {
    id: nextPlanningCreativeTempId(),
    kind: "pending",
    file,
    name: file.name,
    type: file.type || "file",
    size: file.size || 0,
    url: URL.createObjectURL(file),
    media_kind: String(file.type || "").startsWith("video/") ? "video" : "image",
  };
}

function revokePlanningCreativeItem(item) {
  if (item?.kind === "pending" && item.url?.startsWith("blob:")) {
    URL.revokeObjectURL(item.url);
  }
}

function buildPlanningCreativeEditorItems(row) {
  const mediaPaths = row.creative_media_paths || [];
  const mediaUrls = row.creative_media_urls || [];
  return mediaPaths.map((path, index) => ({
    id: `existing-${path}`,
    kind: "existing",
    path,
    name: path.split("/").pop() || path,
    url: mediaUrls[index] || (path ? `/uploads/${path}` : ""),
    media_kind: isVideoAsset(path) ? "video" : "image",
  }));
}

async function loadImageElement(url) {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image."));
    image.src = url;
  });
}

async function loadImageDimensions(url) {
  const image = await loadImageElement(url);
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

function instagramImageRatioAccepted(width, height) {
  if (!width || !height) return false;
  const ratio = width / height;
  return ratio >= INSTAGRAM_IMAGE_RATIO_MIN - 0.01 && ratio <= INSTAGRAM_IMAGE_RATIO_MAX + 0.01;
}

function chooseInstagramCropPreset(width, height) {
  const ratio = width && height ? width / height : 1;
  if (ratio < INSTAGRAM_IMAGE_RATIO_MIN) return INSTAGRAM_CROP_PRESETS[0];
  if (ratio > INSTAGRAM_IMAGE_RATIO_MAX) return INSTAGRAM_CROP_PRESETS[2];

  let best = INSTAGRAM_CROP_PRESETS[1];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const preset of INSTAGRAM_CROP_PRESETS) {
    const distance = Math.abs(ratio - preset.ratio);
    if (distance < bestDistance) {
      best = preset;
      bestDistance = distance;
    }
  }
  return best;
}

async function enrichPlanningCreativeItem(item) {
  if (!item || item.media_kind === "video" || isVideoAsset(item.url || item.name || item.path)) {
    return {
      ...item,
      media_kind: "video",
      width: null,
      height: null,
      ratio_value: null,
      instagram_ratio_ok: true,
    };
  }

  if (!item.url) {
    return { ...item, media_kind: "image", instagram_ratio_ok: false, ratio_error: "Preview unavailable." };
  }

  try {
    const dimensions = await loadImageDimensions(item.url);
    const ratioValue = dimensions.width / dimensions.height;
    return {
      ...item,
      media_kind: "image",
      width: dimensions.width,
      height: dimensions.height,
      ratio_value: ratioValue,
      instagram_ratio_ok: instagramImageRatioAccepted(dimensions.width, dimensions.height),
      ratio_error: null,
    };
  } catch (error) {
    return {
      ...item,
      media_kind: "image",
      instagram_ratio_ok: false,
      ratio_error: error.message || "Could not inspect image.",
    };
  }
}

async function refreshPlanningCreativeDiagnostics({ openCropperForItemId = null } = {}) {
  const editor = state.planningCreativeEditor;
  if (!editor) return;

  const items = await Promise.all(editor.items.map((item) => enrichPlanningCreativeItem(item)));
  if (!state.planningCreativeEditor || Number(state.planningCreativeEditor.rowId) !== Number(editor.rowId)) return;

  state.planningCreativeEditor = { ...state.planningCreativeEditor, items };

  if (openCropperForItemId && planningCreativeInstagramEnabled()) {
    const invalidTarget = items.find(
      (item) => item.id === openCropperForItemId && item.media_kind === "image" && item.instagram_ratio_ok === false
    );
    if (invalidTarget) {
      openPlanningCreativeCropper(invalidTarget.id);
    }
  }

  renderApp();
}

function planningCreativeMediaGuardViolations(editor = state.planningCreativeEditor) {
  if (!editor) return [];

  const items = editor.items || [];
  const imageCount = items.filter((item) => item.media_kind !== "video").length;
  const videoCount = items.filter((item) => item.media_kind === "video").length;
  if (!planningCreativeFacebookInstagramGuard(editor)) {
    return [];
  }

  const violations = [];
  if (videoCount > 1) {
    violations.push("Pages connected to both Facebook and Instagram may contain only one video.");
  }
  if (videoCount && imageCount) {
    violations.push("Pages connected to both Facebook and Instagram cannot mix images and videos in one planner row.");
  }
  return violations;
}

function planningCreativeViolations(editor = state.planningCreativeEditor) {
  if (!editor) return [];

  const items = editor.items || [];
  const violations = [...planningCreativeMediaGuardViolations(editor)];
  if (planningCreativeInstagramEnabled(editor)) {
    const invalidImages = items.filter(
      (item) => item.media_kind !== "video" && item.instagram_ratio_ok === false
    );
    if (invalidImages.length) {
      violations.push("Instagram-connected pages require every image to be within the 4:5 to 1.91:1 feed ratio range.");
    }
  }

  return violations;
}

function cropStageSizeForRatio(ratio) {
  const maxWidth =
    typeof window === "undefined" ? 360 : Math.max(240, Math.min(360, window.innerWidth - 120));
  const maxHeight =
    typeof window === "undefined" ? 360 : Math.max(220, Math.min(360, window.innerHeight - 320));
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

function renderPlanningCropperPreview() {
  const cropper = state.planningCreativeCropper;
  const metrics = planningCropperMetrics(cropper);
  if (!cropper || !metrics) return;

  const stage = document.getElementById("planning-crop-stage");
  if (stage) {
    stage.style.width = `${metrics.stageWidth}px`;
    stage.style.height = `${metrics.stageHeight}px`;
  }

  const image = document.getElementById("planning-crop-image");
  if (image) {
    image.style.width = `${metrics.renderedWidth}px`;
    image.style.height = `${metrics.renderedHeight}px`;
    image.style.transform = `translate(${metrics.offsetX}px, ${metrics.offsetY}px)`;
  }

  const meta = document.getElementById("planning-crop-preview-meta");
  if (meta) {
    meta.textContent = `Output preview: ${metrics.preset.label} at ${metrics.stageWidth} x ${metrics.stageHeight}`;
  }
}

function cropPresetById(presetId) {
  return INSTAGRAM_CROP_PRESETS.find((preset) => preset.id === presetId) || INSTAGRAM_CROP_PRESETS[1];
}

function planningCropperMetrics(cropper = state.planningCreativeCropper) {
  if (!cropper) return null;
  const preset = cropPresetById(cropper.presetId);
  const stage = cropStageSizeForRatio(preset.ratio);
  const baseScale = Math.max(stage.width / cropper.imageWidth, stage.height / cropper.imageHeight);
  const renderScale = baseScale * cropper.zoom;
  const renderedWidth = cropper.imageWidth * renderScale;
  const renderedHeight = cropper.imageHeight * renderScale;
  const maxOffsetX = Math.max(0, renderedWidth - stage.width);
  const maxOffsetY = Math.max(0, renderedHeight - stage.height);
  const offsetX = -maxOffsetX * (cropper.positionX / 100);
  const offsetY = -maxOffsetY * (cropper.positionY / 100);
  const sourceX = Math.max(0, -offsetX / renderScale);
  const sourceY = Math.max(0, -offsetY / renderScale);
  const sourceWidth = Math.min(cropper.imageWidth, stage.width / renderScale);
  const sourceHeight = Math.min(cropper.imageHeight, stage.height / renderScale);

  return {
    preset,
    stageWidth: stage.width,
    stageHeight: stage.height,
    renderScale,
    renderedWidth,
    renderedHeight,
    offsetX,
    offsetY,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
  };
}

function openPlanningCreativeCropper(itemId) {
  const editor = state.planningCreativeEditor;
  if (!editor) return;
  const item = editor.items.find((entry) => entry.id === itemId);
  if (!item || item.media_kind === "video" || !item.width || !item.height) return;

  const preset = chooseInstagramCropPreset(item.width, item.height);
  const inferredType = item.type
    ? item.type
    : /\.png$/i.test(item.name || item.path || "")
      ? "image/png"
      : "image/jpeg";
  state.planningCreativeCropper = {
    itemId: item.id,
    sourceName: item.name || "creative.jpg",
    sourceType: inferredType,
    sourceUrl: item.url,
    imageWidth: item.width,
    imageHeight: item.height,
    presetId: preset.id,
    zoom: 1,
    positionX: 50,
    positionY: 50,
  };
}

function closePlanningCreativeCropper() {
  state.planningCreativeCropper = null;
}

async function blobFromCanvas(canvas, type, quality = 0.92) {
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to generate cropped image."));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

async function applyPlanningCreativeCrop() {
  const cropper = state.planningCreativeCropper;
  const editor = state.planningCreativeEditor;
  if (!cropper || !editor) return;

  const itemIndex = editor.items.findIndex((item) => item.id === cropper.itemId);
  if (itemIndex < 0) return;

  const metrics = planningCropperMetrics(cropper);
  if (!metrics) return;

  const image = await loadImageElement(cropper.sourceUrl);

  const outputWidth = Math.max(320, Math.round(metrics.sourceWidth));
  const outputHeight = Math.max(320, Math.round(metrics.sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not start the crop canvas.");
  }
  context.drawImage(
    image,
    metrics.sourceX,
    metrics.sourceY,
    metrics.sourceWidth,
    metrics.sourceHeight,
    0,
    0,
    outputWidth,
    outputHeight
  );

  const fileType = cropper.sourceType === "image/png" ? "image/png" : "image/jpeg";
  const extension = fileType === "image/png" ? "png" : "jpg";
  const baseName = String(cropper.sourceName || "creative")
    .replace(/\.[^.]+$/, "")
    .trim() || "creative";
  const blob = await blobFromCanvas(canvas, fileType);
  const croppedFile = new File([blob], `${baseName}-${metrics.preset.id}.${extension}`, {
    type: fileType,
  });
  const replacementItem = await enrichPlanningCreativeItem(createPlanningPendingCreativeItem(croppedFile));

  const items = [...editor.items];
  revokePlanningCreativeItem(items[itemIndex]);
  items[itemIndex] = replacementItem;
  state.planningCreativeEditor = { ...editor, items };
  closePlanningCreativeCropper();
  renderApp();
}

async function openPlanningCreativeEditor(rowId) {
  const row = getPlanningRowById(rowId);
  if (!row) return;
  closePlanningCreativeEditor();
  state.planningCreativeEditor = {
    rowId: Number(rowId),
    items: buildPlanningCreativeEditorItems(row),
  };
  renderApp();
  await refreshPlanningCreativeDiagnostics();
}

function closePlanningCreativeEditor() {
  for (const item of state.planningCreativeEditor?.items || []) {
    revokePlanningCreativeItem(item);
  }
  state.planningCreativeEditor = null;
  closePlanningCreativeCropper();
}

function movePlanningCreativeItem(index, delta) {
  const editor = state.planningCreativeEditor;
  if (!editor) return;
  const targetIndex = index + delta;
  if (targetIndex < 0 || targetIndex >= editor.items.length) return;
  const items = [...editor.items];
  const [item] = items.splice(index, 1);
  items.splice(targetIndex, 0, item);
  state.planningCreativeEditor = { ...editor, items };
}

function getDateKeyForTab(post, tab) {
  const iso = tab === "scheduled" ? post.scheduled_time || post.created_at : post.posted_at || post.scheduled_time || post.created_at;
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function postsForTab(tab) {
  const selectedIds = new Set(state.filters[tab] || []);

  let items = [];
  if (tab === "scheduled") {
    items = state.posts.filter((post) => ["draft", "scheduled", "posting", "manual_pending"].includes(post.status));
  } else {
    items = state.posts.filter((post) => ["posted", "failed"].includes(post.status));
  }

  items = items.filter((post) => selectedIds.has(post.page_id));

  items.sort((a, b) => {
    const da = new Date(tab === "posted" ? b.posted_at || b.created_at : b.scheduled_time || b.created_at);
    const db = new Date(tab === "posted" ? a.posted_at || a.created_at : a.scheduled_time || a.created_at);
    return da - db;
  });

  return items;
}

function filteredPages() {
  const query = state.pageSearch.trim().toLowerCase();
  if (!query) return state.pages;
  return state.pages.filter((page) => {
    const haystack = `${page.name || ""} ${page.description || ""}`.toLowerCase();
    return haystack.includes(query);
  });
}

function buildAccountPayloadFromFormData(formData, prefix = "") {
  const payload = {};
  const fields = [
    "account_name",
    "page_id_external",
    "access_token",
    "refresh_token",
    "api_key",
    "api_secret",
    "access_token_secret",
  ];

  for (const field of fields) {
    const key = `${prefix}${field}`;
    const value = String(formData.get(key) || "").trim();
    if (value) payload[field] = value;
  }

  const tokenExpiresAt = localInputToIso(String(formData.get(`${prefix}token_expires_at`) || ""));
  if (tokenExpiresAt) payload.token_expires_at = tokenExpiresAt;

  return payload;
}

function isMetaManagedPlatform(platform) {
  return ["facebook", "instagram"].includes(String(platform || "").toLowerCase());
}

function isLinkedInManagedPlatform(platform) {
  return String(platform || "").toLowerCase() === "linkedin";
}

function isGlobalManagedPlatform(platform) {
  return isMetaManagedPlatform(platform);
}

function globalMetaStatus() {
  return state.settings?.meta_global || {};
}

function globalLinkedInStatus() {
  return state.settings?.linkedin_global || {};
}

function postHasLinkedInManualAssist(post) {
  return Boolean(post?.linkedin_manual?.required);
}

function postLinkedInManualDone(post) {
  return Boolean(post?.linkedin_manual?.done);
}

function pendingLinkedInManualPosts(posts = state.posts) {
  return (posts || []).filter(
    (post) =>
      postHasLinkedInManualAssist(post) &&
      !postLinkedInManualDone(post) &&
      ["scheduled", "manual_pending"].includes(String(post.status || ""))
  );
}

function syncLinkedInManualPopup(posts = state.posts) {
  const previousPopupId = state.linkedinManualPopupPostId;
  if (!isOwnerUser()) {
    state.linkedinManualPopupPostId = null;
    state.linkedinManualPopupDismissedIds = [];
    return previousPopupId !== null;
  }

  const pendingPosts = pendingLinkedInManualPosts(posts);
  const validIds = new Set(pendingPosts.map((post) => Number(post.id)));
  state.linkedinManualPopupDismissedIds = state.linkedinManualPopupDismissedIds.filter((id) => validIds.has(Number(id)));

  const currentPopupId = Number(state.linkedinManualPopupPostId || 0);
  if (currentPopupId && validIds.has(currentPopupId)) {
    return previousPopupId !== state.linkedinManualPopupPostId;
  }

  const nextPost = pendingPosts.find((post) => !state.linkedinManualPopupDismissedIds.includes(Number(post.id)));
  state.linkedinManualPopupPostId = nextPost ? Number(nextPost.id) : null;
  return previousPopupId !== state.linkedinManualPopupPostId;
}

function currentLinkedInManualPopupPost() {
  if (!state.linkedinManualPopupPostId) return null;
  return getPostById(state.linkedinManualPopupPostId);
}

function dismissLinkedInManualPopup() {
  const popupId = Number(state.linkedinManualPopupPostId || 0);
  if (!popupId) return;
  if (!state.linkedinManualPopupDismissedIds.includes(popupId)) {
    state.linkedinManualPopupDismissedIds = [...state.linkedinManualPopupDismissedIds, popupId];
  }
  state.linkedinManualPopupPostId = null;
}

async function copyPlainText(text) {
  const value = String(text || "");
  if (!value) {
    throw new Error("Nothing to copy.");
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function describeGlobalMetaStatus(meta = globalMetaStatus()) {
  if (!meta?.configured) {
    return {
      tone: "muted",
      summary: "Global Meta user token is not configured.",
      detail: "Paste a Meta user token here to let the app exchange it and propagate it to Facebook and Instagram accounts.",
    };
  }
  if (meta.status === "expired") {
    return {
      tone: "bad",
      summary: "Global Meta user token has expired.",
      detail: "Replace it now. Facebook and Instagram account automation will not stay healthy with an expired token.",
    };
  }
  if (meta.expiry_known) {
    const lead =
      meta.status === "active" && meta.needs_refresh
        ? "Global Meta user token needs attention soon."
        : "Global Meta user token is active.";
    const assumption = meta.expiry_assumed ? " This is an assumed 50-day countdown because Meta did not return an expiry date." : "";
    return {
      tone: meta.needs_refresh ? "bad" : "ok",
      summary: lead,
      detail: `Time left: ${meta.time_left_text || "unknown"} (${meta.days_until_expiry ?? "?"} day(s)).${assumption}`,
    };
  }
  return {
    tone: "muted",
    summary: "Global Meta user token is saved.",
    detail: "Meta did not return an expiry date for this token, so the app cannot show a countdown yet.",
  };
}

function describeGlobalLinkedInStatus(linkedin = globalLinkedInStatus()) {
  if (!linkedin?.configured) {
    return {
      tone: "muted",
      summary: "Global LinkedIn token is not configured.",
      detail: "Paste one LinkedIn member access token here. LinkedIn page connections will inherit it automatically.",
    };
  }
  if (linkedin.status === "expired") {
    return {
      tone: "bad",
      summary: "Global LinkedIn token has expired.",
      detail: "Replace it now or refresh it if your app has a LinkedIn refresh token.",
    };
  }
  if (linkedin.expires_at) {
    return {
      tone: linkedin.needs_refresh ? "bad" : "ok",
      summary: linkedin.needs_refresh ? "Global LinkedIn token needs attention soon." : "Global LinkedIn token is active.",
      detail: `Time left: ${linkedin.time_left_text || "unknown"} (${linkedin.days_until_expiry ?? "?"} day(s)).`,
    };
  }
  return {
    tone: "muted",
    summary: "Global LinkedIn token is saved.",
    detail: "Expiry is unknown until you provide it or LinkedIn returns it during refresh.",
  };
}

function maybeNotifyMetaTokenReminder() {
  const meta = globalMetaStatus();
  if (!meta?.needs_refresh || !meta?.configured) return;
  const reminderKey = `${meta.expires_at || "missing"}:${meta.days_until_expiry ?? "?"}`;
  if (state.metaTokenReminderKey === reminderKey) return;
  state.metaTokenReminderKey = reminderKey;
  notify(
    `Global Meta token expires in ${meta.days_until_expiry} day(s). Replace it before it expires.`,
    "error"
  );
}

function renderLogin() {
  stopLinkedInManualPolling();
  appEl.innerHTML = `
    <section class="auth-wrap">
      <div class="brand">
        <h1>Sample SoMe-Auto</h1>
        <p>Publishing control center</p>
      </div>
      <form id="login-form" class="panel auth-panel">
        <h2>Sign In</h2>
        <label>Username
          <input name="username" type="text" placeholder="admin" required />
        </label>
        <label>Password
          <input name="password" type="password" placeholder="********" required />
        </label>
        <button type="submit">Login</button>
        <p class="muted">The primary developer account is bootstrapped from <code>social-media-manager/instance/users.json</code>. Additional users are managed inside Settings.</p>
      </form>
      <div id="toast-host" class="toast-host"></div>
    </section>
  `;

  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const payload = await api("/auth/login", {
        method: "POST",
        body: {
          username: String(data.get("username") || "").trim(),
          password: String(data.get("password") || "").trim(),
        },
      });

      state.accessToken = payload.access_token;
      state.refreshToken = payload.refresh_token;
      state.user = payload.user;
      saveSession();

      await loadDashboardData();
      renderApp();
      notify("Login successful", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });
}

function renderApp() {
  ensureActiveTabAllowed();
  const scheduledCount = state.posts.filter((post) => ["draft", "scheduled", "posting", "manual_pending"].includes(post.status)).length;
  const postedCount = state.posts.filter((post) => ["posted", "failed"].includes(post.status)).length;
  const visibleTabs = availableTabs();

  appEl.innerHTML = `
    <section class="shell">
      <header class="panel topbar">
        <div>
          <h1>Sample SoMe-Auto</h1>
          <p>Welcome, ${escapeHtml(currentUserDisplayName())}</p>
        </div>
        <div class="row stats-inline">
          <span class="pill">Queue: ${scheduledCount}</span>
          <span class="pill">History: ${postedCount}</span>
          <button id="refresh-data" class="ghost small">Refresh</button>
          <button id="logout-btn" class="danger small">Logout</button>
        </div>
      </header>

      <nav class="tab-strip">
        ${visibleTabs.map(
          (tab) => `
            <button
              data-tab="${tab}"
              class="tab-pill ${state.activeTab === tab ? "active" : ""}"
            >${tab[0].toUpperCase()}${tab.slice(1)}</button>
          `
        ).join("")}
      </nav>

      <section class="tab-panel">${renderActiveTab()}</section>
      ${renderCreatePageModal()}
      ${renderConnectionsModal()}
      ${renderPageReferenceSheetModal()}
      ${renderPageEditorModal()}
      ${renderAccountEditorModal()}
      ${renderPlanningCreativeModal()}
      ${renderPlanningCreativeCropperModal()}
      ${renderLinkedInManualPopupModal()}
      <div id="toast-host" class="toast-host"></div>
    </section>
  `;

  wireGlobalControls();
  wireActiveTab();
  wireCreatePageModal();
  wireConnectionsModal();
  wirePageReferenceSheetModal();
  wireAccountEditorModal();
  wirePlanningCreativeModal();
  wirePostActionButtons();
  syncLinkedInManualPolling();
}
function renderActiveTab() {
  if (state.activeTab === "pages") return renderPagesTab();
  if (state.activeTab === "scheduled") return renderTimelineTab("scheduled");
  if (state.activeTab === "posted") return renderTimelineTab("posted");
  if (state.activeTab === "planning") return renderPlanningTab();
  if (state.activeTab === "integrations") return renderIntegrationsTab();
  return renderSettingsTab();
}

function renderPagesTab() {
  const pages = filteredPages();
  const total = state.pages.length;

  const pageCards =
    pages
      .map((page) => {
        const accounts = page.social_accounts || [];
        const activeAccounts = accounts.filter((account) => account.is_active);
        const imageUrl = page.image_path ? `/uploads/${escapeHtml(page.image_path)}` : "";

        return `
          <article class="card page-card">
            <div class="row between page-card-head">
              <div>
                <h3>${escapeHtml(page.name)}</h3>
                <p>${escapeHtml(page.description || "No description")}</p>
              </div>
              <div class="row wrap">
                ${canManageConnections() ? `<button class="small ghost" data-page-manage-connections="${page.id}">Connections</button>` : ""}
                ${canEditPages() ? `<button class="small ghost" data-page-edit="${page.id}">Edit</button>` : ""}
                ${currentRole() === "developer" ? `<button class="small danger" data-page-delete="${page.id}">Delete</button>` : ""}
              </div>
            </div>

            ${
              imageUrl
                ? `<div class="page-cover-wrap"><img class="page-cover" src="${imageUrl}" alt="${escapeHtml(page.name)} cover" /></div>`
                : ""
            }

            <div class="row wrap stats">
              <span>Posted: ${page.stats?.successful_posts ?? 0}</span>
              <span>Failed: ${page.stats?.failed_posts ?? 0}</span>
              <span>Queue: ${page.stats?.scheduled_posts ?? 0}</span>
              <span>Platforms: ${activeAccounts.length}</span>
            </div>

            <div class="row wrap">
              ${
                accounts.length
                  ? accounts
                      .map(
                        (account) => `
                          <span class="pill ${account.is_active ? "" : "account-pill-inactive"}">
                            ${escapeHtml(account.platform)}${account.account_name ? `: ${escapeHtml(account.account_name)}` : ""}
                          </span>
                        `
                      )
                      .join("")
                  : "<span class='muted'>No platforms connected for this page.</span>"
              }
            </div>
          </article>
        `;
      })
      .join("") ||
    `<section class="panel"><p class="muted">${state.pageSearch ? "No pages match your search." : "No pages yet. Use Add Page to start."}</p></section>`;

  return `
    <section class="panel page-toolbar">
      <div class="row between wrap">
        <div>
          <h2>Pages</h2>
          <p class="muted">${total} total page${total === 1 ? "" : "s"} managed</p>
        </div>
        <div class="row wrap page-toolbar-actions">
          <input
            id="page-search"
            type="search"
            placeholder="Search pages..."
            value="${escapeHtml(state.pageSearch)}"
          />
          ${
            canManagePageReferenceSheets()
              ? PAGE_REFERENCE_SHEETS.map(
                  (sheet) =>
                    `<button class="small ghost" type="button" data-global-reference-sheet-open="${sheet.key}">${escapeHtml(sheet.label)}</button>`
                ).join("")
              : ""
          }
          ${canCreatePages() ? `<button class="small" data-open-create-page="1">Add Page</button>` : ""}
        </div>
      </div>
    </section>

    <section class="cards page-board">${pageCards}</section>
  `;
}

function renderLinkedInManualAssist(post) {
  if (!isOwnerUser()) return "";
  const manual = post?.linkedin_manual;
  if (!manual?.required) return "";
  const scheduledLabel = linkedInManualScheduledLabel(post);

  const assets =
    (manual.media_items || [])
      .map(
        (item, index) => `
          <article class="linkedin-manual-asset">
            ${
              item.url
                ? item.is_video
                  ? `<video src="${escapeHtml(item.url)}" controls class="linkedin-manual-preview"></video>`
                  : `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.name || `LinkedIn asset ${index + 1}`)}" class="linkedin-manual-preview" />`
                : `<div class="linkedin-manual-preview linkedin-manual-empty">Missing preview</div>`
            }
            <div class="linkedin-manual-asset-meta">
              <p class="linkedin-manual-name">${escapeHtml(item.name || `Asset ${index + 1}`)}</p>
              ${
                item.url
                  ? `<a class="button-link small ghost" href="${escapeHtml(item.url)}" download="${escapeHtml(item.name || `asset-${index + 1}`)}">Download ${item.is_video ? "Video" : "Image"}</a>`
                  : ""
              }
            </div>
          </article>
        `
      )
      .join("") || "<p class='muted'>No media attached to this post.</p>";

  return `
    <section class="linkedin-manual-panel">
      <div class="row between wrap">
        <div>
          <h4>LinkedIn Manual Assist</h4>
          <p class="${manual.done ? "ok" : "muted"}">
            ${
              manual.done
                ? `Marked done${manual.done_by ? ` by ${escapeHtml(manual.done_by)}` : ""}${manual.done_at ? ` on ${escapeHtml(formatDateTime(manual.done_at))}` : ""}.`
                : "LinkedIn API posting is paused. Download the assets, copy the text, open the page, and schedule this post manually on LinkedIn."
            }
          </p>
        </div>
        <div class="row wrap">
          <button type="button" class="small ghost" data-post-copy-text="${post.id}">Copy Text</button>
          ${
            manual.page_url
              ? `<a class="button-link small ghost" href="${escapeHtml(manual.page_url)}" target="_blank" rel="noopener noreferrer">Open LinkedIn Page</a>`
              : `<span class="bad linkedin-manual-missing">Add a LinkedIn page URL in the page editor.</span>`
          }
          ${
            isOwnerUser()
              ? manual.done
                ? `<button type="button" class="small ghost" data-post-linkedin-manual-reset="${post.id}">Reopen LinkedIn Task</button>`
                : `<button type="button" class="small" data-post-linkedin-manual-complete="${post.id}">Mark LinkedIn Done</button>`
              : ""
          }
        </div>
      </div>
      <div class="linkedin-manual-schedule-meta">
        <div>
          <p class="muted">Scheduled For</p>
          <strong>${escapeHtml(scheduledLabel)}</strong>
        </div>
        <div>
          <p class="muted">Page</p>
          <strong>${escapeHtml(post.page_name || "Unknown page")}</strong>
        </div>
      </div>
      <div class="linkedin-manual-assets">${assets}</div>
      <div class="linkedin-manual-copy">
        <p class="muted">Post Text</p>
        <pre>${escapeHtml(post.content || "[media-only post]")}</pre>
      </div>
    </section>
  `;
}

function renderLinkedInManualPopupModal() {
  const post = currentLinkedInManualPopupPost();
  if (!post || !isOwnerUser()) return "";
  const scheduledLabel = linkedInManualScheduledLabel(post);

  return `
    <div class="modal-backdrop">
      <section class="modal panel linkedin-manual-modal">
        <div class="row between wrap">
          <div>
            <h2>LinkedIn Manual Scheduling</h2>
            <p class="muted">This LinkedIn post needs manual scheduling by the owner account.</p>
            <p class="muted">Scheduled for ${escapeHtml(scheduledLabel)}</p>
          </div>
          <button type="button" class="small ghost" data-close-linkedin-manual-popup="1">Close</button>
        </div>
        ${renderLinkedInManualAssist(post)}
      </section>
    </div>
  `;
}

function renderFilterSidebar(tab) {
  const ids = new Set(state.filters[tab]);
  const rows = state.pages
    .map(
      (page) => `
        <label class="checkbox filter-row">
          <input
            type="checkbox"
            data-filter-checkbox="${tab}"
            value="${page.id}"
            ${ids.has(page.id) ? "checked" : ""}
          />
          ${escapeHtml(page.name)}
        </label>
      `
    )
    .join("");

  return `
    <aside class="panel sidebar">
      <h3>Pages</h3>
      <div class="row wrap">
        <button class="small ghost" data-filter-all="${tab}">Select All</button>
        <button class="small ghost" data-filter-none="${tab}">Deselect All</button>
      </div>
      <div class="filters">${rows || "<p class='muted'>No pages available.</p>"}</div>
    </aside>
  `;
}

function renderPostCard(post, options) {
  const canEdit = options.canEdit && ["draft", "scheduled"].includes(post.status);
  const canPublish = options.canPublish && ["draft", "scheduled"].includes(post.status);
  const canDelete = options.canDelete && (options.deleteStatuses || []).includes(post.status);
  const linkedinManualPending = postHasLinkedInManualAssist(post) && !postLinkedInManualDone(post);
  const postLinks = Object.entries(post.platform_urls || {})
    .filter(([, url]) => !!url)
    .map(
      ([platform, url]) => `
        <a class="pill post-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
          Open ${escapeHtml(platform)}
        </a>
      `
    )
    .join("");

  return `
    <article class="card post-card">
      <div class="row between">
        <h3>${escapeHtml(post.page_name || "Unknown page")}</h3>
        <span class="pill status ${escapeHtml(post.status)}">${escapeHtml(post.status)}</span>
      </div>
      <p>${escapeHtml(post.content || "[media-only post]")}</p>
      ${renderPostMediaPreview(post)}
      ${renderFacebookRemoteStatus(post)}
      <div class="row wrap">
        ${(post.platforms || []).map((platform) => `<span class="pill">${escapeHtml(platform)}</span>`).join("")}
        <span class="pill">media: ${(post.media_paths || []).length}</span>
      </div>
      ${linkedinManualPending ? `<p class="muted">LinkedIn manual scheduling is pending in the owner popup.</p>` : ""}
      <p class="muted">Scheduled: ${escapeHtml(formatDateTime(post.scheduled_time))}</p>
      <p class="muted">Posted: ${escapeHtml(formatDateTime(post.posted_at))}</p>
      ${postLinks ? `<div class="row wrap post-links">${postLinks}</div>` : ""}
      ${post.error_message ? `<pre>${escapeHtml(post.error_message)}</pre>` : ""}
      <div class="row wrap">
        ${canEdit ? `<button class="small ghost" data-post-edit="${post.id}">Edit</button>` : ""}
        ${canPublish ? `<button class="small" data-post-publish="${post.id}">Publish Now</button>` : ""}
        ${canDelete ? `<button class="small danger" data-post-delete="${post.id}">Delete</button>` : ""}
      </div>
    </article>
  `;
}

function renderPostList(posts, options) {
  if (!posts.length) return "<p class='muted'>No posts match the current filters.</p>";
  return `<div class="cards">${posts.map((post) => renderPostCard(post, options)).join("")}</div>`;
}
function renderCalendar(tab, posts, options) {
  const month = state.calendarMonth[tab];
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const startWeekday = first.getDay();

  const map = new Map();
  for (const post of posts) {
    const key = getDateKeyForTab(post, tab);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(post);
  }

  const selectedDefault = state.calendarSelectedDate[tab] || null;
  let selectedDate = selectedDefault;

  const cells = [];
  for (let i = 0; i < startWeekday; i += 1) {
    cells.push("<div class='calendar-cell empty'></div>");
  }

  const pad = (value) => String(value).padStart(2, "0");
  for (let day = 1; day <= lastDay; day += 1) {
    const key = `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
    const dayPosts = map.get(key) || [];
    if (!selectedDate && dayPosts.length) selectedDate = key;

    const isSelected = selectedDate === key;
    cells.push(`
      <button class="calendar-cell ${isSelected ? "selected" : ""}" data-calendar-day="${tab}" data-date="${key}">
        <span class="day-number">${day}</span>
        <span class="day-count">${dayPosts.length ? `${dayPosts.length} posts` : "0"}</span>
      </button>
    `);
  }

  state.calendarSelectedDate[tab] = selectedDate;
  const selectedPosts = selectedDate ? map.get(selectedDate) || [] : [];

  return `
    <section class="calendar-wrap">
      <div class="row between">
        <h3>${month.toLocaleString(undefined, { month: "long", year: "numeric" })}</h3>
        <div class="row">
          <button class="small ghost" data-calendar-prev="${tab}">Prev</button>
          <button class="small ghost" data-calendar-next="${tab}">Next</button>
        </div>
      </div>
      <div class="calendar-header">${WEEKDAY_NAMES.map((name) => `<span>${name}</span>`).join("")}</div>
      <div class="calendar-grid">${cells.join("")}</div>
    </section>

    <section class="panel calendar-details">
      <h3>${selectedDate ? `Posts on ${escapeHtml(selectedDate)}` : "Pick a date"}</h3>
      ${renderPostList(selectedPosts, options)}
    </section>
  `;
}

function renderTimelineTab(tab) {
  const posts = postsForTab(tab);
  const title = tab === "scheduled" ? "Scheduled Queue" : "Posted History";
  const canEdit = false;
  const canPublish = false;
  const canDelete = canCreateOrEditPosts();
  const deleteStatuses = tab === "scheduled"
    ? ["draft", "scheduled"]
    : ["posted", "failed"];

  return `
    <div class="timeline-layout">
      ${renderFilterSidebar(tab)}
      <section class="panel timeline-main">
        <div class="row between">
          <h2>${title}</h2>
          <div class="row">
            <button class="small ${state.viewMode[tab] === "list" ? "" : "ghost"}" data-view-mode="${tab}" data-mode="list">List</button>
            <button class="small ${state.viewMode[tab] === "calendar" ? "" : "ghost"}" data-view-mode="${tab}" data-mode="calendar">Calendar</button>
          </div>
        </div>
        ${
          state.viewMode[tab] === "list"
            ? renderPostList(posts, { canEdit, canPublish, canDelete, deleteStatuses })
            : renderCalendar(tab, posts, { canEdit, canPublish, canDelete, deleteStatuses })
        }
      </section>
    </div>
  `;
}

function renderPlanningCell(row, column) {
  const field = column.key;
  const value = row[field] ?? "";
  const width = planningColumnWidth(field);
  const rowHeight = planningRowHeight(row.id);
  const isActiveCell =
    state.planningActiveCell &&
    Number(state.planningActiveCell.rowId) === Number(row.id) &&
    state.planningActiveCell.columnKey === field;
  const activeClass = isActiveCell ? " planning-cell-active" : "";

  if (column.type === "action") {
    const rowMonth = normalizePlanningMonthValue(row.planning_month || state.planningMonth);
    const rowLockedToPastMonth = isPastPlanningMonth(rowMonth);
    const alreadyLinked = Boolean(row.scheduled_post_id);
    const isNonActionable = Boolean(row.is_non_actionable);
    const scheduleDisabled = rowLockedToPastMonth || alreadyLinked || isNonActionable;
    return `
      <td class="planning-cell planning-action-cell${activeClass}" data-planning-col="${field}" data-row-cell="${row.id}:${field}" style="width:${width}px;min-width:${width}px;max-width:${width}px;">
        ${
          isNonActionable
            ? `<button class="small ghost" data-planning-activate="${row.id}">Activate Row</button>`
            : `
                <button class="small" data-planning-schedule="${row.id}" ${scheduleDisabled ? "disabled" : ""}>Schedule Now</button>
                <button class="small ghost" data-planning-disable="${row.id}">Disable Row</button>
              `
        }
        ${
          isNonActionable
            ? `<p class="muted planning-mini planning-na-note">Ignored by warnings and scheduling</p>`
            : row.scheduled_post_id
            ? `<p class="muted planning-mini">Post #${escapeHtml(String(row.scheduled_post_id))}</p>`
            : rowLockedToPastMonth
              ? `<p class="muted planning-mini">Past month rows cannot be scheduled</p>`
            : ""
        }
      </td>
    `;
  }

  if (column.type === "media") {
    const mediaUrls = row.creative_media_urls || (row.creative_media_url ? [row.creative_media_url] : []);
    const previewUrl = mediaUrls[0] || "";
    const mediaCount = Number(row.creative_media_count ?? mediaUrls.length ?? 0);
    const preview = previewUrl
      ? isVideoAsset(previewUrl)
        ? `<video src="${escapeHtml(previewUrl)}" muted playsinline class="planning-media-preview"></video>`
        : `<img src="${escapeHtml(previewUrl)}" alt="Creative" class="planning-media-preview" />`
      : `<div class="planning-media-placeholder"><span class="muted planning-mini">No creatives yet</span></div>`;

    return `
      <td class="planning-cell${activeClass}" data-planning-col="${field}" data-row-cell="${row.id}:${field}" style="width:${width}px;min-width:${width}px;max-width:${width}px;">
        <div class="planning-media-cell">
          <button type="button" class="planning-media-box" data-planning-open-creative="${row.id}">
            ${preview}
            <div class="planning-media-meta">
              <strong>${mediaCount ? `${mediaCount} file${mediaCount === 1 ? "" : "s"}` : "Open creative box"}</strong>
              <span>${mediaCount ? "Manage images and videos" : "Add images or videos"}</span>
            </div>
          </button>
        </div>
      </td>
    `;
  }

  const commonAttrs = `data-planning-field="${field}" data-row-id="${row.id}"`;
  if (column.type === "textarea") {
    const height = planningEditorHeight(row.id);
    return `
      <td class="planning-cell planning-editor-cell${activeClass}" data-planning-col="${field}" data-row-cell="${row.id}:${field}" style="width:${width}px;min-width:${width}px;max-width:${width}px;height:${rowHeight}px;min-height:${rowHeight}px;">
        <div class="planning-editor-shell" style="height:${height}px;min-height:${height}px;">
          <textarea class="planning-editor-control" ${commonAttrs} rows="${column.rows || 3}" style="height:${height}px;min-height:${height}px;">${escapeHtml(value)}</textarea>
        </div>
      </td>
    `;
  }

  if (field === "job_nr") {
    return `
      <td class="planning-cell planning-job-cell${activeClass}" data-planning-col="${field}" data-row-cell="${row.id}:${field}" data-planning-job-cell="${row.id}" style="width:${width}px;min-width:${width}px;max-width:${width}px;background:${escapeHtml(row.job_color || "#D9D9D9")}">
        <div class="planning-job-cell-inner">
          <input type="text" ${commonAttrs} value="${escapeHtml(value)}" data-planning-job-input="${row.id}" />
          <button type="button" class="small ghost planning-color-apply" data-planning-apply-color="${row.id}">Color</button>
        </div>
      </td>
    `;
  }

  if (column.type === "select" && field === "designer") {
    const options = plannerDesignerOptions(String(value || ""));
    const height = planningEditorHeight(row.id);
    return `
      <td class="planning-cell planning-editor-cell${activeClass}" data-planning-col="${field}" data-row-cell="${row.id}:${field}" style="width:${width}px;min-width:${width}px;max-width:${width}px;height:${rowHeight}px;min-height:${rowHeight}px;">
        <div class="planning-editor-shell" style="height:${height}px;min-height:${height}px;">
          <select class="planning-editor-control" ${commonAttrs} style="height:${height}px;min-height:${height}px;">
            ${options
              .map((option) => {
                const isInactiveValue = option && !state.designerOptions.includes(option);
                const label = option ? `${option}${isInactiveValue ? " (inactive)" : ""}` : "-";
                return `<option value="${escapeHtml(option)}"${value === option ? " selected" : ""}>${escapeHtml(label)}</option>`;
              })
              .join("")}
          </select>
        </div>
      </td>
    `;
  }

  const inputType = column.type === "date" || column.type === "time" ? column.type : "text";
  const height = planningEditorHeight(row.id);
  return `
    <td class="planning-cell planning-editor-cell${activeClass}" data-planning-col="${field}" data-row-cell="${row.id}:${field}" style="width:${width}px;min-width:${width}px;max-width:${width}px;height:${rowHeight}px;min-height:${rowHeight}px;">
      <div class="planning-editor-shell" style="height:${height}px;min-height:${height}px;">
        <input class="planning-editor-control" type="${inputType}" ${commonAttrs} value="${escapeHtml(value)}" style="height:${height}px;min-height:${height}px;" />
      </div>
    </td>
  `;
}

function renderPlanningTab() {
  const hasPages = state.pages.length > 0;
  if (!hasPages) {
    return `
      <section class="panel">
        <h2>Planning</h2>
        <p class="muted">Create a page first. Each page gets its own planning sheet automatically.</p>
      </section>
    `;
  }

  const selectedPageId = state.planningPageId || state.pages[0].id;
  const rows = state.planningRows || [];
  const selectedMonth = normalizePlanningMonthValue(state.planningMonth) || currentPlanningMonthKey();
  const monthOptions =
    state.planningMonthOptions?.length
      ? state.planningMonthOptions
      : [
          {
            value: selectedMonth,
            label: planningMonthLabel(selectedMonth),
            row_count: rows.length,
            is_past: isPastPlanningMonth(selectedMonth),
          },
        ];
  const viewingPastMonth = isPastPlanningMonth(selectedMonth);
  const sheetOptions =
    state.planningSheets.length > 0
      ? state.planningSheets
      : state.pages.map((page) => ({
          page_id: page.id,
          page_name: page.name,
          row_count: 0,
        }));
  const colorButtons = PLANNING_JOB_COLORS.map(
    (color) => `
      <button
        type="button"
        class="planning-color-chip ${state.planningJobColor === color.hex ? "active" : ""}"
        data-planning-color="${color.hex}"
        title="${escapeHtml(color.label)}"
      >
        <span class="planning-color-swatch" style="background:${color.hex};"></span>
        <span class="planning-color-copy">${escapeHtml(color.label)}</span>
      </button>
    `
  ).join("");
  const importReport = renderPlanningImportReport();

  return `
    <section class="panel planning-panel">
      <div class="row between wrap">
        <div>
          <h2>Planning</h2>
          <p class="muted">Excel-style planning sheets per page. Drag column/right edges and row bottom edges to resize.</p>
        </div>
        <div class="row wrap">
          <label>Sheet
            <select id="planning-sheet-select">
              ${sheetOptions
                .map(
                  (sheet) =>
                    `<option value="${sheet.page_id}"${sheet.page_id === selectedPageId ? " selected" : ""}>${escapeHtml(sheet.page_name)} (${sheet.row_count})</option>`
                )
                .join("")}
            </select>
          </label>
          <label>Month
            <select id="planning-month-select">
              ${monthOptions
                .map(
                  (option) =>
                    `<option value="${escapeHtml(option.value)}"${option.value === selectedMonth ? " selected" : ""}>${escapeHtml(option.label)}${option.row_count ? ` (${option.row_count})` : ""}</option>`
                )
                .join("")}
            </select>
          </label>
          ${canImportPlanningCsv() ? `<button class="small ghost" id="planning-import-csv">Import CSVs</button>` : ""}
          <button class="small ghost" id="planning-add-na-row" ${viewingPastMonth ? "disabled" : ""}>NA Row</button>
          <button class="small" id="planning-add-row" ${viewingPastMonth ? "disabled" : ""}>Add Row</button>
          <button class="small ghost" id="planning-refresh">Refresh</button>
        </div>
      </div>

      <p class="muted">
        ${
          viewingPastMonth
            ? `Viewing ${escapeHtml(planningMonthLabel(selectedMonth))} for reference. Past months stay visible, but new rows and scheduling are disabled there.`
            : `Planning month: ${escapeHtml(planningMonthLabel(selectedMonth))}. You can create and schedule rows here while the month is current or upcoming.`
        }
      </p>
      <p class="muted"><code>NA Row</code> creates a non-actionable planner row. It stays in the sheet for notes/reference only and is ignored by warning emails, manual scheduling, and auto-scheduling.</p>
      ${
        canImportPlanningCsv()
          ? `<p class="muted">One-time CSV bridge: place one CSV per page in <code>social-media-manager/imports/planning/inbox</code>, name it after the page or use <code>page-&lt;id&gt;.csv</code>, then click Import CSVs.</p>`
          : ""
      }
      ${importReport}

      <section class="planning-color-bar">
        <p class="muted">Select color to apply.</p>
        <div class="planning-color-list">${colorButtons}</div>
      </section>

      <div class="planning-grid-wrap">
        <table class="planning-table">
          <thead>
            <tr>
              <th class="planning-index-col">#</th>
              ${PLANNING_COLUMNS.map(
                (col) => `
                  <th class="planning-col-head" data-planning-col="${col.key}" style="width:${planningColumnWidth(col.key)}px;min-width:${planningColumnWidth(col.key)}px;max-width:${planningColumnWidth(col.key)}px;">
                    <span>${escapeHtml(col.label)}</span>
                    <span class="planning-col-resize" data-planning-resize-col="${col.key}"></span>
                  </th>
                `
              ).join("")}
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .map(
                      (row, idx) => `
                        <tr data-planning-row="${row.id}" class="${row.is_non_actionable ? "planning-row-na" : ""}" style="height:${planningRowHeight(row.id)}px;">
                          <td class="planning-index-col">
                            <span>${idx + 1}</span>
                            ${row.is_non_actionable ? `<span class="planning-row-badge">NA</span>` : ""}
                            ${canDeletePlanningRows() ? `<button class="planning-row-delete" data-planning-delete="${row.id}" title="Delete row">x</button>` : ""}
                            <span class="planning-row-resize" data-planning-resize-row="${row.id}"></span>
                          </td>
                          ${PLANNING_COLUMNS.map((col) => renderPlanningCell(row, col)).join("")}
                        </tr>
                      `
                    )
                    .join("")
                : `<tr><td colspan="${PLANNING_COLUMNS.length + 1}" class="muted">No planning rows in ${escapeHtml(planningMonthLabel(selectedMonth))} yet.</td></tr>`
            }
          </tbody>
        </table>
      </div>
        <p class="muted">Active rows show <code>Schedule Now</code> and <code>Disable Row</code>. NA rows show <code>Activate Row</code> and stay ignored by warning emails and scheduling. Scheduling only works when Job Nr color is ${PLANNING_READY_COLOR}. When scheduled it switches to ${PLANNING_SCHEDULED_COLOR}, when posted it switches to ${PLANNING_POSTED_COLOR}, and failed posts turn black automatically. If auto-schedule is enabled, today&apos;s unscheduled rows with copy, creatives, and the ready-to-schedule green color are scheduled early enough to preserve at least a 25-minute Facebook handoff buffer before their target time. Past date/time rows cannot be scheduled.</p>
    </section>
  `;
}

function renderPlanningImportReport() {
  const result = state.planningImportResult;
  if (!result) return "";

  const rows =
    (result.report || [])
      .map((item) => {
        const issues = (item.issues || [])
          .map((issue) => `<li>${escapeHtml(issue)}</li>`)
          .join("");
        return `
          <tr>
            <td>${escapeHtml(item.file_name || "-")}</td>
            <td>${escapeHtml(item.page_name || "-")}</td>
            <td>${escapeHtml(item.status || "-")}</td>
            <td>${escapeHtml(String(item.rows_imported ?? 0))}</td>
            <td>${escapeHtml(String(item.rows_skipped ?? 0))}</td>
            <td>${escapeHtml((item.imported_months || []).join(", ") || "-")}</td>
            <td>
              ${
                issues
                  ? `<details><summary>View Issues (${escapeHtml(String((item.issues || []).length))})</summary><ul>${issues}</ul></details>`
                  : "<span class='muted'>No issues</span>"
              }
            </td>
          </tr>
        `;
      })
      .join("") || "<tr><td colspan='7'>No file report</td></tr>";

  return `
    <section class="panel">
      <div class="row between wrap">
        <div>
          <h3>Last CSV Import</h3>
          <p class="muted">${escapeHtml(result.message || "Import finished.")}</p>
          <p class="muted">Inbox: ${escapeHtml(result.inbox_path || "-")} | Processed: ${escapeHtml(result.processed_path || "-")}</p>
        </div>
        <button type="button" class="small ghost" id="planning-import-report-clear">Clear</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Page</th>
            <th>Status</th>
            <th>Imported</th>
            <th>Skipped</th>
            <th>Months</th>
            <th>Issues</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function renderPlanningTabInPlace() {
  if (state.activeTab !== "planning") return;
  const panel = document.querySelector(".tab-panel");
  if (!panel) return;
  panel.innerHTML = renderPlanningTab();
  wirePlanningTab();
  syncPlanningEditorHeightsInDom();
}

function renderUserManagementPanel() {
  const editor = state.userEditor || emptyUserEditor();
  const editing = editor.mode === "edit";
  const userRows =
    state.users
      .map((user) => {
        const isCurrentUser = String(user.username || "") === String(state.user?.username || "");
        const canManageThisUser = canManageOwnerRecord(user);
        const roleLabel = user.is_owner ? "owner" : user.role || "-";
        return `
          <tr>
            <td>${escapeHtml(user.display_name || user.username || "-")}</td>
            <td>${escapeHtml(user.username || "-")}</td>
            <td>${escapeHtml(roleLabel)}${user.is_owner ? " <span class='pill'>developer access</span>" : ""}</td>
            <td>${user.is_active ? "<span class='ok'>active</span>" : "<span class='bad'>inactive</span>"}</td>
            <td>${escapeHtml(user.email || "-")}</td>
            <td>${isCurrentUser ? "<span class='muted'>current session</span>" : ""}</td>
            <td class="row wrap">
              <button type="button" class="small ghost" data-user-edit="${escapeHtml(user.username)}" ${canManageThisUser ? "" : "disabled"}>Edit</button>
              <button type="button" class="small danger" data-user-delete="${escapeHtml(user.username)}" ${user.is_owner || !canManageThisUser ? "disabled" : ""}>Delete</button>
            </td>
          </tr>
        `;
      })
      .join("") || "<tr><td colspan='7'>No users configured</td></tr>";

  return `
    <section class="panel">
      <div class="row between wrap">
        <div>
          <h2>User Management</h2>
          <p class="muted">Users are global. Active designer users become planner dropdown options automatically.</p>
        </div>
        <button type="button" class="small ghost" id="user-editor-reset">New User</button>
      </div>
      <div class="grid two">
        <section>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th>Email</th>
                <th>Session</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${userRows}</tbody>
          </table>
        </section>
        <section>
          <h3>${editing ? `Edit ${escapeHtml(editor.username)}` : "Create User"}</h3>
          <form id="user-form">
            <label>Username<input name="username" type="text" value="${escapeHtml(editor.username)}" ${editing ? "readonly" : ""} required /></label>
            <label>Display Name<input name="display_name" type="text" value="${escapeHtml(editor.display_name)}" placeholder="Shown in the planner and UI" /></label>
            <label>Email<input name="email" type="email" value="${escapeHtml(editor.email)}" placeholder="Example@sample.co.za" /></label>
            <label>Role
              <select name="role" ${editor.is_owner ? "disabled" : ""}>
                <option value="developer" ${editor.role === "developer" ? "selected" : ""}>developer</option>
                <option value="admin" ${editor.role === "admin" ? "selected" : ""}>admin</option>
                <option value="designer" ${editor.role === "designer" ? "selected" : ""}>designer</option>
              </select>
            </label>
            <label>Password<input name="password" type="password" placeholder="${editing ? "Leave blank to keep current password" : "Minimum 8 characters"}" ${editing ? "" : "required"} /></label>
            <label class="checkbox">
              <input name="is_active" type="checkbox" ${editor.is_active ? "checked" : ""} ${editor.is_owner ? "disabled" : ""} />
              User active
            </label>
            <div class="row wrap">
              <button type="submit">${editing ? "Save User" : "Create User"}</button>
              ${editing ? '<button type="button" class="ghost" data-user-reset="1">Cancel</button>' : ""}
            </div>
            <p class="muted">${editor.is_owner ? "The owner account always stays active, keeps full developer access, and cannot be deleted." : "Designer display names must stay unique so planner ownership stays clear."}</p>
          </form>
        </section>
      </div>
    </section>
  `;
}

function renderSettingsTab() {
  const meta = globalMetaStatus();
  const linkedin = globalLinkedInStatus();
  const schedulerRows =
    state.schedulerStatus?.jobs
      ?.map((job) => `<tr><td>${escapeHtml(job.id)}</td><td>${escapeHtml(formatDateTime(job.next_run))}</td></tr>`)
      .join("") || "<tr><td colspan='2'>No jobs</td></tr>";

  const tokenRows =
    state.tokenStatus
      ?.map(
        (row) => `
        <tr>
          <td>${escapeHtml(row.page_name || "-")}</td>
          <td>${escapeHtml(row.platform)}</td>
          <td>${escapeHtml(row.account_name || "-")}</td>
          <td>${escapeHtml(String(row.days_until_expiry ?? "-"))}</td>
          <td>${row.needs_refresh ? "<span class='bad'>yes</span>" : "<span class='ok'>no</span>"}</td>
        </tr>
      `
      )
      .join("") || "<tr><td colspan='5'>No token data</td></tr>";

  const isPageScope = state.settingsScopePageId !== null;
  const overrideKeys = Object.keys(state.settingsMeta?.overrides || {});
  const scopeHint = isPageScope
    ? `Editing page override settings for ${escapeHtml(state.settingsMeta?.pageName || "selected page")}.`
    : "Editing global defaults for all pages.";
  const metaDescription = describeGlobalMetaStatus(meta);
  const linkedinDescription = describeGlobalLinkedInStatus(linkedin);

  return `
    <div class="grid two">
      <section class="panel">
        <div class="row between wrap">
          <h2>Settings Scope</h2>
          <label>
            <select id="settings-scope-select">
              ${renderScopeOptions(state.settingsScopePageId, "Global defaults (all pages)")}
            </select>
          </label>
        </div>
        <p class="muted">${scopeHint}</p>
        ${
          isPageScope
            ? `<p class="muted">Current page overrides: ${overrideKeys.length ? escapeHtml(overrideKeys.join(", ")) : "none (inherits global defaults)"}</p>`
            : ""
        }
        ${
          !isPageScope
            ? `
              <h3>Global Meta Token</h3>
              <p class="${escapeHtml(metaDescription.tone)}">${escapeHtml(metaDescription.summary)}</p>
              <p class="muted">${escapeHtml(metaDescription.detail)}</p>
              <p class="muted">Use one Meta user token here. Instagram accounts inherit it automatically and Facebook page tokens are re-derived from it.</p>
              <p class="muted">The Facebook App ID and App Secret below are static app credentials. They stay as-is until you manually edit them here.</p>
              <p class="muted">Current token: ${escapeHtml(meta.token_preview || "not configured")}</p>
              <p class="muted">Expires at: ${escapeHtml(formatDateTime(meta.expires_at))}${meta.expiry_assumed ? " (assumed)" : ""}</p>
              <p class="muted">Time left: ${escapeHtml(meta.time_left_text || "Unknown")}${meta.expiry_assumed ? " (assumed 50-day timer)" : ""}</p>
              <p class="muted">Last refreshed: ${escapeHtml(formatDateTime(meta.last_refreshed))} | Last checked: ${escapeHtml(formatDateTime(meta.last_checked))}</p>
              <h3>LinkedIn Mode</h3>
              <p class="muted">LinkedIn API automation is paused for now.</p>
              <p class="muted">Pages can still include LinkedIn, but they use the manual assist workflow from the Scheduled Queue instead of API posting.</p>
            `
            : `<p class="muted">Global Meta tokens are managed in Global defaults. LinkedIn is currently manual assist only.</p>`
        }
        <h3>General Settings</h3>
        <form id="settings-form">
          <label>App Name<input name="app_name" type="text" value="${escapeHtml(state.settings.app_name || "Sample SoMe-Auto")}" ${isPageScope ? "disabled" : ""} /></label>
          <label>Default Post Time<input name="default_post_time" type="time" value="${escapeHtml(state.settings.default_post_time || "10:00")}" /></label>
          <label>Timezone<input name="timezone" type="text" value="${escapeHtml(state.settings.timezone || "Africa/Johannesburg")}" /></label>
          <label>Auto Schedule
            <select name="auto_schedule">
              <option value="true" ${String(state.settings.auto_schedule) === "true" ? "selected" : ""}>true</option>
              <option value="false" ${String(state.settings.auto_schedule) === "false" ? "selected" : ""}>false</option>
            </select>
          </label>
          <label>Notifications
            <select name="notification_enabled">
              <option value="true" ${String(state.settings.notification_enabled) === "true" ? "selected" : ""}>true</option>
              <option value="false" ${String(state.settings.notification_enabled) === "false" ? "selected" : ""}>false</option>
            </select>
          </label>
          <label>Live Posting
            <select name="live_posting_enabled">
              <option value="false" ${String(state.settings.live_posting_enabled) === "false" ? "selected" : ""}>false (safe simulation)</option>
              <option value="true" ${String(state.settings.live_posting_enabled) === "true" ? "selected" : ""}>true (real API posting)</option>
            </select>
          </label>
          ${
            isPageScope
              ? ""
              : `
                <h3>Meta App Credentials</h3>
                <label>Facebook App ID<input name="facebook_app_id" type="text" value="${escapeHtml(state.settings.facebook_app_id || "")}" autocomplete="off" /></label>
                <label>Facebook App Secret<input name="facebook_app_secret" type="password" value="${escapeHtml(state.settings.facebook_app_secret || "")}" autocomplete="new-password" /></label>
                <label>Global Meta User Token<textarea name="global_meta_user_token" rows="4" placeholder="Paste a fresh Meta user token here to exchange and propagate it across Facebook/Instagram accounts.">${escapeHtml(state.settings.global_meta_user_token || "")}</textarea></label>
                <h3>Monthly Sheet Sync</h3>
                <label>Spreadsheet URL or ID<input name="monthly_insights_spreadsheet" type="text" value="${escapeHtml(state.settings.monthly_insights_spreadsheet || "")}" placeholder="https://docs.google.com/spreadsheets/d/... or raw ID" autocomplete="off" /></label>
                <label>Meta API Version<input name="monthly_insights_meta_api_version" type="text" value="${escapeHtml(state.settings.monthly_insights_meta_api_version || "v24.0")}" placeholder="v24.0" autocomplete="off" /></label>
                <label>Google Service Account JSON<textarea name="monthly_insights_google_service_account_json" rows="10" placeholder='Paste the full Google service account JSON key here.'>${escapeHtml(state.settings.monthly_insights_google_service_account_json || "")}</textarea></label>
                <p class="muted">The monthly sync matches worksheet tab names to Page names, writes the previous month into the matching month column, and fills the Facebook/Instagram rows in place.</p>
                <label>Designer Email Routing<textarea name="designer_email_map" rows="5" placeholder="Emma=Example@sample.co.za&#10;Quinton=Example@sample.co.za">${escapeHtml(state.settings.designer_email_map || "")}</textarea></label>
                <p class="muted">Use one designer-to-email mapping per line in the form <code>Name=Example@sample.co.za</code>. This controls who receives missing-creative warning emails.</p>
              `
          }
          <p class="muted">Set PUBLIC_BASE_URL for temporary signed media links used by Instagram/Pinterest uploads.</p>
          <button type="submit">Save Settings</button>
        </form>
      </section>

      <section class="panel">
        <h2>Scheduler + Token Health</h2>
        <p class="muted">Scheduler running: ${state.schedulerStatus?.running ? "yes" : "no"} | Jobs: ${state.schedulerStatus?.scheduled_jobs ?? 0}</p>
        <table>
          <thead><tr><th>Job</th><th>Next Run</th></tr></thead>
          <tbody>${schedulerRows}</tbody>
        </table>
        <h3>Token Status</h3>
        <table>
          <thead><tr><th>Page</th><th>Platform</th><th>Account</th><th>Days Left</th><th>Needs Refresh</th></tr></thead>
          <tbody>${tokenRows}</tbody>
        </table>
      </section>
    </div>

    <section class="panel">
      <h2>FAQ - Manager Self-Service</h2>
      <div class="faq-list">
        ${FAQ_ITEMS.map(
          (item) => `
            <details>
              <summary>${escapeHtml(item.question)}</summary>
              <p>${escapeHtml(item.answer)}</p>
            </details>
          `
        ).join("")}
      </div>
    </section>

    ${canManageUsers() ? renderUserManagementPanel() : ""}
  `;
}

function renderMonthlyInsightsSyncResult() {
  const result = state.monthlyInsightsSyncResult;
  if (!result) return "";

  const rows =
    (result.report || [])
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.sheet_title || "-")}</td>
            <td>${escapeHtml(item.page_name || "-")}</td>
            <td>${escapeHtml(item.status || "-")}</td>
            <td>${escapeHtml(String(item.cells_updated ?? 0))}</td>
            <td>${escapeHtml((item.warnings || []).join(" | ") || "-")}</td>
          </tr>
        `
      )
      .join("") || "<tr><td colspan='5'>No sheets processed</td></tr>";

  return `
    <section class="panel">
      <h2>Last Monthly Sync</h2>
      <p class="muted">${escapeHtml(result.message || "Monthly sync finished.")}</p>
      <p class="muted">Target month: ${escapeHtml(result.month_label || "-")} | Cells written: ${escapeHtml(String(result.cells_written ?? 0))}</p>
      <table>
        <thead><tr><th>Sheet</th><th>Page</th><th>Status</th><th>Cells Updated</th><th>Warnings</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function renderIntegrationsTab() {
  const check = state.integrationCheck || {};
  const envGroups = check.platform_env || {};
  const warnings = check.warnings || [];
  const accounts = check.accounts || [];
  const scope = check.scope || {};
  const monthly = check.monthly_insights || {};
  const canRunMonthlySync =
    scope.type !== "page" &&
    Boolean(monthly.spreadsheet_id) &&
    Boolean(monthly.google_service_account_email);

  const envBlocks = Object.entries(envGroups)
    .map(([name, values]) => {
      const rows = Object.entries(values || {})
        .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${value ? "<span class='ok'>set</span>" : "<span class='bad'>missing</span>"}</td></tr>`)
        .join("");
      return `
        <section class="panel">
          <h3>${escapeHtml(name)}</h3>
          <table>
            <thead><tr><th>Check</th><th>Status</th></tr></thead>
            <tbody>${rows || "<tr><td colspan='2'>No checks</td></tr>"}</tbody>
          </table>
        </section>
      `;
    })
    .join("");

  const accountRows =
    accounts
      .map(
        (item) => `
        <tr>
          <td>${escapeHtml(item.page_name || "-")}</td>
          <td>${escapeHtml(item.platform)}</td>
          <td>${escapeHtml(item.account_name || "-")}</td>
          <td>${item.active ? "yes" : "no"}</td>
          <td>${item.ready_for_publish ? "<span class='ok'>ready</span>" : "<span class='bad'>not ready</span>"}</td>
          <td>${escapeHtml((item.missing_fields || []).join(", ") || "-")}</td>
        </tr>
      `
      )
      .join("") || "<tr><td colspan='6'>No connected accounts</td></tr>";

  return `
    <section class="panel">
      <div class="row between wrap">
        <div>
          <h2>Monthly Sheet Sync</h2>
          <p class="muted">Runs one workbook-wide sync for the previous full month and writes Facebook/Instagram metrics into the existing month columns on matching tabs.</p>
        </div>
        ${
          scope.type === "page"
            ? "<span class='muted'>Global only</span>"
            : `<button id="run-monthly-insights-sync" class="small" ${canRunMonthlySync ? "" : "disabled"}>Sync Previous Month</button>`
        }
      </div>
      <p class="muted">Target month: ${escapeHtml(monthly.target_month || "-")}</p>
      <p class="muted">Spreadsheet: ${escapeHtml(monthly.spreadsheet_ref || "not configured")}</p>
      <p class="muted">Service account: ${escapeHtml(monthly.google_service_account_email || "not configured")}</p>
      <p class="muted">Meta API version: ${escapeHtml(monthly.meta_api_version || "-")}</p>
      ${
        scope.type === "page"
          ? "<p class='muted'>Switch scope back to Global to run the monthly workbook sync.</p>"
          : !canRunMonthlySync
            ? "<p class='muted'>Configure the spreadsheet URL/ID and Google service account JSON in Settings before running the sync.</p>"
            : ""
      }
    </section>

    <section class="panel">
      <div class="row between">
        <h2>Integration Check</h2>
        <div class="row wrap">
          <label>
            <select id="integrations-scope-select">
              ${renderScopeOptions(state.integrationsScopePageId, "Global (all pages)")}
            </select>
          </label>
          <button id="refresh-integrations" class="small ghost">Re-check</button>
        </div>
      </div>
      <p class="muted">Scope: ${scope.type === "page" ? `page - ${escapeHtml(scope.page_name || "selected page")}` : "global"}</p>
      <p class="muted">Live posting enabled: ${check.live_posting_enabled ? "yes" : "no"}</p>
      <p class="muted">${escapeHtml(check.media_delivery?.note || "No media delivery data.")}</p>
      <p class="muted">PUBLIC_BASE_URL: ${escapeHtml(check.media_delivery?.public_base_url || "not set")}</p>
      ${warnings.length ? `<pre>${escapeHtml(warnings.join("\n"))}</pre>` : "<p class='muted'>No warnings.</p>"}
    </section>

    <div class="grid two">${envBlocks}</div>

    <section class="panel">
      <h2>Account Readiness</h2>
      <table>
        <thead><tr><th>Page</th><th>Platform</th><th>Account</th><th>Active</th><th>Ready</th><th>Missing Fields</th></tr></thead>
        <tbody>${accountRows}</tbody>
      </table>
    </section>

    ${renderMonthlyInsightsSyncResult()}
  `;
}

function renderCreatePageModal() {
  if (!state.createPageOpen) return "";

  const platformCheckboxes = PLATFORMS.map(
    (platform) => `
      <label class="checkbox platform-option">
        <input type="checkbox" name="wizard_platforms" value="${platform}" data-platform-toggle="${platform}" />
        ${escapeHtml(platform)}
      </label>
    `
  ).join("");

  const platformCredentialBlocks = PLATFORMS.map((platform) => {
    if (platform === "facebook") {
      return `
        <section class="panel platform-config" data-platform-config="${platform}" hidden>
          <h4>facebook credentials</h4>
          <p class="muted">Only required here: Facebook Page ID. The page access token is derived automatically from the global Meta token in Settings.</p>
          <label>Page ID
            <input name="facebook_page_id_external" type="text" required disabled placeholder="Facebook page ID" />
          </label>
        </section>
      `;
    }

    if (platform === "instagram") {
      return `
        <section class="panel platform-config" data-platform-config="${platform}" hidden>
          <h4>instagram credentials</h4>
          <p class="muted">Only required here: Instagram business account ID. The Meta user token comes from global Settings.</p>
          <label>Instagram Business Account ID
            <input name="instagram_page_id_external" type="text" required disabled />
          </label>
        </section>
      `;
    }

    if (platform === "linkedin") {
      return `
        <section class="panel platform-config" data-platform-config="${platform}" hidden>
          <h4>linkedin manual mode</h4>
          <p class="muted">LinkedIn API automation is paused. No organization ID or token is required right now.</p>
          <label>LinkedIn Account Label
            <input name="linkedin_account_name" type="text" disabled placeholder="Optional display name for this LinkedIn page" />
          </label>
        </section>
      `;
    }

    if (platform === "twitter") {
      return `
        <section class="panel platform-config" data-platform-config="${platform}" hidden>
          <h4>twitter credentials</h4>
          <p class="muted">Required for this implementation: API key, API secret, access token, access token secret.</p>
          <label>API Key
            <input name="twitter_api_key" type="text" required disabled />
          </label>
          <label>API Secret
            <input name="twitter_api_secret" type="text" required disabled />
          </label>
          <label>Access Token
            <input name="twitter_access_token" type="text" required disabled />
          </label>
          <label>Access Token Secret
            <input name="twitter_access_token_secret" type="text" required disabled />
          </label>
        </section>
      `;
    }

    return `
      <section class="panel platform-config" data-platform-config="${platform}" hidden>
        <h4>pinterest credentials</h4>
        <p class="muted">Only required: access token.</p>
        <label>Access Token
          <input name="pinterest_access_token" type="text" required disabled />
        </label>
      </section>
    `;
  }).join("");

  return `
    <div class="modal-backdrop">
      <section class="modal panel">
        <div class="row between">
          <h2>Create Page Setup Wizard</h2>
          <button class="small ghost" type="button" data-close-create-page="1">Close</button>
        </div>
        <form id="create-page-modal-form">
          <section>
            <h3>Step 1: Page Details</h3>
            <label>Name<input name="name" type="text" required /></label>
            <label>Description<textarea name="description" rows="3"></textarea></label>
            <label>LinkedIn Page URL<input name="linkedin_page_url" type="url" placeholder="https://www.linkedin.com/company/your-page/" /></label>
            <label>Image<input name="image" type="file" accept="image/*" /></label>
          </section>

          <section>
            <h3>Step 2: Platform Checklist</h3>
            <p class="muted">Select the social platforms this page should be locked to.</p>
            <div class="platform-grid">${platformCheckboxes}</div>
          </section>

          <section>
            <h3>Step 3: Platform Credentials</h3>
            <p class="muted">This wizard asks only for required fields per selected platform.</p>
            ${platformCredentialBlocks}
          </section>

          <div class="row modal-actions">
            <button type="submit">Create Page</button>
            <button class="ghost" type="button" data-close-create-page="1">Cancel</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderCreatePostModal() {
  if (!state.createPostPageId) return "";
  const page = state.pages.find((item) => item.id === state.createPostPageId);
  if (!page) return "";

  const activePlatforms = Array.from(
    new Set(
      (page.social_accounts || [])
        .filter((account) => account.is_active)
        .map((account) => account.platform)
    )
  );

  return `
    <div class="modal-backdrop">
      <section class="modal panel">
        <div class="row between">
          <h2>Create Post for ${escapeHtml(page.name)}</h2>
          <button class="small ghost" type="button" data-close-create-post="1">Close</button>
        </div>
        <p class="muted">Target platforms are locked by this page setup.</p>
        <div class="row wrap">
          ${
            activePlatforms.length
              ? activePlatforms.map((platform) => `<span class="pill">${escapeHtml(platform)}</span>`).join("")
              : "<span class='bad'>No active platforms connected.</span>"
          }
        </div>
        <form id="create-post-modal-form">
          <label>Content<textarea name="content" rows="5" placeholder="Write post copy..."></textarea></label>
          <label>Media<input name="media" type="file" multiple /></label>
          <div class="grid two">
            <label>Schedule Time<input name="scheduled_time" type="datetime-local" /></label>
            <label class="checkbox">
              <input name="post_now" type="checkbox" />
              Publish now
            </label>
          </div>
          <div class="row modal-actions">
            <button type="submit" ${activePlatforms.length ? "" : "disabled"}>Save Post</button>
            <button class="ghost" type="button" data-close-create-post="1">Cancel</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderConnectionsModal() {
  if (!state.manageConnectionsPageId) return "";
  const page = state.pages.find((item) => item.id === state.manageConnectionsPageId);
  if (!page) return "";

  const accounts = page.social_accounts || [];
  const connectedPlatforms = new Set(accounts.map((account) => account.platform));
  const availablePlatforms = PLATFORMS.filter((platform) => !connectedPlatforms.has(platform));

  const accountCards =
    accounts
      .map(
        (account) => `
          <article class="card">
            <div class="row between">
              <div>
                <h3>${escapeHtml(account.platform)}</h3>
                <p>${escapeHtml(account.account_name || "Unnamed account")}</p>
              </div>
              <span class="pill ${account.is_active ? "" : "account-pill-inactive"}">${account.is_active ? "active" : "inactive"}</span>
            </div>
            <p class="muted">Last tested: ${escapeHtml(formatDateTime(account.last_tested))}</p>
            ${account.platform === "linkedin" ? "<p class='muted'>Manual assist mode. No LinkedIn API credentials are used right now.</p>" : ""}
            ${account.test_error ? `<pre>${escapeHtml(account.test_error)}</pre>` : ""}
            <div class="row wrap">
              ${
                account.platform === "linkedin"
                  ? ""
                  : `<button class="small ghost" type="button" data-connection-test="${account.id}">Test</button>
                     <button class="small ghost" type="button" data-connection-refresh="${account.id}">Refresh Token</button>`
              }
              <button class="small ghost" type="button" data-connection-edit="${account.id}">Edit</button>
              <button class="small danger" type="button" data-connection-delete="${account.id}">Delete</button>
            </div>
          </article>
        `
      )
      .join("") || "<p class='muted'>No platform connections for this page yet.</p>";

  return `
    <div class="modal-backdrop">
      <section class="modal panel">
        <div class="row between">
          <h2>Manage Connections: ${escapeHtml(page.name)}</h2>
          <button class="small ghost" type="button" data-close-connections="1">Close</button>
        </div>

        <section>
          <h3>Connected Platforms</h3>
          <div class="cards">${accountCards}</div>
        </section>

        <section>
          <h3>Add Platform Connection</h3>
          ${
            availablePlatforms.length
              ? `
                <form id="connections-add-form">
                  <label>Platform
                    <select name="platform" required>
                      <option value="">Choose platform</option>
                      ${availablePlatforms.map((platform) => `<option value="${platform}">${platform}</option>`).join("")}
                    </select>
                  </label>
                  <label>Account Name<input name="account_name" type="text" /></label>
                  <label data-connections-external-id="1">External ID<input name="page_id_external" type="text" placeholder="Page/board/author/business account ID" /></label>
                  <p class="muted" id="connections-managed-note">Facebook and Instagram use the global Meta token from Settings. Provide only the external ID for those platforms.</p>
                  <p class="muted" id="connections-linkedin-manual-note" hidden>LinkedIn is currently manual-only. No API token or organization ID is needed here. Set the page&apos;s LinkedIn URL in the page editor.</p>
                  <label data-global-managed-field="1">Access Token<input name="access_token" type="text" data-manual-token-field="1" /></label>
                  <label data-global-managed-field="1">Refresh Token<input name="refresh_token" type="text" /></label>
                  <label data-connections-api-field="1">API Key<input name="api_key" type="text" /></label>
                  <label data-connections-api-field="1">API Secret<input name="api_secret" type="text" /></label>
                  <label data-connections-api-field="1">Access Token Secret<input name="access_token_secret" type="text" /></label>
                  <label data-meta-managed-field="1">Token Expires At<input name="token_expires_at" type="datetime-local" /></label>
                  <div class="row modal-actions">
                    <button type="submit">Add Connection</button>
                  </div>
                </form>
              `
              : "<p class='muted'>All supported platforms are already configured for this page.</p>"
          }
        </section>
      </section>
    </div>
  `;
}

function renderPageEditorModal() {
  if (!state.editingPageId) return "";
  const page = state.pages.find((item) => item.id === state.editingPageId);
  if (!page || !state.pageEditorSettings) return "";

  const accounts = page.social_accounts || [];
  const general = state.pageEditorSettings;
  const accountCards =
    accounts.length > 0
      ? accounts
          .map(
            (account) => `
              <article class="card">
                <div class="row between">
                  <div>
                    <h3>${escapeHtml(account.platform)}</h3>
                    <p>${escapeHtml(account.account_name || account.page_id_external || "Connected account")}</p>
                  </div>
                  <span class="pill ${account.is_active ? "" : "account-pill-inactive"}">${account.is_active ? "active" : "inactive"}</span>
                </div>
                <p class="muted">${account.platform === "linkedin" ? "Manual assist mode" : `External ID: ${escapeHtml(account.page_id_external || "-")}`}</p>
                ${canManageConnections() ? `<div class="row wrap"><button class="small ghost" type="button" data-page-editor-account-edit="${account.id}">Edit ${escapeHtml(account.platform)}</button></div>` : ""}
              </article>
            `
          )
          .join("")
      : "<p class='muted'>No connected social accounts for this page yet.</p>";

  return `
    <div class="modal-backdrop">
      <section class="modal panel">
        <div class="row between">
          <h2>Edit Page: ${escapeHtml(page.name)}</h2>
          <button class="small ghost" type="button" data-page-editor-close="1">Close</button>
        </div>
        <form id="page-editor-form">
          <section>
            <h3>Page Details</h3>
            <label>Name<input name="name" type="text" value="${escapeHtml(page.name || "")}" required /></label>
            <label>Description<textarea name="description" rows="3">${escapeHtml(page.description || "")}</textarea></label>
            <label>LinkedIn Page URL<input name="linkedin_page_url" type="url" value="${escapeHtml(page.linkedin_page_url || "")}" placeholder="https://www.linkedin.com/company/your-page/" /></label>
            <label>Image<input name="image" type="file" accept="image/*" /></label>
          </section>

          <section>
            <div class="row between wrap">
              <h3>Connected Socials</h3>
              ${canManageConnections() ? `<button class="small ghost" type="button" data-page-editor-manage-connections="${page.id}">Manage Connections</button>` : ""}
            </div>
            <p class="muted">${canManageConnections() ? "Nothing overrides just because you opened this editor. Platform changes only happen when you explicitly open and edit that platform." : "Connected socials are visible here for reference. This role cannot change platform connections."}</p>
            <div class="cards">${accountCards}</div>
          </section>

          <section>
            <h3>General Settings</h3>
            <p class="muted">Only settings you actually change here are saved as page-specific overrides.</p>
            <div class="grid two">
              <label>Default Post Time<input name="default_post_time" type="time" value="${escapeHtml(general.default_post_time || "10:00")}" /></label>
              <label>Timezone<input name="timezone" type="text" value="${escapeHtml(general.timezone || "Africa/Johannesburg")}" /></label>
            </div>
            <label class="checkbox">
              <input name="auto_schedule" type="checkbox" ${settingBool(general.auto_schedule, true) ? "checked" : ""} />
              Auto schedule planning rows for this page
            </label>
            <label class="checkbox">
              <input name="notification_enabled" type="checkbox" ${settingBool(general.notification_enabled, true) ? "checked" : ""} />
              Send warning emails for this page
            </label>
            <label class="checkbox">
              <input name="live_posting_enabled" type="checkbox" ${settingBool(general.live_posting_enabled, false) ? "checked" : ""} />
              Live posting enabled for this page
            </label>
          </section>

          <div class="row modal-actions">
            <button type="submit">Save Page</button>
            <button class="ghost" type="button" data-page-editor-close="1">Cancel</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderPageReferenceSheetModal() {
  const editor = state.pageReferenceSheetEditor;
  if (!editor) return "";

  const definition = pageReferenceSheetDefinition(editor.sheet_key);
  const activeKey = editor.activeCell ? `${editor.activeCell.rowIndex}:${editor.activeCell.columnIndex}` : "";
  const columns = Array.isArray(editor.columns) && editor.columns.length ? editor.columns : [definition.label];
  const rows = Array.isArray(editor.rows) && editor.rows.length ? editor.rows : [pageReferenceBlankRow(columns.length)];
  const statusLabel = editor.dirty ? "Unsaved changes" : "Saved";

  return `
    <div class="modal-backdrop">
      <section class="modal panel page-reference-modal">
        <div class="row between wrap">
          <div>
            <h2>${escapeHtml(definition.label)}</h2>
            <p class="muted">Internal Pages reference sheet for admin/developer use. Add rows/columns as needed and format text directly inside the grid.</p>
          </div>
          <div class="row wrap">
            <span class="pill">${escapeHtml(statusLabel)}</span>
            <button class="small ghost" type="button" data-page-reference-close="1">Close</button>
          </div>
        </div>

        <div class="page-reference-toolbar">
          <div class="row wrap page-reference-toolbar-row">
            <button type="button" class="small ghost" data-page-reference-command="bold"><strong>B</strong></button>
            <button type="button" class="small ghost" data-page-reference-command="italic"><em>I</em></button>
            <button type="button" class="small ghost" data-page-reference-command="underline"><u>U</u></button>
            <button type="button" class="small ghost" data-page-reference-block="P">Body</button>
            <button type="button" class="small ghost" data-page-reference-block="H1">H1</button>
            <button type="button" class="small ghost" data-page-reference-block="H2">H2</button>
            <button type="button" class="small ghost" data-page-reference-block="H3">H3</button>
            <label class="page-reference-size-label">Size
              <select id="page-reference-font-size">
                <option value="">Select</option>
                ${PAGE_REFERENCE_FONT_SIZES.map((size) => `<option value="${size}">${size}px</option>`).join("")}
              </select>
            </label>
            <button type="button" class="small ghost" data-page-reference-command="removeFormat">Clear Format</button>
          </div>
          <div class="row wrap page-reference-toolbar-row">
            <label class="page-reference-title-field">Sheet Title
              <input id="page-reference-title" type="text" value="${escapeHtml(editor.title || definition.label)}" maxlength="120" />
            </label>
            <button type="button" class="small ghost" data-page-reference-add-row="1">Add Row</button>
            <button type="button" class="small ghost" data-page-reference-add-column="1">Add Column</button>
          </div>
        </div>

        <div class="page-reference-grid-wrap">
          <table class="page-reference-table">
            <thead>
              <tr>
                <th class="page-reference-index-head">#</th>
                ${columns
                  .map(
                    (label, columnIndex) => `
                      <th>
                        <div class="page-reference-column-head">
                          <input
                            type="text"
                            value="${escapeHtml(label || pageReferenceColumnLabel(columnIndex))}"
                            data-page-reference-column-label="${columnIndex}"
                            maxlength="80"
                          />
                          <button
                            type="button"
                            class="small danger"
                            data-page-reference-delete-column="${columnIndex}"
                            ${columns.length <= 1 ? "disabled" : ""}
                            title="Delete column"
                          >x</button>
                        </div>
                      </th>
                    `
                  )
                  .join("")}
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (row, rowIndex) => `
                    <tr>
                      <th class="page-reference-row-head">
                        <span>${rowIndex + 1}</span>
                        <button
                          type="button"
                          class="small danger"
                          data-page-reference-delete-row="${rowIndex}"
                          ${rows.length <= 1 ? "disabled" : ""}
                          title="Delete row"
                        >x</button>
                      </th>
                      ${columns
                        .map((_, columnIndex) => {
                          const key = `${rowIndex}:${columnIndex}`;
                          return `
                            <td class="page-reference-grid-cell ${activeKey === key ? "active" : ""}">
                              <div
                                class="page-reference-editor"
                                contenteditable="true"
                                data-page-reference-cell="${key}"
                              >${row?.[columnIndex] || ""}</div>
                            </td>
                          `;
                        })
                        .join("")}
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>

        <div class="row modal-actions wrap">
          <button type="button" id="page-reference-save">Save Sheet</button>
          <button class="ghost" type="button" data-page-reference-close="1">Close</button>
        </div>
      </section>
    </div>
  `;
}

function renderPostEditorModal() {
  if (!state.editingPostId) return "";
  const post = getPostById(state.editingPostId);
  if (!post) return "";

  return `
    <div class="modal-backdrop">
      <section class="modal panel">
        <div class="row between">
          <h2>Edit Post #${post.id}</h2>
          <button class="small ghost" data-post-editor-close="1">Close</button>
        </div>
        <form id="post-editor-form">
          <label>Content
            <textarea name="content" rows="4">${escapeHtml(post.content || "")}</textarea>
          </label>
          <label>Scheduled Time
            <input name="scheduled_time" type="datetime-local" value="${escapeHtml(datetimeLocalValue(post.scheduled_time))}" />
          </label>
          <p class="muted">Platforms are locked to the page connections and cannot be changed here.</p>
          <fieldset>
            <legend>Keep Existing Media</legend>
            ${
              (post.media_paths || []).length
                ? post.media_paths
                    .map(
                      (path) => `
                        <label class="checkbox">
                          <input type="checkbox" name="existing_media" value="${escapeHtml(path)}" checked />
                          ${escapeHtml(path)}
                        </label>
                      `
                    )
                    .join("")
                : "<p class='muted'>No existing media.</p>"
            }
          </fieldset>
          <label>Add More Media
            <input name="media" type="file" multiple />
          </label>
          <div class="row">
            <button type="submit">Save Post</button>
            <button type="button" class="ghost" data-post-editor-close="1">Cancel</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderAccountEditorModal() {
  if (!state.editingAccountId) return "";
  const account = getAccountById(state.editingAccountId);
  if (!account) return "";
  const globalManaged = isGlobalManagedPlatform(account.platform);
  const linkedInManual = isLinkedInManagedPlatform(account.platform);
  const managedLabel = isMetaManagedPlatform(account.platform)
    ? `This ${escapeHtml(account.platform)} account uses the global Meta token from Settings. Only the external ID is edited here.`
    : `LinkedIn API automation is paused. This account stays in manual assist mode and does not use external IDs or API tokens right now.`;

  return `
    <div class="modal-backdrop">
      <section class="modal panel">
        <div class="row between">
          <h2>Edit Account #${account.id}</h2>
          <button class="small ghost" data-account-editor-close="1">Close</button>
        </div>
        <form id="account-editor-form">
          <label>Platform
            <select name="platform">
              ${PLATFORMS.map((platform) => `<option value="${platform}" ${account.platform === platform ? "selected" : ""}>${platform}</option>`).join("")}
            </select>
          </label>
          <label>Account Name<input name="account_name" type="text" value="${escapeHtml(account.account_name || "")}" /></label>
          ${linkedInManual ? "" : `<label>External ID<input name="page_id_external" type="text" value="${escapeHtml(account.page_id_external || "")}" /></label>`}
          ${globalManaged || linkedInManual ? `<p class="muted">${managedLabel}</p>` : `<label>Access Token<input name="access_token" type="text" placeholder="Leave blank to keep current token" /></label>`}
          ${globalManaged || linkedInManual ? "" : `<label>Refresh Token<input name="refresh_token" type="text" placeholder="Leave blank to keep current token" /></label>`}
          ${linkedInManual ? "" : `<label>API Key<input name="api_key" type="text" placeholder="Leave blank to keep current key" /></label>`}
          ${linkedInManual ? "" : `<label>API Secret<input name="api_secret" type="text" placeholder="Leave blank to keep current key" /></label>`}
          ${linkedInManual ? "" : `<label>Access Token Secret<input name="access_token_secret" type="text" placeholder="Leave blank to keep current value" /></label>`}
          ${globalManaged || linkedInManual ? "" : `<label>Token Expires At<input name="token_expires_at" type="datetime-local" value="${escapeHtml(datetimeLocalValue(account.token_expires_at))}" /></label>`}
          <label class="checkbox">
            <input name="is_active" type="checkbox" ${account.is_active ? "checked" : ""} />
            Account active
          </label>
          <div class="row">
            <button type="submit">Save Account</button>
            <button type="button" class="ghost" data-account-editor-close="1">Cancel</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderPlanningCreativeModal() {
  const editor = state.planningCreativeEditor;
  if (!editor) return "";

  const row = getPlanningRowById(editor.rowId);
  if (!row) return "";
  const violations = planningCreativeViolations(editor);
  const instagramConnected = planningCreativeInstagramEnabled(editor);
  const fbInstagramGuard = planningCreativeFacebookInstagramGuard(editor);

  const orderedCards =
    editor.items.length > 0
      ? editor.items
          .map((item, index) => {
            const typeLabel =
              item.kind === "pending"
                ? `New ${item.media_kind === "video" ? "video" : "image"}`
                : item.media_kind === "video" ? "Saved video" : "Saved image";
            const ratioMeta =
              instagramConnected && item.media_kind !== "video"
                ? item.ratio_error
                  ? `<p class="bad creative-box-status">${escapeHtml(item.ratio_error)}</p>`
                  : item.width && item.height
                  ? item.instagram_ratio_ok
                    ? `<p class="ok creative-box-status">Instagram-safe ratio: ${escapeHtml(item.width)}x${escapeHtml(item.height)} (${escapeHtml((item.ratio_value || 0).toFixed(2))}:1)</p>`
                    : `<p class="bad creative-box-status">Instagram requires 4:5 to 1.91:1. Current image is ${escapeHtml(item.width)}x${escapeHtml(item.height)} (${escapeHtml((item.ratio_value || 0).toFixed(2))}:1).</p>`
                  : `<p class="muted creative-box-status">Inspecting image ratio...</p>`
                : "";
            return `
              <article class="creative-box-card">
                <div class="creative-box-preview-wrap">
                  <span class="creative-box-order-badge">#${index + 1}</span>
                  ${
                    item.url
                      ? item.media_kind === "video"
                        ? `<video src="${escapeHtml(item.url)}" controls class="creative-box-preview"></video>`
                        : `<img src="${escapeHtml(item.url)}" alt="Creative asset" class="creative-box-preview" />`
                      : `<div class="creative-box-preview creative-box-empty">Unavailable</div>`
                  }
                </div>
                <div class="creative-box-card-meta">
                  <div>
                    <p class="creative-box-filename">${escapeHtml(item.name || item.path || "Creative asset")}</p>
                    <p class="muted">${escapeHtml(typeLabel)}${item.size ? ` | ${Math.round(item.size / 1024)} KB` : ""}</p>
                    ${ratioMeta}
                  </div>
                  <div class="creative-box-actions">
                    ${
                      instagramConnected && item.media_kind !== "video" && item.instagram_ratio_ok === false
                        ? `<button type="button" class="small" data-planning-crop-open="${escapeHtml(item.id)}">Fix Ratio</button>`
                        : ""
                    }
                    <button type="button" class="small ghost" data-planning-creative-move="${index}:-1" ${index === 0 ? "disabled" : ""}>Earlier</button>
                    <button type="button" class="small ghost" data-planning-creative-move="${index}:1" ${index === editor.items.length - 1 ? "disabled" : ""}>Later</button>
                    <button type="button" class="small danger" data-planning-creative-remove="${index}">Remove</button>
                  </div>
                </div>
              </article>
            `;
          })
          .join("")
      : "<p class='muted'>No creatives on this row. Add images or videos below.</p>";

  return `
    <div class="modal-backdrop">
      <section class="modal panel creative-box-modal">
        <div class="row between">
          <div>
            <h2>Creative Box</h2>
            <p class="muted">Planner row #${escapeHtml(String(row.row_order || row.id))} for ${escapeHtml(row.job_nr || row.theme || "untitled work")}</p>
          </div>
          <button class="small ghost" type="button" data-close-planning-creative="1">Close</button>
        </div>
        <form id="planning-creative-form">
          <section>
            <h3>Creative Order</h3>
            <p class="muted">This order is locked into the scheduled post and is the exact order sent to social platforms.</p>
            ${
              fbInstagramGuard
                ? `<p class="muted">This page is connected to both Facebook and Instagram. This row may contain either images only or one video only. Mixed media and multiple videos are blocked.</p>`
                : ""
            }
            ${
              instagramConnected
                ? `<p class="muted">Instagram image uploads must stay within the API-safe 4:5 to 1.91:1 feed range. Invalid images can be cropped here before saving.</p>`
                : ""
            }
            ${
              violations.length
                ? `<div class="creative-box-warning-list">${violations.map((message) => `<p class="bad">${escapeHtml(message)}</p>`).join("")}</div>`
                : ""
            }
            <div class="creative-box-grid">${orderedCards}</div>
          </section>
          <section>
            <h3>Add Images or Videos</h3>
            <label>Upload files
              <input id="planning-creative-files" type="file" accept="image/*,video/*" multiple />
            </label>
          </section>
          <div class="row modal-actions">
            <button type="submit">Save Creatives</button>
            <button class="ghost" type="button" data-close-planning-creative="1">Cancel</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderPlanningCreativeCropperModal() {
  const cropper = state.planningCreativeCropper;
  if (!cropper) return "";
  const metrics = planningCropperMetrics(cropper);
  if (!metrics) return "";

  return `
    <div class="modal-backdrop">
      <section class="modal panel creative-crop-modal">
        <div class="row between wrap">
          <div>
            <h2>Instagram Cropper</h2>
            <p class="muted">Crop this image to an Instagram API-safe feed ratio. Only accepted presets are shown here.</p>
          </div>
          <button class="small ghost" type="button" data-planning-crop-close="1">Close</button>
        </div>
        <div class="grid two cropper-layout">
          <section>
            <div
              id="planning-crop-stage"
              class="creative-crop-stage"
              style="width:${metrics.stageWidth}px;height:${metrics.stageHeight}px;"
            >
              <img
                id="planning-crop-image"
                src="${escapeHtml(cropper.sourceUrl)}"
                alt="Crop preview"
                class="creative-crop-image"
                style="width:${metrics.renderedWidth}px;height:${metrics.renderedHeight}px;transform:translate(${metrics.offsetX}px, ${metrics.offsetY}px);"
              />
            </div>
          </section>
          <section class="creative-crop-controls">
            <div class="creative-crop-presets">
              ${INSTAGRAM_CROP_PRESETS.map(
                (preset) => `
                  <button
                    type="button"
                    class="small ${cropper.presetId === preset.id ? "" : "ghost"}"
                    data-planning-crop-preset="${preset.id}"
                  >${escapeHtml(preset.label)}</button>
                `
              ).join("")}
            </div>
            <label>Zoom
              <input id="planning-crop-zoom" type="range" min="1" max="3" step="0.01" value="${escapeHtml(String(cropper.zoom))}" />
            </label>
            <label>Horizontal Position
              <input id="planning-crop-position-x" type="range" min="0" max="100" step="1" value="${escapeHtml(String(cropper.positionX))}" />
            </label>
            <label>Vertical Position
              <input id="planning-crop-position-y" type="range" min="0" max="100" step="1" value="${escapeHtml(String(cropper.positionY))}" />
            </label>
            <p class="muted" id="planning-crop-preview-meta">Output preview: ${escapeHtml(metrics.preset.label)} at ${metrics.stageWidth} x ${metrics.stageHeight}</p>
            <div class="row modal-actions">
              <button type="button" id="planning-crop-apply">Apply Crop</button>
              <button class="ghost" type="button" data-planning-crop-close="1">Cancel</button>
            </div>
          </section>
        </div>
      </section>
    </div>
  `;
}
function wireGlobalControls() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.activeTab = button.getAttribute("data-tab");
      if (["settings", "integrations"].includes(state.activeTab)) {
        renderApp();
        return;
      }
      try {
        await refreshAfterManualAction();
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.getElementById("refresh-data")?.addEventListener("click", async () => {
    try {
      await loadDashboardData();
      renderApp();
      notify("Data refreshed", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });

  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // Ignore local logout failure.
    }
    clearSession();
    renderLogin();
  });
}

function wireActiveTab() {
  if (state.activeTab === "pages") {
    wirePagesTab();
    wirePageEditorModal();
    return;
  }
  if (state.activeTab === "scheduled" || state.activeTab === "posted") {
    wireTimelineTab(state.activeTab);
    return;
  }
  if (state.activeTab === "planning") {
    wirePlanningTab();
    return;
  }
  if (state.activeTab === "settings") {
    wireSettingsTab();
    return;
  }
  if (state.activeTab === "integrations") {
    wireIntegrationsTab();
  }
}

function wirePagesTab() {
  document.getElementById("page-search")?.addEventListener("input", (event) => {
    const cursor = event.currentTarget.selectionStart ?? null;
    state.pageSearch = event.currentTarget.value;
    renderApp();
    const input = document.getElementById("page-search");
    if (input) {
      input.focus();
      if (cursor !== null) input.setSelectionRange(cursor, cursor);
    }
  });

  document.querySelector('[data-open-create-page="1"]')?.addEventListener("click", () => {
    state.createPageOpen = true;
    renderApp();
  });

  document.querySelectorAll("[data-page-open-create-post]").forEach((button) => {
    button.addEventListener("click", () => {
      state.createPostPageId = Number(button.getAttribute("data-page-open-create-post"));
      renderApp();
    });
  });

  document.querySelectorAll("[data-page-manage-connections]").forEach((button) => {
    button.addEventListener("click", () => {
      state.manageConnectionsPageId = Number(button.getAttribute("data-page-manage-connections"));
      renderApp();
    });
  });

  document.querySelectorAll("[data-page-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-page-delete");
      if (!window.confirm("Delete this page with all accounts and posts?")) return;
      try {
        await api(`/pages/${id}`, { method: "DELETE" });
        await loadDashboardData();
        renderApp();
        notify("Page deleted", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-page-edit]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.getAttribute("data-page-edit"));
      const page = state.pages.find((item) => item.id === id);
      if (!page) return;
      try {
        const settingsPayload = await api(`/pages/${id}/settings`);
        state.editingPageId = id;
        state.pageEditorSettings = {
          default_post_time: settingsPayload.effective?.default_post_time || "10:00",
          timezone: settingsPayload.effective?.timezone || "Africa/Johannesburg",
          auto_schedule: settingsPayload.effective?.auto_schedule ?? "true",
          notification_enabled: settingsPayload.effective?.notification_enabled ?? "true",
          live_posting_enabled: settingsPayload.effective?.live_posting_enabled ?? "false",
        };
        state.pageEditorInitialSettings = { ...state.pageEditorSettings };
        renderApp();
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-global-reference-sheet-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      const sheetKey = String(button.getAttribute("data-global-reference-sheet-open") || "").trim();
      if (!sheetKey) return;
      try {
        const payload = await api(`/reference-sheets/${sheetKey}`);
        state.pageReferenceSheetEditor = {
          ...payload,
          dirty: false,
          activeCell: null,
        };
        renderApp();
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });
}

function wireCreatePageModal() {
  document.querySelectorAll("[data-close-create-page]").forEach((button) => {
    button.addEventListener("click", () => {
      state.createPageOpen = false;
      renderApp();
    });
  });

  const toggleConfigBlock = (platform, enabled) => {
    const block = document.querySelector(`[data-platform-config="${platform}"]`);
    if (!block) return;
    block.hidden = !enabled;
    block.querySelectorAll("input, select, textarea").forEach((field) => {
      field.disabled = !enabled;
    });
  };

  document.querySelectorAll("[data-platform-toggle]").forEach((checkbox) => {
    toggleConfigBlock(checkbox.getAttribute("data-platform-toggle"), checkbox.checked);
    checkbox.addEventListener("change", () => {
      const platform = checkbox.getAttribute("data-platform-toggle");
      toggleConfigBlock(platform, checkbox.checked);
    });
  });

  document.getElementById("create-page-modal-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const selectedPlatforms = Array.from(
      form.querySelectorAll('input[name="wizard_platforms"]:checked')
    ).map((input) => input.value);

    if (!selectedPlatforms.length) {
      notify("Select at least one platform in the setup checklist.", "error");
      return;
    }
    if (selectedPlatforms.some((platform) => isMetaManagedPlatform(platform)) && !globalMetaStatus().configured) {
      notify("Set the global Meta user token in Settings before adding Facebook or Instagram pages.", "error");
      return;
    }
    const linkedinPageUrl = String(formData.get("linkedin_page_url") || "").trim();
    if (selectedPlatforms.some((platform) => isLinkedInManagedPlatform(platform)) && !linkedinPageUrl) {
      notify("Add the LinkedIn page URL so manual LinkedIn scheduling can open the correct page.", "error");
      return;
    }

    const pagePayload = new FormData();
    pagePayload.set("name", String(formData.get("name") || "").trim());
    pagePayload.set("description", String(formData.get("description") || "").trim());
    pagePayload.set("linkedin_page_url", linkedinPageUrl);

    const image = form.querySelector('input[name="image"]')?.files?.[0];
    if (image) pagePayload.append("image", image);

    try {
      const page = await api("/pages", { method: "POST", body: pagePayload });
      const failures = [];

      for (const platform of selectedPlatforms) {
        const payload = {
          platform,
          ...buildAccountPayloadFromFormData(formData, `${platform}_`),
        };
        try {
          await api(`/pages/${page.id}/accounts`, { method: "POST", body: payload });
        } catch (error) {
          failures.push(`${platform}: ${error.message}`);
        }
      }

      state.createPageOpen = false;
      if (failures.length) {
        state.manageConnectionsPageId = page.id;
      }

      await loadDashboardData();
      renderApp();

      if (failures.length) {
        notify(`Page created. Some platform setups failed: ${failures.join(" | ")}`, "error");
      } else {
        notify("Page created with platform setup", "success");
      }
    } catch (error) {
      notify(error.message, "error");
    }
  });
}

function wireCreatePostModal() {
  document.querySelectorAll("[data-close-create-post]").forEach((button) => {
    button.addEventListener("click", () => {
      state.createPostPageId = null;
      renderApp();
    });
  });

  document.getElementById("create-post-modal-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.createPostPageId) return;

    const formData = new FormData(event.currentTarget);
    const scheduledInput = String(formData.get("scheduled_time") || "");
    if (scheduledInput) {
      formData.set("scheduled_time", localInputToIso(scheduledInput));
    } else {
      formData.delete("scheduled_time");
    }

    try {
      await api(`/pages/${state.createPostPageId}/posts`, { method: "POST", body: formData });
      state.createPostPageId = null;
      state.activeTab = "scheduled";
      await loadDashboardData();
      renderApp();
      notify("Post saved", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });
}

function wireConnectionsModal() {
  document.querySelectorAll("[data-close-connections]").forEach((button) => {
    button.addEventListener("click", () => {
      state.manageConnectionsPageId = null;
      renderApp();
    });
  });

  const platformSelect = document.querySelector('#connections-add-form select[name="platform"]');
  const toggleManagedTokenFields = () => {
    const platform = String(platformSelect?.value || "").trim().toLowerCase();
    const managedFieldLabels = document.querySelectorAll("[data-global-managed-field='1']");
    const managedNote = document.getElementById("connections-managed-note");
    const linkedinManualNote = document.getElementById("connections-linkedin-manual-note");
    const externalIdLabel = document.querySelector("[data-connections-external-id='1']");
    const apiLabels = document.querySelectorAll("[data-connections-api-field='1']");
    const managed = isGlobalManagedPlatform(platform);
    const linkedInManual = isLinkedInManagedPlatform(platform);
    const hideTokenFields = managed || linkedInManual;
    managedFieldLabels.forEach((label) => {
      label.hidden = hideTokenFields;
      const input = label.querySelector("input");
      if (!input) return;
      input.disabled = hideTokenFields;
      if (hideTokenFields) input.value = "";
    });
    if (managedNote) {
      managedNote.hidden = !managed;
    }
    if (externalIdLabel) {
      const hideExternalId = isLinkedInManagedPlatform(platform);
      externalIdLabel.hidden = hideExternalId;
      const input = externalIdLabel.querySelector("input");
      if (input) {
        input.disabled = hideExternalId;
        if (hideExternalId) input.value = "";
      }
    }
    apiLabels.forEach((label) => {
      label.hidden = linkedInManual;
      const input = label.querySelector("input");
      if (!input) return;
      input.disabled = linkedInManual;
      if (linkedInManual) input.value = "";
    });
    if (linkedinManualNote) {
      linkedinManualNote.hidden = !linkedInManual;
    }
  };
  if (platformSelect) {
    toggleManagedTokenFields();
    platformSelect.addEventListener("change", toggleManagedTokenFields);
  }

  document.getElementById("connections-add-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.manageConnectionsPageId) return;

    const formData = new FormData(event.currentTarget);
    const platform = String(formData.get("platform") || "").trim().toLowerCase();
    if (!platform) {
      notify("Choose a platform to connect.", "error");
      return;
    }
    if (isMetaManagedPlatform(platform) && !globalMetaStatus().configured) {
      notify("Set the global Meta user token in Settings before adding Facebook or Instagram accounts.", "error");
      return;
    }
    const page = state.pages.find((item) => Number(item.id) === Number(state.manageConnectionsPageId));
    if (isLinkedInManagedPlatform(platform) && !String(page?.linkedin_page_url || "").trim()) {
      notify("Add the LinkedIn page URL in the page editor before connecting LinkedIn manual mode.", "error");
      return;
    }

    const payload = {
      platform,
      ...buildAccountPayloadFromFormData(formData),
    };

    try {
      await api(`/pages/${state.manageConnectionsPageId}/accounts`, {
        method: "POST",
        body: payload,
      });
      await loadDashboardData();
      renderApp();
      notify("Platform connected", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });

  document.querySelectorAll("[data-connection-test]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-connection-test");
      try {
        const payload = await api(`/accounts/${id}/test`, { method: "POST" });
        await loadDashboardData();
        renderApp();
        notify(payload.message || "Account test successful", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-connection-refresh]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-connection-refresh");
      try {
        const payload = await api(`/accounts/${id}/refresh`, { method: "POST" });
        await loadDashboardData();
        renderApp();
        notify(payload.message || "Token refreshed", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-connection-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-connection-delete");
      if (!window.confirm("Delete this account connection?")) return;
      try {
        await api(`/accounts/${id}`, { method: "DELETE" });
        await loadDashboardData();
        renderApp();
        notify("Account deleted", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-connection-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingAccountId = Number(button.getAttribute("data-connection-edit"));
      state.manageConnectionsPageId = null;
      renderApp();
    });
  });
}

function wirePageEditorModal() {
  document.querySelectorAll("[data-page-editor-close]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingPageId = null;
      state.pageEditorSettings = null;
      state.pageEditorInitialSettings = null;
      renderApp();
    });
  });

  document.querySelectorAll("[data-page-editor-manage-connections]").forEach((button) => {
    button.addEventListener("click", () => {
      const pageId = Number(button.getAttribute("data-page-editor-manage-connections"));
      state.editingPageId = null;
      state.pageEditorSettings = null;
      state.pageEditorInitialSettings = null;
      state.manageConnectionsPageId = pageId;
      renderApp();
    });
  });

  document.querySelectorAll("[data-page-editor-account-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const accountId = Number(button.getAttribute("data-page-editor-account-edit"));
      state.editingPageId = null;
      state.pageEditorSettings = null;
      state.pageEditorInitialSettings = null;
      state.editingAccountId = accountId;
      renderApp();
    });
  });

  document.getElementById("page-editor-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.editingPageId || !state.pageEditorSettings || !state.pageEditorInitialSettings) return;

    const page = state.pages.find((item) => item.id === state.editingPageId);
    if (!page) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const pagePayload = new FormData();
    const nextName = String(data.get("name") || "").trim();
    const nextDescription = String(data.get("description") || "").trim();
    const nextLinkedInPageUrl = String(data.get("linkedin_page_url") || "").trim();
    const image = form.querySelector('input[name="image"]')?.files?.[0];

    if (!nextName) {
      notify("Page name cannot be empty.", "error");
      return;
    }

    let pageChanged = false;
    if (nextName !== String(page.name || "")) {
      pagePayload.set("name", nextName);
      pageChanged = true;
    }
    if (nextDescription !== String(page.description || "")) {
      pagePayload.set("description", nextDescription);
      pageChanged = true;
    }
    if (nextLinkedInPageUrl !== String(page.linkedin_page_url || "")) {
      pagePayload.set("linkedin_page_url", nextLinkedInPageUrl);
      pageChanged = true;
    }
    if (image) {
      pagePayload.append("image", image);
      pageChanged = true;
    }

    const nextSettings = {
      default_post_time: String(data.get("default_post_time") || ""),
      timezone: String(data.get("timezone") || "").trim(),
      auto_schedule: data.get("auto_schedule") ? "true" : "false",
      notification_enabled: data.get("notification_enabled") ? "true" : "false",
      live_posting_enabled: data.get("live_posting_enabled") ? "true" : "false",
    };
    const settingsPayload = {};
    for (const [key, value] of Object.entries(nextSettings)) {
      if (String(value) !== String(state.pageEditorInitialSettings[key] ?? "")) {
        settingsPayload[key] = value;
      }
    }

    try {
      if (pageChanged) {
        await api(`/pages/${state.editingPageId}`, { method: "PUT", body: pagePayload });
      }
      if (Object.keys(settingsPayload).length) {
        await api(`/pages/${state.editingPageId}/settings`, { method: "PUT", body: settingsPayload });
      }
      state.editingPageId = null;
      state.pageEditorSettings = null;
      state.pageEditorInitialSettings = null;
      await refreshAfterManualAction();
      notify(pageChanged || Object.keys(settingsPayload).length ? "Page updated" : "No page changes to save", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });
}

function wirePageReferenceSheetModal() {
  if (!state.pageReferenceSheetEditor) return;

  document.querySelectorAll("[data-page-reference-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closePageReferenceSheetEditor();
    });
  });

  document.getElementById("page-reference-title")?.addEventListener("input", (event) => {
    if (!state.pageReferenceSheetEditor) return;
    state.pageReferenceSheetEditor.title = event.currentTarget.value;
    state.pageReferenceSheetEditor.dirty = true;
  });

  document.querySelectorAll("[data-page-reference-column-label]").forEach((input) => {
    input.addEventListener("input", (event) => {
      if (!state.pageReferenceSheetEditor) return;
      const columnIndex = Number(event.currentTarget.getAttribute("data-page-reference-column-label"));
      if (!Number.isInteger(columnIndex)) return;
      state.pageReferenceSheetEditor.columns[columnIndex] = event.currentTarget.value || pageReferenceColumnLabel(columnIndex);
      state.pageReferenceSheetEditor.dirty = true;
    });
  });

  document.querySelectorAll("[data-page-reference-cell]").forEach((cell) => {
    const activate = () => {
      const token = String(cell.getAttribute("data-page-reference-cell") || "");
      const [rowRaw, columnRaw] = token.split(":");
      const rowIndex = Number(rowRaw);
      const columnIndex = Number(columnRaw);
      if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex) || !state.pageReferenceSheetEditor) return;
      state.pageReferenceSheetEditor.activeCell = { rowIndex, columnIndex };
      document.querySelectorAll(".page-reference-grid-cell.active").forEach((item) => item.classList.remove("active"));
      cell.closest(".page-reference-grid-cell")?.classList.add("active");
    };

    cell.addEventListener("focus", activate);
    cell.addEventListener("click", activate);
    cell.addEventListener("input", () => {
      syncPageReferenceCellValueFromElement(cell);
    });
  });

  document.querySelectorAll("[data-page-reference-command]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      applyPageReferenceCommand(button.getAttribute("data-page-reference-command"));
    });
  });

  document.querySelectorAll("[data-page-reference-block]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const block = String(button.getAttribute("data-page-reference-block") || "P").toUpperCase();
      applyPageReferenceCommand("formatBlock", `<${block}>`);
    });
  });

  document.getElementById("page-reference-font-size")?.addEventListener("change", (event) => {
    const size = Number(event.currentTarget.value);
    if (Number.isFinite(size) && size > 0) {
      applyPageReferenceFontSize(size);
    }
    event.currentTarget.value = "";
  });

  document.querySelector("[data-page-reference-add-row]")?.addEventListener("click", () => {
    if (!state.pageReferenceSheetEditor) return;
    state.pageReferenceSheetEditor.rows.push(pageReferenceBlankRow(state.pageReferenceSheetEditor.columns.length));
    state.pageReferenceSheetEditor.dirty = true;
    renderApp();
  });

  document.querySelector("[data-page-reference-add-column]")?.addEventListener("click", () => {
    if (!state.pageReferenceSheetEditor) return;
    const nextIndex = state.pageReferenceSheetEditor.columns.length;
    state.pageReferenceSheetEditor.columns.push(pageReferenceColumnLabel(nextIndex));
    state.pageReferenceSheetEditor.rows = state.pageReferenceSheetEditor.rows.map((row) => [...row, ""]);
    state.pageReferenceSheetEditor.dirty = true;
    renderApp();
  });

  document.querySelectorAll("[data-page-reference-delete-row]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.pageReferenceSheetEditor) return;
      const rowIndex = Number(button.getAttribute("data-page-reference-delete-row"));
      if (!Number.isInteger(rowIndex) || state.pageReferenceSheetEditor.rows.length <= 1) return;
      state.pageReferenceSheetEditor.rows.splice(rowIndex, 1);
      if (state.pageReferenceSheetEditor.activeCell && state.pageReferenceSheetEditor.activeCell.rowIndex >= state.pageReferenceSheetEditor.rows.length) {
        state.pageReferenceSheetEditor.activeCell = null;
      }
      state.pageReferenceSheetEditor.dirty = true;
      renderApp();
    });
  });

  document.querySelectorAll("[data-page-reference-delete-column]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.pageReferenceSheetEditor) return;
      const columnIndex = Number(button.getAttribute("data-page-reference-delete-column"));
      if (!Number.isInteger(columnIndex) || state.pageReferenceSheetEditor.columns.length <= 1) return;
      state.pageReferenceSheetEditor.columns.splice(columnIndex, 1);
      state.pageReferenceSheetEditor.rows = state.pageReferenceSheetEditor.rows.map((row) =>
        row.filter((_, index) => index !== columnIndex)
      );
      if (state.pageReferenceSheetEditor.activeCell && state.pageReferenceSheetEditor.activeCell.columnIndex >= state.pageReferenceSheetEditor.columns.length) {
        state.pageReferenceSheetEditor.activeCell = null;
      }
      state.pageReferenceSheetEditor.dirty = true;
      renderApp();
    });
  });

  document.getElementById("page-reference-save")?.addEventListener("click", async () => {
    if (!state.pageReferenceSheetEditor) return;
    syncActivePageReferenceCellValue();
    const currentEditor = state.pageReferenceSheetEditor;
    try {
      const payload = await api(`/reference-sheets/${currentEditor.sheet_key}`, {
        method: "PUT",
        body: {
          title: currentEditor.title,
          columns: currentEditor.columns,
          rows: currentEditor.rows,
        },
      });
      state.pageReferenceSheetEditor = {
        ...payload,
        dirty: false,
        activeCell: currentEditor.activeCell,
      };
      renderApp();
      notify(payload.message || "Page sheet saved", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });
}

function wireTimelineTab(tab) {
  document.querySelectorAll(`[data-filter-all="${tab}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      state.filters[tab] = allPageIds();
      renderApp();
    });
  });

  document.querySelectorAll(`[data-filter-none="${tab}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      state.filters[tab] = [];
      renderApp();
    });
  });

  document.querySelectorAll(`[data-filter-checkbox="${tab}"]`).forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = Number(checkbox.value);
      const current = new Set(state.filters[tab]);
      if (checkbox.checked) current.add(id);
      else current.delete(id);
      state.filters[tab] = Array.from(current);
      renderApp();
    });
  });

  document.querySelectorAll(`[data-view-mode="${tab}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      state.viewMode[tab] = button.getAttribute("data-mode");
      renderApp();
    });
  });

  if (state.viewMode[tab] === "calendar") {
    document.querySelector(`[data-calendar-prev="${tab}"]`)?.addEventListener("click", () => {
      const month = state.calendarMonth[tab];
      state.calendarMonth[tab] = new Date(month.getFullYear(), month.getMonth() - 1, 1);
      renderApp();
    });

    document.querySelector(`[data-calendar-next="${tab}"]`)?.addEventListener("click", () => {
      const month = state.calendarMonth[tab];
      state.calendarMonth[tab] = new Date(month.getFullYear(), month.getMonth() + 1, 1);
      renderApp();
    });

    document.querySelectorAll(`[data-calendar-day="${tab}"]`).forEach((button) => {
      button.addEventListener("click", () => {
        state.calendarSelectedDate[tab] = button.getAttribute("data-date");
        renderApp();
      });
    });
  }

}

function wirePostActionButtons() {
  document.querySelectorAll("[data-close-linkedin-manual-popup]").forEach((button) => {
    button.addEventListener("click", () => {
      dismissLinkedInManualPopup();
      renderApp();
    });
  });

  document.querySelectorAll("[data-post-copy-text]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.getAttribute("data-post-copy-text"));
      const post = getPostById(id);
      if (!post) return;
      try {
        await copyPlainText(post.content || "");
        notify("Post text copied", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-post-linkedin-manual-complete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-post-linkedin-manual-complete");
      try {
        await api(`/posts/${id}/linkedin/manual`, { method: "POST", body: { done: true } });
        await loadDashboardData();
        renderApp();
        notify("LinkedIn manual step marked done", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-post-linkedin-manual-reset]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-post-linkedin-manual-reset");
      try {
        await api(`/posts/${id}/linkedin/manual`, { method: "POST", body: { done: false } });
        await loadDashboardData();
        renderApp();
        notify("LinkedIn manual task reopened", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-post-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-post-delete");
      if (!window.confirm("Delete this post?")) return;
      try {
        await api(`/posts/${id}`, { method: "DELETE" });
        await loadDashboardData();
        renderApp();
        notify("Post deleted", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-post-publish]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-post-publish");
      try {
        await api(`/posts/${id}/publish`, { method: "POST" });
        await loadDashboardData();
        renderApp();
        notify("Publish triggered", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-post-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingPostId = Number(button.getAttribute("data-post-edit"));
      renderApp();
    });
  });
}
function wireSettingsTab() {
  document.getElementById("settings-scope-select")?.addEventListener("change", async (event) => {
    state.settingsScopePageId = normalizeScopePageId(event.currentTarget.value);
    try {
      await loadSettingsScopeData();
      renderApp();
    } catch (error) {
      notify(error.message, "error");
    }
  });

  document.getElementById("user-editor-reset")?.addEventListener("click", () => {
    resetUserEditor();
    renderApp();
  });

  document.querySelectorAll("[data-user-reset]").forEach((button) => {
    button.addEventListener("click", () => {
      resetUserEditor();
      renderApp();
    });
  });

  document.querySelectorAll("[data-user-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const username = String(button.getAttribute("data-user-edit") || "");
      const user = state.users.find((item) => String(item.username || "") === username);
      if (!user) return;
      if (!canManageOwnerRecord(user)) {
        notify("Only the owner account can edit the owner account.", "error");
        return;
      }
      setUserEditor(user);
      renderApp();
    });
  });

  document.querySelectorAll("[data-user-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const username = String(button.getAttribute("data-user-delete") || "");
      if (!username) return;
      const user = state.users.find((item) => String(item.username || "") === username);
      if (user && !canManageOwnerRecord(user)) {
        notify("Only the owner account can manage the owner account.", "error");
        return;
      }
      if (!window.confirm(`Delete user ${username}?`)) return;

      try {
        await api(`/users/${encodeURIComponent(username)}`, { method: "DELETE" });
        if (state.userEditor?.username === username) {
          resetUserEditor();
        }
        await Promise.all([
          loadUsersData(),
          loadPlanningPageData(state.planningPageId, false),
          loadSettingsScopeData(),
        ]);
        renderApp();
        notify("User deleted", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.getElementById("user-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (state.userEditor?.mode === "edit" && state.userEditor?.is_owner && !isOwnerUser()) {
      notify("Only the owner account can edit the owner account.", "error");
      return;
    }
    const data = new FormData(form);
    const payload = {
      username: String(data.get("username") || "").trim(),
      display_name: String(data.get("display_name") || "").trim(),
      email: String(data.get("email") || "").trim(),
      role: String(data.get("role") || state.userEditor.role || "designer").trim().toLowerCase(),
      is_active: Boolean(form.querySelector('input[name="is_active"]')?.checked ?? state.userEditor.is_active),
      password: String(data.get("password") || ""),
    };

    if (!payload.display_name) delete payload.display_name;
    if (!payload.email) delete payload.email;
    if (!payload.password) delete payload.password;

    try {
      const editing = state.userEditor?.mode === "edit";
      const response = await api(
        editing ? `/users/${encodeURIComponent(state.userEditor.username)}` : "/users",
        { method: editing ? "PUT" : "POST", body: payload }
      );
      if (String(state.user?.username || "") === String(response?.username || "")) {
        state.user = { ...state.user, ...response };
        saveSession();
      }
      resetUserEditor();
      await Promise.all([
        loadUsersData(),
        loadPlanningPageData(state.planningPageId, false),
        loadSettingsScopeData(),
      ]);
      renderApp();
      notify(editing ? "User updated" : "User created", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });

  document.getElementById("settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = Object.fromEntries(data.entries());
    const isPageScope = state.settingsScopePageId !== null;
    if (isPageScope) {
      delete payload.app_name;
      delete payload.facebook_app_id;
      delete payload.facebook_app_secret;
      delete payload.global_meta_user_token;
      delete payload.global_linkedin_access_token;
      delete payload.global_linkedin_refresh_token;
      delete payload.global_linkedin_token_expires_at;
      delete payload.global_linkedin_refresh_token_expires_at;
      delete payload.designer_email_map;
    }
    if (!isPageScope && String(payload.global_meta_user_token || "") === String(state.settings.global_meta_user_token || "")) {
      delete payload.global_meta_user_token;
    }
    if (!isPageScope && String(payload.facebook_app_id || "") === String(state.settings.facebook_app_id || "")) {
      delete payload.facebook_app_id;
    }
    if (!isPageScope && String(payload.facebook_app_secret || "") === String(state.settings.facebook_app_secret || "")) {
      delete payload.facebook_app_secret;
    }
    if (!isPageScope && String(payload.monthly_insights_spreadsheet || "") === String(state.settings.monthly_insights_spreadsheet || "")) {
      delete payload.monthly_insights_spreadsheet;
    }
    if (!isPageScope && String(payload.monthly_insights_meta_api_version || "") === String(state.settings.monthly_insights_meta_api_version || "")) {
      delete payload.monthly_insights_meta_api_version;
    }
    if (!isPageScope && String(payload.monthly_insights_google_service_account_json || "") === String(state.settings.monthly_insights_google_service_account_json || "")) {
      delete payload.monthly_insights_google_service_account_json;
    }
    if (!isPageScope && String(payload.global_linkedin_access_token || "") === String(state.settings.global_linkedin_access_token || "")) {
      delete payload.global_linkedin_access_token;
    }
    if (!isPageScope && String(payload.global_linkedin_refresh_token || "") === String(state.settings.global_linkedin_refresh_token || "")) {
      delete payload.global_linkedin_refresh_token;
    }
    if (!isPageScope && String(payload.global_linkedin_token_expires_at || "") === String(datetimeLocalValue(state.settings.global_linkedin_token_expires_at) || "")) {
      delete payload.global_linkedin_token_expires_at;
    }
    if (!isPageScope && String(payload.global_linkedin_refresh_token_expires_at || "") === String(datetimeLocalValue(state.settings.global_linkedin_refresh_token_expires_at) || "")) {
      delete payload.global_linkedin_refresh_token_expires_at;
    }
    if (!isPageScope && String(payload.designer_email_map || "") === String(state.settings.designer_email_map || "")) {
      delete payload.designer_email_map;
    }

    try {
      const path = isPageScope ? `/pages/${state.settingsScopePageId}/settings` : "/settings";
      const response = await api(path, { method: "PUT", body: payload });
      await Promise.all([loadSettingsScopeData(), loadIntegrationsScopeData()]);
      renderApp();
      if (response?.meta_token_result?.message) {
        notify(response.meta_token_result.message, "success", 11000);
      }
      if (response?.linkedin_token_result?.message) {
        notify(response.linkedin_token_result.message, "success", 11000);
      } else if (response?.warnings?.length) {
        notify(`Settings saved with warnings: ${response.warnings.join(" | ")}`, "error", 12000);
      } else {
        notify("Settings saved", "success");
      }
      if (response?.warnings?.length) {
        notify(`Settings saved with warnings: ${response.warnings.join(" | ")}`, "error", 12000);
      }
    } catch (error) {
      notify(error.message, "error");
    }
  });
}

function wireIntegrationsTab() {
  document.getElementById("integrations-scope-select")?.addEventListener("change", async (event) => {
    state.integrationsScopePageId = normalizeScopePageId(event.currentTarget.value);
    try {
      await loadIntegrationsScopeData();
      renderApp();
    } catch (error) {
      notify(error.message, "error");
    }
  });

  document.getElementById("refresh-integrations")?.addEventListener("click", async () => {
    try {
      await loadIntegrationsScopeData();
      renderApp();
      notify("Integration checks refreshed", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });

  document.getElementById("run-monthly-insights-sync")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "Syncing...";
    try {
      const result = await api("/integrations/monthly-sheet-sync", { method: "POST" });
      state.monthlyInsightsSyncResult = result;
      await loadIntegrationsScopeData();
      renderApp();
      notify(result.message || "Monthly sync finished", "success", 12000);
    } catch (error) {
      notify(error.message, "error", 12000);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
}

function applyPlanningColumnWidthToDom(columnKey, width) {
  document.querySelectorAll(`[data-planning-col="${columnKey}"]`).forEach((cell) => {
    cell.style.width = `${width}px`;
    cell.style.minWidth = `${width}px`;
    cell.style.maxWidth = `${width}px`;
  });
}

function wirePlanningResizers() {
  document.querySelectorAll("[data-planning-resize-col]").forEach((handle) => {
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const columnKey = handle.getAttribute("data-planning-resize-col");
      const startX = event.clientX;
      const initial = planningColumnWidth(columnKey);

      const onMove = (moveEvent) => {
        const next = Math.max(80, initial + (moveEvent.clientX - startX));
        state.planningColumnWidths[columnKey] = next;
        applyPlanningColumnWidthToDom(columnKey, next);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        savePlanningLayout();
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });

  document.querySelectorAll("[data-planning-resize-row]").forEach((handle) => {
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const rowId = handle.getAttribute("data-planning-resize-row");
      const rowEl = document.querySelector(`tr[data-planning-row="${rowId}"]`);
      if (!rowEl) return;
      const startY = event.clientY;
      const initial = planningRowHeight(rowId);

      const onMove = (moveEvent) => {
        const next = Math.max(64, initial + (moveEvent.clientY - startY));
        state.planningRowHeights[String(rowId)] = next;
        rowEl.style.height = `${next}px`;
        applyPlanningRowEditorHeights(rowId, rowEl);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        savePlanningLayout();
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });
}

async function savePlanningRowField(rowId, field, value) {
  return api(`/planning/rows/${rowId}`, {
    method: "PUT",
    body: { [field]: value },
  });
}

async function savePlanningRowsBulk(updates) {
  if (!updates.length) return [];
  const payload = await api("/planning/rows/bulk-update", {
    method: "POST",
    body: { updates },
  });
  return payload.rows || [];
}

async function ensurePlanningRowCount(minCount) {
  if (!state.planningPageId) return;
  while (state.planningRows.length < minCount) {
    const created = await api(`/pages/${state.planningPageId}/planning/rows`, {
      method: "POST",
      body: { planning_month: state.planningMonth || currentPlanningMonthKey() },
    });
    state.planningRows.push(created);
  }
}

function planningMoveFocus(rowId, columnKey, rowDelta, colDelta) {
  const rowIndex = planningRowIndexById(rowId);
  const colIndex = planningColumnIndexByKey(columnKey);
  if (rowIndex < 0 || colIndex < 0) return;
  focusPlanningCellByPosition(rowIndex + rowDelta, colIndex + colDelta);
}

function rememberPlanningTextareaSize(input) {
  if (!input || input.tagName.toLowerCase() !== "textarea") return;
  const rowId = input.getAttribute("data-row-id");
  const field = input.getAttribute("data-planning-field");
  if (!rowId || !field) return;
  const key = `${rowId}:${field}`;
  state.planningCellHeights[key] = Math.max(input.offsetHeight || 0, input.scrollHeight || 0, 42);
  savePlanningLayout();
}

async function applyPlanningPaste(startRowId, startColumnKey, clipboardText) {
  const matrix = parseClipboardMatrix(clipboardText);
  if (!matrix.length) return false;

  const startRowIndex = planningRowIndexById(startRowId);
  const startColIndex = planningColumnIndexByKey(startColumnKey);
  if (startRowIndex < 0 || startColIndex < 0) return false;

  const requiredRows = startRowIndex + matrix.length;
  await ensurePlanningRowCount(requiredRows);

  const updatesByRowId = new Map();

  for (let r = 0; r < matrix.length; r += 1) {
    const row = state.planningRows[startRowIndex + r];
    if (!row) continue;

    for (let c = 0; c < matrix[r].length; c += 1) {
      const columnKey = PLANNING_EDITABLE_COLUMNS[startColIndex + c];
      if (!columnKey) continue;
      const value = matrix[r][c];
      if (!updatesByRowId.has(row.id)) {
        updatesByRowId.set(row.id, {});
      }
      updatesByRowId.get(row.id)[columnKey] = value;
      row[columnKey] = value;
    }
  }

  const updates = Array.from(updatesByRowId.entries()).map(([id, fields]) => ({ id: Number(id), fields }));
  if (updates.length) {
    await savePlanningRowsBulk(updates);
    await loadPlanningPageData(state.planningPageId, false, state.planningMonth);
  }

  const finalRow = startRowIndex + matrix.length - 1;
  const finalCol = startColIndex + Math.max(...matrix.map((row) => row.length), 1) - 1;
  focusPlanningCellByPosition(finalRow, finalCol);
  return true;
}

function wirePlanningTab() {
  syncPlanningEditorHeightsInDom();

  document.getElementById("planning-sheet-select")?.addEventListener("change", async (event) => {
    state.planningPageId = Number(event.currentTarget.value);
    try {
      await loadPlanningPageData(state.planningPageId, true, state.planningMonth);
      renderApp();
    } catch (error) {
      notify(error.message, "error");
    }
  });

  document.getElementById("planning-month-select")?.addEventListener("change", async (event) => {
    state.planningMonth = normalizePlanningMonthValue(event.currentTarget.value) || currentPlanningMonthKey();
    try {
      await loadPlanningPageData(state.planningPageId, false, state.planningMonth);
      renderApp();
    } catch (error) {
      notify(error.message, "error");
    }
  });

  document.getElementById("planning-refresh")?.addEventListener("click", async () => {
    try {
      await loadPlanningPageData(state.planningPageId, true, state.planningMonth);
      renderApp();
      notify("Planning refreshed", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });

  document.getElementById("planning-import-csv")?.addEventListener("click", async () => {
    if (!window.confirm("Import all planner CSV files currently waiting in the import inbox?")) return;
    try {
      const result = await api("/planning/import-csvs", { method: "POST" });
      state.planningImportResult = result;
      await loadDashboardData();
      renderApp();
      notify(result.message || "Planner CSV import finished.", "success", 10000);
    } catch (error) {
      notify(error.message, "error");
    }
  });

  document.getElementById("planning-import-report-clear")?.addEventListener("click", () => {
    state.planningImportResult = null;
    renderApp();
  });

  document.getElementById("planning-add-row")?.addEventListener("click", async () => {
    if (!state.planningPageId) return;
    try {
      const created = await api(`/pages/${state.planningPageId}/planning/rows`, {
        method: "POST",
        body: { planning_month: state.planningMonth || currentPlanningMonthKey() },
      });
      insertPlanningRowLocally(created);
      renderPlanningTabInPlace();
    } catch (error) {
      notify(error.message, "error");
    }
  });

  document.getElementById("planning-add-na-row")?.addEventListener("click", async () => {
    if (!state.planningPageId) return;
    try {
      const created = await api(`/pages/${state.planningPageId}/planning/rows`, {
        method: "POST",
        body: {
          planning_month: state.planningMonth || currentPlanningMonthKey(),
          is_non_actionable: true,
        },
      });
      insertPlanningRowLocally(created);
      renderPlanningTabInPlace();
      notify("Non-actionable row added", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });

  document.querySelectorAll("[data-planning-color]").forEach((button) => {
    button.addEventListener("click", () => {
      state.planningJobColor = button.getAttribute("data-planning-color");
      document.querySelectorAll("[data-planning-color]").forEach((chip) => {
        chip.classList.toggle("active", chip === button);
      });
    });
  });

  document.querySelectorAll("[data-planning-apply-color]").forEach((button) => {
    button.addEventListener("click", async () => {
      const rowId = button.getAttribute("data-planning-apply-color");
      try {
        const updatedRow = await savePlanningRowField(rowId, "job_color", state.planningJobColor);
        const index = state.planningRows.findIndex((item) => String(item.id) === String(rowId));
        if (index >= 0) state.planningRows[index] = updatedRow;
        const cell = document.querySelector(`[data-planning-job-cell="${rowId}"]`);
        if (cell) {
          cell.style.background = updatedRow?.job_color || state.planningJobColor || "#D9D9D9";
        }
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-planning-field]").forEach((input) => {
    input.addEventListener("focus", () => {
      const rowId = input.getAttribute("data-row-id");
      const field = input.getAttribute("data-planning-field");
      state.planningActiveCell = { rowId: Number(rowId), columnKey: field };
      document.querySelectorAll(".planning-cell-active").forEach((cell) => cell.classList.remove("planning-cell-active"));
      const cell = input.closest("td");
      if (cell) cell.classList.add("planning-cell-active");
    });

    input.addEventListener("keydown", async (event) => {
      const rowId = Number(input.getAttribute("data-row-id"));
      const field = input.getAttribute("data-planning-field");
      const isTextArea = input.tagName.toLowerCase() === "textarea";
      const isSelect = input.tagName.toLowerCase() === "select";

      if (event.key === "ArrowUp" && !isSelect) {
        event.preventDefault();
        planningMoveFocus(rowId, field, -1, 0);
        return;
      }
      if (event.key === "ArrowDown" && !isSelect) {
        event.preventDefault();
        planningMoveFocus(rowId, field, 1, 0);
        return;
      }
      if (event.key === "ArrowLeft" && !isTextArea && !isSelect) {
        event.preventDefault();
        planningMoveFocus(rowId, field, 0, -1);
        return;
      }
      if (event.key === "ArrowRight" && !isTextArea && !isSelect) {
        event.preventDefault();
        planningMoveFocus(rowId, field, 0, 1);
        return;
      }
      if (event.key === "Enter" && !(isTextArea && (event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        planningMoveFocus(rowId, field, event.shiftKey ? -1 : 1, 0);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        planningMoveFocus(rowId, field, 0, event.shiftKey ? -1 : 1);
      }
    });

    input.addEventListener("paste", async (event) => {
      const pasted = event.clipboardData?.getData("text/plain") || "";
      const isTextArea = input.tagName.toLowerCase() === "textarea";
      const looksLikeGridPaste = pasted.includes("\t") || (!isTextArea && pasted.includes("\n"));
      if (!looksLikeGridPaste) return;
      event.preventDefault();

      const rowId = Number(input.getAttribute("data-row-id"));
      const field = input.getAttribute("data-planning-field");
      try {
        await applyPlanningPaste(rowId, field, pasted);
        renderApp();
      } catch (error) {
        notify(error.message, "error");
      }
    });

    input.addEventListener("change", async () => {
      const rowId = input.getAttribute("data-row-id");
      const field = input.getAttribute("data-planning-field");
      try {
        const updatedRow = await savePlanningRowField(rowId, field, input.value);
        const updatedMonth = normalizePlanningMonthValue(updatedRow?.planning_month || state.planningMonth);
        const selectedMonth = normalizePlanningMonthValue(state.planningMonth) || currentPlanningMonthKey();
        if (updatedMonth && updatedMonth !== selectedMonth) {
          state.planningRows = state.planningRows.filter((item) => String(item.id) !== String(rowId));
          renderApp();
          notify(`Row moved to ${planningMonthLabel(updatedMonth)}.`, "success");
          return;
        }
        const index = state.planningRows.findIndex((item) => String(item.id) === String(rowId));
        if (index >= 0) state.planningRows[index] = updatedRow;
      } catch (error) {
        notify(error.message, "error");
      }
    });

    if (input.tagName.toLowerCase() === "textarea") {
      input.addEventListener("mouseup", () => rememberPlanningTextareaSize(input));
      input.addEventListener("blur", () => rememberPlanningTextareaSize(input));
    }
  });

  document.querySelectorAll("[data-planning-open-creative]").forEach((button) => {
    button.addEventListener("click", async () => {
      await openPlanningCreativeEditor(button.getAttribute("data-planning-open-creative"));
    });
  });

  document.querySelectorAll("[data-planning-job-cell]").forEach((cell) => {
    cell.addEventListener("click", async (event) => {
      if (event.target.closest("input") || event.target.closest("button")) return;
      const rowId = cell.getAttribute("data-planning-job-cell");
      try {
        const updatedRow = await savePlanningRowField(rowId, "job_color", state.planningJobColor);
        const index = state.planningRows.findIndex((item) => String(item.id) === String(rowId));
        if (index >= 0) state.planningRows[index] = updatedRow;
        cell.style.background = updatedRow?.job_color || state.planningJobColor || "#D9D9D9";
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-planning-schedule]").forEach((button) => {
    button.addEventListener("click", async () => {
      const rowId = button.getAttribute("data-planning-schedule");
      try {
        await api(`/planning/rows/${rowId}/schedule`, { method: "POST" });
        await refreshAfterManualAction();
        notify("Planning row scheduled", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-planning-activate]").forEach((button) => {
    button.addEventListener("click", async () => {
      const rowId = button.getAttribute("data-planning-activate");
      try {
        await savePlanningRowField(rowId, "is_non_actionable", false);
        await refreshAfterManualAction();
        notify("Planning row activated", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-planning-disable]").forEach((button) => {
    button.addEventListener("click", async () => {
      const rowId = button.getAttribute("data-planning-disable");
      const row = state.planningRows.find((item) => String(item.id) === String(rowId));
      const warning = row?.scheduled_post_id
        ? "Disable this row and turn it into an NA row? Any linked scheduled post that has not started publishing will be removed from the queue."
        : "Disable this row and turn it into an NA row?";
      if (!window.confirm(warning)) return;
      try {
        await savePlanningRowField(rowId, "is_non_actionable", true);
        await refreshAfterManualAction();
        notify("Planning row disabled", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-planning-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const rowId = button.getAttribute("data-planning-delete");
      if (!window.confirm("Delete this planning row?")) return;
      try {
        const deletedRow = state.planningRows.find((item) => String(item.id) === String(rowId));
        await api(`/planning/rows/${rowId}`, { method: "DELETE" });
        Object.keys(state.planningCellHeights).forEach((key) => {
          if (key.startsWith(`${rowId}:`)) delete state.planningCellHeights[key];
        });
        delete state.planningRowHeights[String(rowId)];
        state.planningRows = state.planningRows.filter((item) => String(item.id) !== String(rowId));
        if (state.planningActiveCell && Number(state.planningActiveCell.rowId) === Number(rowId)) {
          state.planningActiveCell = null;
        }
        savePlanningLayout();
        const sheetMeta = state.planningSheets.find((sheet) => sheet.page_id === state.planningPageId);
        if (sheetMeta) sheetMeta.row_count = Math.max(0, Number(sheetMeta.row_count || 0) - 1);
        adjustPlanningMonthOptionCount(deletedRow?.planning_month || state.planningMonth, -1);
        renderPlanningTabInPlace();
        notify("Planning row deleted", "success");
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });

  wirePlanningResizers();
}

function wirePostEditorModal() {
  document.querySelectorAll("[data-post-editor-close]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingPostId = null;
      renderApp();
    });
  });

  document.getElementById("post-editor-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.editingPostId) return;
    const current = getPostById(state.editingPostId);
    if (!current) return;

    const form = event.currentTarget;
    const content = form.querySelector('textarea[name="content"]').value;
    const scheduledTime = form.querySelector('input[name="scheduled_time"]').value;
    const keepMedia = Array.from(form.querySelectorAll('input[name="existing_media"]:checked')).map(
      (input) => input.value
    );
    const filesInput = form.querySelector('input[name="media"]');

    const payload = new FormData();
    payload.set("content", content || "");
    payload.set("scheduled_time", localInputToIso(scheduledTime) || "");
    payload.set("existing_media", JSON.stringify(keepMedia));
    if (filesInput?.files?.length) {
      for (const file of filesInput.files) payload.append("media", file);
    }

    try {
      await api(`/posts/${current.id}`, { method: "PUT", body: payload });
      state.editingPostId = null;
      await loadDashboardData();
      renderApp();
      notify("Post updated", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });
}

function wireAccountEditorModal() {
  document.querySelectorAll("[data-account-editor-close]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingAccountId = null;
      renderApp();
    });
  });

  document.getElementById("account-editor-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.editingAccountId) return;

    const form = event.currentTarget;
    const platform = form.querySelector('select[name="platform"]').value;
    const payload = {
      platform,
      account_name: form.querySelector('input[name="account_name"]').value,
      is_active: form.querySelector('input[name="is_active"]').checked,
    };
    const externalIdInput = form.querySelector('input[name="page_id_external"]');
    if (externalIdInput) {
      payload.page_id_external = externalIdInput.value;
    } else if (platform === "linkedin") {
      payload.page_id_external = "";
    }

    const credentialFields = [
      "access_token",
      "refresh_token",
      "api_key",
      "api_secret",
      "access_token_secret",
    ];
    for (const field of credentialFields) {
      const input = form.querySelector(`input[name="${field}"]`);
      if (!input) continue;
      const value = input.value.trim();
      if (value) payload[field] = value;
    }

    const expiresField = form.querySelector('input[name="token_expires_at"]');
    const expiresInput = expiresField?.value || "";
    if (expiresInput) payload.token_expires_at = localInputToIso(expiresInput);

    try {
      await api(`/accounts/${state.editingAccountId}`, { method: "PUT", body: payload });
      state.editingAccountId = null;
      await loadDashboardData();
      renderApp();
      notify("Account updated", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });
}

function wirePlanningCreativeModal() {
  const editor = state.planningCreativeEditor;
  if (!editor) return;

  document.querySelectorAll("[data-close-planning-creative]").forEach((button) => {
    button.addEventListener("click", () => {
      closePlanningCreativeEditor();
      renderApp();
    });
  });

  document.querySelectorAll("[data-planning-crop-open]").forEach((button) => {
    button.addEventListener("click", () => {
      openPlanningCreativeCropper(button.getAttribute("data-planning-crop-open"));
      renderApp();
    });
  });

  document.querySelectorAll("[data-planning-crop-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closePlanningCreativeCropper();
      renderApp();
    });
  });

  document.querySelectorAll("[data-planning-crop-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.planningCreativeCropper) return;
      state.planningCreativeCropper = {
        ...state.planningCreativeCropper,
        presetId: button.getAttribute("data-planning-crop-preset"),
      };
      renderApp();
    });
  });

  document.getElementById("planning-crop-zoom")?.addEventListener("input", (event) => {
    if (!state.planningCreativeCropper) return;
    state.planningCreativeCropper = {
      ...state.planningCreativeCropper,
      zoom: Number(event.currentTarget.value || 1),
    };
    renderPlanningCropperPreview();
  });

  document.getElementById("planning-crop-position-x")?.addEventListener("input", (event) => {
    if (!state.planningCreativeCropper) return;
    state.planningCreativeCropper = {
      ...state.planningCreativeCropper,
      positionX: Number(event.currentTarget.value || 50),
    };
    renderPlanningCropperPreview();
  });

  document.getElementById("planning-crop-position-y")?.addEventListener("input", (event) => {
    if (!state.planningCreativeCropper) return;
    state.planningCreativeCropper = {
      ...state.planningCreativeCropper,
      positionY: Number(event.currentTarget.value || 50),
    };
    renderPlanningCropperPreview();
  });

  document.getElementById("planning-crop-apply")?.addEventListener("click", async () => {
    try {
      await applyPlanningCreativeCrop();
      await refreshPlanningCreativeDiagnostics();
      notify("Image cropped for Instagram", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });

  document.querySelectorAll("[data-planning-creative-move]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.planningCreativeEditor) return;
      const [indexRaw, deltaRaw] = button.getAttribute("data-planning-creative-move").split(":");
      movePlanningCreativeItem(Number(indexRaw), Number(deltaRaw));
      renderApp();
    });
  });

  document.querySelectorAll("[data-planning-creative-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.planningCreativeEditor) return;
      const index = Number(button.getAttribute("data-planning-creative-remove"));
      const items = [...state.planningCreativeEditor.items];
      const [removed] = items.splice(index, 1);
      revokePlanningCreativeItem(removed);
      if (state.planningCreativeCropper?.itemId === removed?.id) {
        closePlanningCreativeCropper();
      }
      state.planningCreativeEditor = {
        ...state.planningCreativeEditor,
        items,
      };
      renderApp();
    });
  });

  document.getElementById("planning-creative-files")?.addEventListener("change", async (event) => {
    if (!state.planningCreativeEditor) return;
    const nextFiles = Array.from(event.currentTarget.files || []);
    const nextItems = nextFiles.map((file) => createPlanningPendingCreativeItem(file));
    const candidateEditor = {
      ...state.planningCreativeEditor,
      items: [...state.planningCreativeEditor.items, ...nextItems],
    };
    const guardViolations = planningCreativeMediaGuardViolations(candidateEditor);
    if (guardViolations.length) {
      nextItems.forEach((item) => revokePlanningCreativeItem(item));
      notify(guardViolations[0], "error", 9000);
      event.currentTarget.value = "";
      return;
    }

    state.planningCreativeEditor = {
      ...state.planningCreativeEditor,
      items: candidateEditor.items,
    };
    renderApp();
    const firstImageId = nextItems.find((item) => item.media_kind !== "video")?.id || null;
    await refreshPlanningCreativeDiagnostics({ openCropperForItemId: firstImageId });
    const violations = planningCreativeViolations();
    if (violations.length) {
      notify(violations[0], "error", 9000);
    }
    event.currentTarget.value = "";
  });

  document.getElementById("planning-creative-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.planningCreativeEditor) return;

    const violations = planningCreativeViolations();
    if (violations.length) {
      notify(violations[0], "error", 9000);
      return;
    }

    const payload = new FormData();
    const items = state.planningCreativeEditor.items;
    const mediaOrder = items.map((item) =>
      item.kind === "existing" ? `existing::${item.path}` : `pending::${item.id}`
    );
    const pendingItems = items.filter((item) => item.kind === "pending");

    payload.set("media_order", JSON.stringify(mediaOrder));
    payload.set(
      "pending_order",
      JSON.stringify(pendingItems.map((item) => `pending::${item.id}`))
    );
    for (const item of pendingItems) {
      payload.append("creative", item.file, item.name);
    }

    try {
      const row = await api(`/planning/rows/${state.planningCreativeEditor.rowId}/creative`, {
        method: "POST",
        body: payload,
      });
      const index = state.planningRows.findIndex((item) => Number(item.id) === Number(row.id));
      if (index >= 0) state.planningRows[index] = row;
      closePlanningCreativeEditor();
      renderApp();
      notify("Planner creatives updated", "success");
    } catch (error) {
      notify(error.message, "error");
    }
  });
}

async function loadPostsData() {
  state.posts = await api("/posts");
}

async function loadPlanningSheets() {
  const sheets = await api("/planning/sheets");
  state.planningSheets = sheets;
  if (!state.planningMonth) {
    state.planningMonth = currentPlanningMonthKey();
  }

  const validPageIds = new Set(sheets.map((sheet) => sheet.page_id));
  if (state.planningPageId === null || !validPageIds.has(state.planningPageId)) {
    state.planningPageId = sheets[0]?.page_id ?? null;
    loadPlanningLayout(state.planningPageId);
  }
}

async function loadPlanningPageData(pageId = null, refreshSheets = false, monthKey = null) {
  if (refreshSheets || !state.planningSheets.length) {
    await loadPlanningSheets();
  }

  const targetPageId = Number(pageId || state.planningPageId || state.planningSheets[0]?.page_id || 0);
  const targetMonth = normalizePlanningMonthValue(monthKey || state.planningMonth || currentPlanningMonthKey()) || currentPlanningMonthKey();
  if (!targetPageId) {
    state.planningRows = [];
    state.planningMonth = targetMonth;
    state.planningMonthOptions = [];
    state.designerOptions = [];
    return;
  }

  if (state.planningPageId !== targetPageId) {
    state.planningPageId = targetPageId;
    loadPlanningLayout(state.planningPageId);
  }

  const payload = await api(`/pages/${targetPageId}/planning?month=${encodeURIComponent(targetMonth)}`);
  state.planningMonth = normalizePlanningMonthValue(payload.selected_month || targetMonth) || targetMonth;
  state.planningMonthOptions = payload.month_options || [];
  state.planningRows = payload.rows || [];
  state.designerOptions = payload.designer_options || [];
  if (state.planningCreativeEditor && !state.planningRows.some((row) => Number(row.id) === Number(state.planningCreativeEditor.rowId))) {
    closePlanningCreativeEditor();
  }
}

async function loadUsersData() {
  if (!canManageUsers()) {
    state.users = [];
    resetUserEditor();
    return;
  }

  state.users = await api("/users");
  if (state.userEditor?.mode === "edit") {
    const match = state.users.find((user) => String(user.username || "") === String(state.userEditor.username || ""));
    if (match) {
      setUserEditor(match);
    } else {
      resetUserEditor();
    }
  }
}

async function loadDashboardData() {
  const [pages, schedulerStatus] = await Promise.all([api("/pages"), api("/scheduler/status")]);
  state.pages = pages;
  state.schedulerStatus = schedulerStatus;
  ensureFilterState();

  await Promise.all([loadPostsData(), loadPlanningPageData(state.planningPageId, true)]);
  syncLinkedInManualPopup();
  if (canAccessSettings()) {
    await Promise.all([loadSettingsScopeData(), loadUsersData()]);
  } else {
    state.settings = {};
    state.tokenStatus = [];
    state.settingsMeta = { scopeType: "global", pageName: null, overrides: {} };
    state.users = [];
    resetUserEditor();
  }
  if (canAccessIntegrations()) {
    await loadIntegrationsScopeData();
  } else {
    state.integrationCheck = null;
  }
}

async function loadSettingsScopeData() {
  if (state.settingsScopePageId === null) {
    const [settings, tokenStatus] = await Promise.all([api("/settings"), api("/tokens/status")]);
    state.settings = settings;
    state.tokenStatus = tokenStatus;
    state.settingsMeta = { scopeType: "global", pageName: null, overrides: {} };
    maybeNotifyMetaTokenReminder();
    return;
  }

  const [settingsPayload, tokenStatus] = await Promise.all([
    api(`/pages/${state.settingsScopePageId}/settings`),
    api(`/tokens/status?page_id=${state.settingsScopePageId}`),
  ]);
  state.settings = {
    ...(settingsPayload.effective || {}),
    meta_global: settingsPayload.meta_global || {},
    linkedin_global: settingsPayload.linkedin_global || {},
    facebook_app_id: settingsPayload.global_defaults?.facebook_app_id || "",
    facebook_app_secret: settingsPayload.global_defaults?.facebook_app_secret || "",
    global_meta_user_token: settingsPayload.global_defaults?.global_meta_user_token || "",
    global_linkedin_access_token: settingsPayload.global_defaults?.global_linkedin_access_token || "",
    global_linkedin_refresh_token: settingsPayload.global_defaults?.global_linkedin_refresh_token || "",
    global_linkedin_token_expires_at: settingsPayload.global_defaults?.global_linkedin_token_expires_at || "",
    global_linkedin_refresh_token_expires_at: settingsPayload.global_defaults?.global_linkedin_refresh_token_expires_at || "",
    designer_email_map: settingsPayload.global_defaults?.designer_email_map || "",
  };
  state.tokenStatus = tokenStatus;
  state.settingsMeta = {
    scopeType: "page",
    pageName: settingsPayload.scope?.page_name || null,
    overrides: settingsPayload.overrides || {},
  };
  maybeNotifyMetaTokenReminder();
}

async function loadIntegrationsScopeData() {
  const path =
    state.integrationsScopePageId === null
      ? "/integrations/check"
      : `/pages/${state.integrationsScopePageId}/integrations/check`;
  state.integrationCheck = await api(path);
}

async function boot() {
  restoreSession();
  if (!state.accessToken || !state.refreshToken || !state.user) {
    renderLogin();
    return;
  }

  setLoading("Verifying session...");
  try {
    await api("/auth/verify");
    await loadDashboardData();
    renderApp();
  } catch {
    clearSession();
    renderLogin();
  }
}

boot();

