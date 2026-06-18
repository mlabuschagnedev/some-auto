import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
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
  publishPlanningRow,
  readStoredSession,
  refreshAnalytics,
  restoreStoredSession,
  reschedulePostRecord,
  retryPostRecord,
  schedulePlanningRow,
  syncAnalyticsReportSheet,
  testSocialAccount,
  updateGlobalSettings,
  updateLinkedInManualPost,
  updatePlanningRow,
  uploadPlanningCreativeMedia,
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
  AnalyticsRefreshStatus,
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
type ThemeMode = "light" | "dark" | "dark-gold";
type ThemePreference = "system" | ThemeMode;
type AnalyticsRange = "7d" | "30d" | "60d" | "month" | "all" | "custom";
type InsightDisplayMode = "chart" | "bar" | "table" | "summary" | "export";
type AnalyticsPostSort =
  | "date-desc"
  | "date-asc"
  | "views-desc"
  | "views-asc"
  | "reach-desc"
  | "reach-asc"
  | "engagement-desc"
  | "engagement-asc"
  | "comments-desc"
  | "comments-asc"
  | "shares-desc"
  | "shares-asc";
type AnalyticsAccountSort =
  | "views-desc"
  | "views-asc"
  | "engagement-desc"
  | "engagement-asc"
  | "followers-desc"
  | "followers-asc"
  | "name-asc"
  | "name-desc";
type DiagnosticSort = "checked-desc" | "checked-asc" | "account-asc" | "metric-asc" | "state-asc";
type ProjectSort =
  | "name-asc"
  | "name-desc"
  | "queued-desc"
  | "queued-asc"
  | "posted-desc"
  | "posted-asc"
  | "failed-desc"
  | "failed-asc"
  | "accounts-desc"
  | "accounts-asc";
type ProjectAccountSort = "page-asc" | "page-desc" | "account-asc" | "account-desc" | "platform-asc" | "platform-desc" | "active-first" | "inactive-first";
type PlannerEventSort = "date-asc" | "date-desc" | "page-asc" | "page-desc" | "status-asc" | "status-desc";
type DraftSort = "order-asc" | "order-desc" | "updated-desc" | "updated-asc" | "title-asc" | "title-desc" | "status-asc" | "status-desc";
type ActivitySort = "date-desc" | "date-asc" | "title-asc" | "title-desc" | "source-asc" | "source-desc";
type NotificationSort = "priority-desc" | "priority-asc" | "source-asc" | "title-asc";

interface SortOption<T extends string> {
  value: T;
  label: string;
}

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
  post: PostRecord | null;
  pageId: number | null;
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
const INSTAGRAM_FEED_RATIO_MIN = 4 / 5;
const INSTAGRAM_FEED_RATIO_MAX = 1.91;
const INSTAGRAM_RATIO_EPSILON = 0.01;
const COMPOSER_PREVIEW_MAX_EDGE = 960;
const COMPOSER_CROP_MAX_EDGE = 1440;

interface ComposerMediaItem {
  id: string;
  file: File;
  previewUrl: string | null;
  kind: "image" | "video";
  width: number | null;
  height: number | null;
  ratio: number | null;
  cropNeeded: boolean;
  processing: boolean;
  error: string | null;
}

interface CropConfig {
  targetRatio: number;
  offsetX: number;
  offsetY: number;
  zoom: number;
}

const ANALYTICS_POST_SORT_OPTIONS: SortOption<AnalyticsPostSort>[] = [
  { value: "date-desc", label: "Newest first" },
  { value: "date-asc", label: "Oldest first" },
  { value: "views-desc", label: "Most views" },
  { value: "views-asc", label: "Least views" },
  { value: "reach-desc", label: "Most reach" },
  { value: "reach-asc", label: "Least reach" },
  { value: "engagement-desc", label: "Most interactions" },
  { value: "engagement-asc", label: "Least interactions" },
  { value: "comments-desc", label: "Most comments" },
  { value: "comments-asc", label: "Least comments" },
  { value: "shares-desc", label: "Most shares" },
  { value: "shares-asc", label: "Least shares" },
];

const ANALYTICS_ACCOUNT_SORT_OPTIONS: SortOption<AnalyticsAccountSort>[] = [
  { value: "views-desc", label: "Most views" },
  { value: "views-asc", label: "Least views" },
  { value: "engagement-desc", label: "Most interactions" },
  { value: "engagement-asc", label: "Least interactions" },
  { value: "followers-desc", label: "Most followers" },
  { value: "followers-asc", label: "Least followers" },
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
];

const DIAGNOSTIC_SORT_OPTIONS: SortOption<DiagnosticSort>[] = [
  { value: "checked-desc", label: "Newest checked" },
  { value: "checked-asc", label: "Oldest checked" },
  { value: "account-asc", label: "Account A-Z" },
  { value: "metric-asc", label: "Metric A-Z" },
  { value: "state-asc", label: "State" },
];

const PROJECT_SORT_OPTIONS: SortOption<ProjectSort>[] = [
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
  { value: "queued-desc", label: "Most queued" },
  { value: "queued-asc", label: "Least queued" },
  { value: "posted-desc", label: "Most posted" },
  { value: "posted-asc", label: "Least posted" },
  { value: "failed-desc", label: "Most failed" },
  { value: "failed-asc", label: "Least failed" },
  { value: "accounts-desc", label: "Most accounts" },
  { value: "accounts-asc", label: "Least accounts" },
];

const PROJECT_ACCOUNT_SORT_OPTIONS: SortOption<ProjectAccountSort>[] = [
  { value: "page-asc", label: "Page A-Z" },
  { value: "page-desc", label: "Page Z-A" },
  { value: "account-asc", label: "Account A-Z" },
  { value: "account-desc", label: "Account Z-A" },
  { value: "platform-asc", label: "Platform A-Z" },
  { value: "platform-desc", label: "Platform Z-A" },
  { value: "active-first", label: "Active first" },
  { value: "inactive-first", label: "Inactive first" },
];

const PLANNER_EVENT_SORT_OPTIONS: SortOption<PlannerEventSort>[] = [
  { value: "date-asc", label: "Earliest first" },
  { value: "date-desc", label: "Latest first" },
  { value: "page-asc", label: "Client A-Z" },
  { value: "page-desc", label: "Client Z-A" },
  { value: "status-asc", label: "Status A-Z" },
  { value: "status-desc", label: "Status Z-A" },
];

const DRAFT_SORT_OPTIONS: SortOption<DraftSort>[] = [
  { value: "order-asc", label: "Draft order" },
  { value: "order-desc", label: "Reverse order" },
  { value: "updated-desc", label: "Newest updated" },
  { value: "updated-asc", label: "Oldest updated" },
  { value: "title-asc", label: "Title A-Z" },
  { value: "title-desc", label: "Title Z-A" },
  { value: "status-asc", label: "Status A-Z" },
  { value: "status-desc", label: "Status Z-A" },
];

const ACTIVITY_SORT_OPTIONS: SortOption<ActivitySort>[] = [
  { value: "date-desc", label: "Newest first" },
  { value: "date-asc", label: "Oldest first" },
  { value: "title-asc", label: "Title A-Z" },
  { value: "title-desc", label: "Title Z-A" },
  { value: "source-asc", label: "Source A-Z" },
  { value: "source-desc", label: "Source Z-A" },
];

const NOTIFICATION_SORT_OPTIONS: SortOption<NotificationSort>[] = [
  { value: "priority-desc", label: "Highest priority" },
  { value: "priority-asc", label: "Lowest priority" },
  { value: "source-asc", label: "Source A-Z" },
  { value: "title-asc", label: "Title A-Z" },
];

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
  if (saved === "system" || saved === "light" || saved === "dark" || saved === "dark-gold") {
    return saved;
  }
  return "system";
}

function nextThemePreference(theme: ThemeMode): ThemeMode {
  if (theme === "light") {
    return "dark";
  }
  if (theme === "dark") {
    return "dark-gold";
  }
  return "light";
}

function themeToggleLabel(theme: ThemeMode): string {
  if (theme === "light") {
    return "Switch to dark mode";
  }
  if (theme === "dark") {
    return "Switch to dark gold mode";
  }
  return "Switch to light mode";
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

function dateSortValue(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function numberSortValue(value: number | null | undefined): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function compareNumbers(
  left: number | null | undefined,
  right: number | null | undefined,
  descending = false,
): number {
  const result = numberSortValue(left) - numberSortValue(right);
  return descending ? -result : result;
}

function compareDates(
  left: string | null | undefined,
  right: string | null | undefined,
  descending = false,
): number {
  const result = dateSortValue(left) - dateSortValue(right);
  return descending ? -result : result;
}

function compareText(left: string | null | undefined, right: string | null | undefined, descending = false): number {
  const result = String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "base", numeric: true });
  return descending ? -result : result;
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
  void readyColor;
  if (row.is_non_actionable) {
    return { label: "Disabled", tone: "neutral" };
  }
  if (row.scheduled_post_id) {
    return { label: "Scheduled", tone: "good" };
  }
  if (!row.theme.trim() || !row.post_copy.trim()) {
    return { label: "Needs copy", tone: "warn" };
  }
  if (!row.creative_media_count) {
    return { label: "Needs media", tone: "warn" };
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

function isPublishingQueueEvent(event: PlannerEvent, todayKey = toDateKey(new Date())): boolean {
  return event.source === "post"
    && event.dateKey >= todayKey
    && ["draft", "scheduled", "posting", "manual_pending"].includes(event.status);
}

function isUpcomingPlannerEvent(event: PlannerEvent, todayKey = toDateKey(new Date())): boolean {
  return event.dateKey >= todayKey && event.status !== "posted" && event.status !== "failed";
}

function pageImageUrl(page: PageRecord | null | undefined): string | null {
  if (!page?.image_path) {
    return null;
  }
  if (page.image_path.startsWith("http") || page.image_path.startsWith("/")) {
    return normalizeMediaSrc(page.image_path);
  }
  return localUploadUrl(page.image_path);
}

function firstPostMedia(post: PostRecord): string | null {
  const path = post.media_paths[0];
  if (!path) {
    return null;
  }
  if (path.startsWith("http") || path.startsWith("/")) {
    return normalizeMediaSrc(path);
  }
  return localUploadUrl(path);
}

function firstPlanningRowMedia(row: PlanningRowRecord): string | null {
  const candidate = [
    ...(row.creative_media_urls || []),
    row.creative_media_url,
    ...(row.creative_media_paths || []),
    row.creative_media_path,
  ].find((value) => typeof value === "string" && value.trim());
  if (!candidate) {
    return null;
  }
  return normalizeMediaSrc(candidate);
}

function localUploadUrl(path: string): string {
  const cleaned = path.replace(/\\/g, "/").replace(/^\/?uploads\//, "").replace(/^\/+/, "");
  return `/uploads/${cleaned.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeMediaSrc(src: string): string {
  if (!src) {
    return src;
  }
  if (src.startsWith("/uploads/")) {
    return localUploadUrl(src);
  }
  if (!src.startsWith("http") && !src.startsWith("/") && /^(images|videos)\//i.test(src)) {
    return localUploadUrl(src);
  }
  return src;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function imageRatioAccepted(width: number | null, height: number | null): boolean {
  if (!width || !height) {
    return true;
  }
  const ratio = width / height;
  return ratio >= INSTAGRAM_FEED_RATIO_MIN - INSTAGRAM_RATIO_EPSILON
    && ratio <= INSTAGRAM_FEED_RATIO_MAX + INSTAGRAM_RATIO_EPSILON;
}

function recommendedCropRatio(width: number | null, height: number | null): number {
  if (!width || !height) {
    return 1;
  }
  const ratio = width / height;
  if (ratio < INSTAGRAM_FEED_RATIO_MIN) {
    return INSTAGRAM_FEED_RATIO_MIN;
  }
  if (ratio > INSTAGRAM_FEED_RATIO_MAX) {
    return INSTAGRAM_FEED_RATIO_MAX;
  }
  return Math.min(Math.max(ratio, INSTAGRAM_FEED_RATIO_MIN), INSTAGRAM_FEED_RATIO_MAX);
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not create image file from crop."));
      }
    }, type, quality);
  });
}

async function previewUrlFromBitmap(bitmap: ImageBitmap): Promise<string> {
  const scale = Math.min(1, COMPOSER_PREVIEW_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available for image previews.");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.84);
  return URL.createObjectURL(blob);
}

async function prepareComposerMediaItem(file: File, id: string): Promise<ComposerMediaItem> {
  if (!file.type.startsWith("image/")) {
    return {
      id,
      file,
      previewUrl: URL.createObjectURL(file),
      kind: "video",
      width: null,
      height: null,
      ratio: null,
      cropNeeded: false,
      processing: false,
      error: null,
    };
  }

  const bitmap = await createImageBitmap(file);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    return {
      id,
      file,
      previewUrl: await previewUrlFromBitmap(bitmap),
      kind: "image",
      width,
      height,
      ratio: width / height,
      cropNeeded: !imageRatioAccepted(width, height),
      processing: false,
      error: null,
    };
  } finally {
    bitmap.close();
  }
}

function croppedFileName(name: string): string {
  const cleaned = name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-");
  return `${cleaned || "image"}-cropped.jpg`;
}

async function cropComposerMediaItem(item: ComposerMediaItem, config: CropConfig): Promise<ComposerMediaItem> {
  if (item.kind !== "image") {
    return item;
  }
  const bitmap = await createImageBitmap(item.file);
  try {
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const boundedRatio = Math.min(Math.max(config.targetRatio, INSTAGRAM_FEED_RATIO_MIN), INSTAGRAM_FEED_RATIO_MAX);
    const sourceRatio = sourceWidth / sourceHeight;
    let baseWidth = sourceWidth;
    let baseHeight = sourceHeight;
    if (sourceRatio > boundedRatio) {
      baseWidth = sourceHeight * boundedRatio;
    } else {
      baseHeight = sourceWidth / boundedRatio;
    }

    const zoom = Math.min(Math.max(config.zoom, 1), 3);
    const cropWidth = Math.max(1, baseWidth / zoom);
    const cropHeight = Math.max(1, baseHeight / zoom);
    const cropX = Math.max(0, (sourceWidth - cropWidth) * (config.offsetX / 100));
    const cropY = Math.max(0, (sourceHeight - cropHeight) * (config.offsetY / 100));
    const outputWidth = Math.min(COMPOSER_CROP_MAX_EDGE, Math.round(cropWidth));
    const outputHeight = Math.max(1, Math.round(outputWidth / boundedRatio));

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas is not available for cropping.");
    }
    context.drawImage(bitmap, cropX, cropY, cropWidth, cropHeight, 0, 0, outputWidth, outputHeight);
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
    const file = new File([blob], croppedFileName(item.file.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    const nextBitmap = await createImageBitmap(file);
    try {
      const previousPreview = item.previewUrl;
      const previewUrl = await previewUrlFromBitmap(nextBitmap);
      if (previousPreview) {
        URL.revokeObjectURL(previousPreview);
      }
      return {
        ...item,
        file,
        previewUrl,
        width: nextBitmap.width,
        height: nextBitmap.height,
        ratio: nextBitmap.width / nextBitmap.height,
        cropNeeded: false,
        processing: false,
        error: null,
      };
    } finally {
      nextBitmap.close();
    }
  } finally {
    bitmap.close();
  }
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

function plannerEventDateTime(event: PlannerEvent): number {
  const time = /^\d{1,2}:\d{2}/.test(event.time) ? event.time : "00:00";
  return dateSortValue(`${event.dateKey}T${time}`);
}

function sortPlannerEvents(events: PlannerEvent[], sort: PlannerEventSort): PlannerEvent[] {
  return events.slice().sort((left, right) => {
    if (sort === "date-desc" || sort === "date-asc") {
      const result = plannerEventDateTime(left) - plannerEventDateTime(right);
      return sort === "date-desc" ? -result : result;
    }
    if (sort === "page-desc" || sort === "page-asc") {
      return compareText(left.pageName, right.pageName, sort === "page-desc")
        || compareText(left.title, right.title);
    }
    return compareText(left.status, right.status, sort === "status-desc")
      || compareText(left.title, right.title);
  });
}

function sortDraftRows(rows: PlanningRowRecord[], sort: DraftSort, readyColor: string): PlanningRowRecord[] {
  return rows.slice().sort((left, right) => {
    if (sort === "order-desc" || sort === "order-asc") {
      return compareNumbers(left.row_order, right.row_order, sort === "order-desc");
    }
    if (sort === "updated-desc" || sort === "updated-asc") {
      return compareDates(left.updated_at, right.updated_at, sort === "updated-desc")
        || compareNumbers(left.row_order, right.row_order);
    }
    if (sort === "title-desc" || sort === "title-asc") {
      return compareText(left.theme || left.job_nr, right.theme || right.job_nr, sort === "title-desc");
    }
    return compareText(
      rowStatus(left, readyColor).label,
      rowStatus(right, readyColor).label,
      sort === "status-desc",
    ) || compareNumbers(left.row_order, right.row_order);
  });
}

function sortPages(pages: PageRecord[], sort: ProjectSort): PageRecord[] {
  return pages.slice().sort((left, right) => {
    if (sort === "name-desc" || sort === "name-asc") {
      return compareText(left.name, right.name, sort === "name-desc");
    }
    if (sort === "queued-desc" || sort === "queued-asc") {
      return compareNumbers(left.stats.scheduled_posts, right.stats.scheduled_posts, sort === "queued-desc")
        || compareText(left.name, right.name);
    }
    if (sort === "posted-desc" || sort === "posted-asc") {
      return compareNumbers(left.stats.successful_posts, right.stats.successful_posts, sort === "posted-desc")
        || compareText(left.name, right.name);
    }
    if (sort === "failed-desc" || sort === "failed-asc") {
      return compareNumbers(left.stats.failed_posts, right.stats.failed_posts, sort === "failed-desc")
        || compareText(left.name, right.name);
    }
    return compareNumbers(left.social_accounts.length, right.social_accounts.length, sort === "accounts-desc")
      || compareText(left.name, right.name);
  });
}

function sortProjectAccounts(
  rows: Array<{ page: PageRecord; account: SocialAccount }>,
  sort: ProjectAccountSort,
): Array<{ page: PageRecord; account: SocialAccount }> {
  return rows.slice().sort((left, right) => {
    if (sort === "page-desc" || sort === "page-asc") {
      return compareText(left.page.name, right.page.name, sort === "page-desc");
    }
    if (sort === "account-desc" || sort === "account-asc") {
      return compareText(left.account.account_name || left.account.platform, right.account.account_name || right.account.platform, sort === "account-desc");
    }
    if (sort === "platform-desc" || sort === "platform-asc") {
      return compareText(left.account.platform, right.account.platform, sort === "platform-desc")
        || compareText(left.page.name, right.page.name);
    }
    return compareNumbers(
      left.account.is_active ? 1 : 0,
      right.account.is_active ? 1 : 0,
      sort === "active-first",
    ) || compareText(left.page.name, right.page.name);
  });
}

function sortActivityEntries<T extends { title: string; actor: string; sortAt: number }>(items: T[], sort: ActivitySort): T[] {
  return items.slice().sort((left, right) => {
    if (sort === "date-desc" || sort === "date-asc") {
      return compareNumbers(left.sortAt, right.sortAt, sort === "date-desc");
    }
    if (sort === "title-desc" || sort === "title-asc") {
      return compareText(left.title, right.title, sort === "title-desc");
    }
    return compareText(left.actor, right.actor, sort === "source-desc")
      || compareNumbers(left.sortAt, right.sortAt, true);
  });
}

function notificationPriorityRank(priority: NotificationItem["priority"]): number {
  if (priority === "High") {
    return 3;
  }
  if (priority === "Medium") {
    return 2;
  }
  return 1;
}

function sortNotifications(items: NotificationItem[], sort: NotificationSort): NotificationItem[] {
  return items.slice().sort((left, right) => {
    if (sort === "priority-desc" || sort === "priority-asc") {
      return compareNumbers(
        notificationPriorityRank(left.priority),
        notificationPriorityRank(right.priority),
        sort === "priority-desc",
      ) || compareText(left.title, right.title);
    }
    if (sort === "source-asc") {
      return compareText(left.source, right.source) || compareText(left.title, right.title);
    }
    return compareText(left.title, right.title);
  });
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
          title: row.theme || row.job_nr || "Untitled post",
          subtitle: row.post_copy || row.format || "Draft post",
          pageName: planning.page.name,
          platforms: row.linked_accounts.split(/\s+/).filter(Boolean),
          status: status.label,
          tone: status.tone,
          mediaUrl: firstPlanningRowMedia(row),
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
      title: `${contentRows.length} draft${contentRows.length === 1 ? "" : "s"} need content`,
      detail: "Missing content, date, or readiness.",
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
  const [manualPost, setManualPost] = useState<PostRecord | null>(null);
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

  async function refreshWorkspace(
    currentSession = session,
    options: { silent?: boolean } = {},
  ): Promise<void> {
    if (!currentSession) {
      return;
    }
    if (!options.silent) {
      setWorkspaceLoading(true);
      setWorkspaceError(null);
    }
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
      const message = error instanceof Error ? error.message : "Unable to load workspace data.";
      if (options.silent) {
        notify(message, "error");
      } else {
        setWorkspaceError(message);
      }
    } finally {
      if (!options.silent) {
        setWorkspaceLoading(false);
      }
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

  async function refreshAnalyticsAccounts(sessionOverride?: SessionPayload): Promise<void> {
    const currentSession = sessionOverride || session;
    if (!currentSession) {
      setAnalyticsAccounts([]);
      setAnalyticsPosts([]);
      return;
    }
    setAnalyticsLoading(true);
    try {
      const [accounts, posts] = await Promise.all([
        loadAnalyticsAccounts(currentSession, applySession),
        loadAnalyticsPosts(currentSession, applySession, 2000, 3650),
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
    if (!session) {
      return;
    }
    let lastRefreshAt = 0;
    const refreshActiveData = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      const now = Date.now();
      if (now - lastRefreshAt < 15000) {
        return;
      }
      lastRefreshAt = now;
      void refreshWorkspace(session, { silent: true });
      if (selectedPageId) {
        void refreshPlanning();
      }
      if (activeSection === "analytics") {
        void refreshAnalyticsAccounts(session);
      }
    };
    window.addEventListener("focus", refreshActiveData);
    document.addEventListener("visibilitychange", refreshActiveData);
    return () => {
      window.removeEventListener("focus", refreshActiveData);
      document.removeEventListener("visibilitychange", refreshActiveData);
    };
  }, [activeSection, selectedPageId, selectedMonth, session?.accessToken]);

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
    if (!session) {
      return;
    }
    if (section === "analytics") {
      void refreshAnalyticsAccounts(session);
      return;
    }
    void refreshWorkspace(session, { silent: true });
    if (section === "planner") {
      void refreshPlanning();
    }
    if (section === "settings") {
      void refreshSettings();
    }
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
              icon={theme === "light" ? "moon" : "sun"}
              label={themeToggleLabel(theme)}
              onClick={() => setThemePreference(nextThemePreference(theme))}
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
              canManagePlanning={session.user.role !== "designer"}
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
                    is_non_actionable: row.is_non_actionable,
                  });
                  notify("Post draft duplicated.");
                  await refreshWorkspace();
                  await refreshPlanning();
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Unable to duplicate draft.", "error");
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
              onManualOpen={(post) => setManualPost(post)}
              onPublishRow={async (row) => {
                try {
                  const result = await publishPlanningRow(session, applySession, row.id);
                  notify(result.message || "Publishing finished.");
                  if (result.post?.linkedin_manual.required && !result.post.linkedin_manual.done) {
                    setManualPost(result.post);
                  }
                  await refreshWorkspace();
                  await refreshPlanning();
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Unable to publish post.", "error");
                }
              }}
              onSchedule={async (row) => {
                try {
                  const result = await schedulePlanningRow(session, applySession, row.id);
                  notify(result.message || "Post scheduled.");
                  if (result.post?.linkedin_manual.required && !result.post.linkedin_manual.done) {
                    setManualPost(result.post);
                  }
                  await refreshWorkspace();
                  await refreshPlanning();
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Unable to schedule post.", "error");
                }
              }}
              onManualComplete={async (post) => {
                try {
                  const updated = await updateLinkedInManualPost(session, applySession, post.id, { done: true });
                  notify("Manual LinkedIn item marked complete.");
                  setManualPost(updated.linkedin_manual.required && !updated.linkedin_manual.done ? updated : null);
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
              onExportReport={async () => {
                if (!session) {
                  throw new Error("Sign in again before exporting the report.");
                }
                const activeSession = readStoredSession() || session;
                const result = await syncAnalyticsReportSheet(activeSession, applySession);
                const cellCount = Number(result.updated_cells || result.prepared_cells || 0);
                notify(cellCount ? `Google marketing report updated (${cellCount} cells).` : "Google marketing report updated.");
              }}
              onRefreshInsights={async (
                accountId?: number,
                onProgress?: (status: AnalyticsRefreshStatus) => void,
                options?: { range: AnalyticsRange; customStart?: string; customEnd?: string },
              ) => {
                try {
                  if (!session) {
                    throw new Error("Sign in again before refreshing analytics.");
                  }
                  const activeSession = readStoredSession() || session;
                  const result = await refreshAnalytics(activeSession, applySession, accountId, onProgress, options);
                  const latestSession = readStoredSession() || activeSession;
                  await refreshAnalyticsAccounts(latestSession);
                  await refreshWorkspace(latestSession, { silent: true });
                  const refreshed = Number(result.refreshed || (result.status === "refreshed" || result.status === "partial" ? 1 : 0));
                  const failed = Number(result.failed || (result.status === "failed" ? 1 : 0));
                  const metricErrors = Number(result.metric_errors || 0);
                  notify(
                    accountId
                      ? `Account refresh finished: ${result.status || "done"}${metricErrors ? `, ${metricErrors} metric warnings` : ""}.`
                      : `Analytics refresh finished: ${refreshed} refreshed, ${failed} failed.`,
                    failed ? "error" : "success",
                  );
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Unable to refresh analytics.", "error");
                  throw error;
                }
              }}
              onReloadData={async () => {
                if (!session) {
                  throw new Error("Sign in again before reloading analytics data.");
                }
                const activeSession = readStoredSession() || session;
                await Promise.all([
                  refreshAnalyticsAccounts(activeSession),
                  refreshWorkspace(activeSession, { silent: true }),
                ]);
                notify("Analytics data reloaded from the database.");
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
        onSubmit={async (payload, mediaFiles) => {
          if (!selectedPageId) {
            notify("Select a page first.", "error");
            return;
          }
          try {
            const draft = await createPlanningRow(session, applySession, selectedPageId, payload);
            if (mediaFiles.length) {
              const formData = new FormData();
              const pendingOrder = mediaFiles.map((_, index) => `pending::${index}`);
              formData.append("pending_order", JSON.stringify(pendingOrder));
              formData.append("media_order", JSON.stringify(pendingOrder));
              mediaFiles.forEach((file) => formData.append("creative", file));
              await uploadPlanningCreativeMedia(session, applySession, draft.id, formData);
            }
            notify("Post draft created.");
            setModal(null);
            await refreshWorkspace();
            await refreshPlanning();
          } catch (error) {
            notify(error instanceof Error ? error.message : "Unable to create post draft.", "error");
          }
        }}
        open={modal === "post"}
        page={selectedPage}
      />
      <LinkedInManualModal
        onClose={() => setManualPost(null)}
        onComplete={async (post) => {
          try {
            const updated = await updateLinkedInManualPost(session, applySession, post.id, { done: true });
            notify("Manual LinkedIn item marked complete.");
            setManualPost(updated.linkedin_manual.required && !updated.linkedin_manual.done ? updated : null);
            await refreshWorkspace();
            await refreshPlanning();
          } catch (error) {
            notify(error instanceof Error ? error.message : "Unable to mark manual item complete.", "error");
          }
        }}
        open={Boolean(manualPost)}
        post={manualPost}
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
          <p>Live pages, posts, publishing queue, account health, and settings load through the API after sign-in.</p>
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

function SectionTabs<T extends string>(props: {
  value: T;
  items: Array<{ value: T; label: string; detail?: string; count?: number }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="section-tabs" role="tablist">
      {props.items.map((item) => (
        <button
          aria-selected={props.value === item.value}
          className={props.value === item.value ? "section-tab section-tab-active" : "section-tab"}
          key={item.value}
          onClick={() => props.onChange(item.value)}
          role="tab"
          type="button"
        >
          <span>
            <strong>{item.label}</strong>
            {item.detail ? <small>{item.detail}</small> : null}
          </span>
          {typeof item.count === "number" ? <Badge tone={item.count ? "info" : "neutral"}>{item.count}</Badge> : null}
        </button>
      ))}
    </div>
  );
}

function SortControl<T extends string>(props: {
  value: T;
  options: SortOption<T>[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <label className="sort-control">
      <span>{props.label || "Sort"}</span>
      <select
        aria-label={props.label || "Sort"}
        onChange={(event) => props.onChange(event.target.value as T)}
        value={props.value}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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
  const [view, setView] = useState<"today" | "queue" | "notifications">("today");
  const totalAccounts = props.workspace.pages.reduce((count, page) => count + page.social_accounts.length, 0);
  const queuedPosts = props.workspace.posts.filter((post) =>
    ["draft", "scheduled", "posting", "manual_pending"].includes(post.status),
  );
  const failedPosts = props.workspace.posts.filter((post) => post.status === "failed");
  const todayKey = toDateKey(new Date());
  const matchingEvents = props.plannerEvents.filter((event) =>
    matchesQuery([event.title, event.pageName, event.platforms.join(" "), event.status], props.query),
  );
  const upcomingEvents = matchingEvents.filter((event) => isUpcomingPlannerEvent(event, todayKey));
  const futureQueueEvents = matchingEvents.filter((event) => isPublishingQueueEvent(event, todayKey));
  const visibleQueueEvents = futureQueueEvents.slice(0, 8);
  const nextEvent = upcomingEvents[0] || futureQueueEvents[0] || null;
  const priority = props.notifications[0] || null;
  const health = workspaceHealth(props.workspace);

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          <>
            <Button icon="plus" onClick={() => props.onOpenModal("post")} variant="primary">
              Create post
            </Button>
            <Button icon="refresh" onClick={props.onRefresh}>
              Refresh
            </Button>
          </>
        }
        eyebrow="Command center"
        meta={
          <>
            <Badge tone={health >= 80 ? "good" : "warn"}>{health}% healthy</Badge>
            <Badge tone={props.notifications.length ? "bad" : "good"}>{props.notifications.length} alerts</Badge>
            <Badge tone="info">{futureQueueEvents.length} queued</Badge>
          </>
        }
        title="Dashboard"
      />

      <SectionTabs
        items={[
          { value: "today", label: "Today at a glance" },
          { value: "queue", label: "Queue", count: futureQueueEvents.length },
          { value: "notifications", label: "Notifications", count: props.notifications.length },
        ]}
        onChange={setView}
        value={view}
      />

      {view === "today" ? (
        <>
          <section className="dashboard-cockpit">
            <div className="dashboard-command-panel">
              <div>
                <p className="eyebrow">Today</p>
                <h2>
                  {props.notifications.length
                    ? `${props.notifications.length} item${props.notifications.length === 1 ? "" : "s"} need attention`
                    : "Workspace clear"}
                </h2>
                {nextEvent ? <p>Next: {nextEvent.time} · {nextEvent.title} · {nextEvent.pageName}</p> : null}
              </div>
              <div className="cockpit-actions">
                <Button onClick={() => props.onSectionOpen(failedPosts.length ? "notifications" : "planner")} variant="primary">
                  {failedPosts.length ? "Recover failures" : "Open planner"}
                </Button>
                <Button onClick={() => props.onSectionOpen("analytics")}>View reports</Button>
              </div>
              <div className="ops-summary-metrics">
                <span>
                  <strong>{failedPosts.length}</strong>
                  <small>Failed</small>
                </span>
                <span>
                  <strong>{futureQueueEvents.length}</strong>
                  <small>Queued</small>
                </span>
                <span>
                  <strong>{props.workspace.scheduler.running ? "On" : "Off"}</strong>
                  <small>Scheduler</small>
                </span>
              </div>
            </div>
            <aside className="dashboard-priority-panel">
              <p className="eyebrow">Priority</p>
              {priority ? (
                <>
                  <Badge tone={priority.tone}>{priority.priority}</Badge>
                  <h3>{priority.title}</h3>
                  <Button onClick={() => props.onSectionOpen(priority.source)} variant="ghost">
                    Review
                  </Button>
                </>
              ) : (
                <>
                  <Badge tone="good">Clear</Badge>
                  <h3>No blockers active</h3>
                  <Button onClick={() => props.onSectionOpen("planner")} variant="ghost">
                    Open planner
                  </Button>
                </>
              )}
            </aside>
          </section>

          <section className="stats-grid" aria-label="Workspace metrics">
            <StatCard helper="Pages" label="Managed pages" value={String(props.workspace.pages.length)} />
            <StatCard helper="Connected" label="Accounts" value={String(totalAccounts)} />
            <StatCard helper="Drafts and scheduled" label="Posts in motion" value={String(queuedPosts.length)} />
            <StatCard
              helper="Jobs"
              label="Scheduler"
              tone={props.workspace.scheduler.running ? "good" : "bad"}
              trend={props.workspace.scheduler.running ? "Running" : "Stopped"}
              value={String(props.workspace.scheduler.scheduled_jobs)}
            />
          </section>
        </>
      ) : null}

      {view === "queue" ? (
        <Card
          actions={<Button onClick={() => props.onSectionOpen("planner")} variant="ghost">Open planner</Button>}
          title="Publishing queue"
        >
          <div className="queue-list queue-list-wide">
            {visibleQueueEvents.length ? (
              visibleQueueEvents.map((event) => <PlannerEventRow event={event} key={event.id} />)
            ) : (
              <EmptyState description="No future posts are queued." title="Queue clear" />
            )}
          </div>
        </Card>
      ) : null}

      {view === "notifications" ? (
        <>
          <div className="dashboard-workbench">
            <Card
              actions={<Button onClick={() => props.onSectionOpen("notifications")} variant="ghost">Open inbox</Button>}
              title="Needs attention"
            >
              <div className="attention-list">
                {props.notifications.length ? (
                  props.notifications.slice(0, 5).map((item) => (
                    <article className="attention-item" key={item.id}>
                      <Badge tone={item.tone}>{item.priority}</Badge>
                      <p>{item.title}</p>
                      <Button onClick={() => props.onSectionOpen(item.source)} variant="ghost">
                        Review
                      </Button>
                    </article>
                  ))
                ) : (
                  <EmptyState description="No active alerts." title="Inbox clear" />
                )}
              </div>
            </Card>
            <Card title="General status">
              <div className="detail-list">
                <div>
                  <span>Health</span>
                  <strong>{health}%</strong>
                </div>
                <div>
                  <span>Failed posts</span>
                  <strong>{failedPosts.length}</strong>
                </div>
                <div>
                  <span>Queued posts</span>
                  <strong>{futureQueueEvents.length}</strong>
                </div>
                <div>
                  <span>Scheduler</span>
                  <strong>{props.workspace.scheduler.running ? "Running" : "Stopped"}</strong>
                </div>
              </div>
            </Card>
          </div>

          <div className="split-grid">
            <Card title="Post status">
              <BarChart items={props.statusChart} />
            </Card>
            <Card title="Platform coverage">
              <BarChart items={props.platformChart} />
            </Card>
          </div>
        </>
      ) : null}
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
  const [view, setView] = useState<"clients" | "accounts" | "publishing">("clients");
  const [clientSort, setClientSort] = useState<ProjectSort>("name-asc");
  const [accountSort, setAccountSort] = useState<ProjectAccountSort>("page-asc");
  const [publishingSort, setPublishingSort] = useState<ProjectSort>("queued-desc");
  const sortedPages = sortPages(pages, clientSort);
  const publishingPages = sortPages(pages, publishingSort);
  const selected = props.selectedPage && pages.some((page) => page.id === props.selectedPage?.id)
    ? props.selectedPage
    : sortedPages[0] || null;
  const connectedAccountCount = pages.reduce((count, page) => count + page.social_accounts.length, 0);
  const queuedPagePosts = pages.reduce((count, page) => count + page.stats.scheduled_posts, 0);
  const failedPagePosts = pages.reduce((count, page) => count + page.stats.failed_posts, 0);
  const accountRows = pages.flatMap((page) =>
    page.social_accounts.map((account) => ({ page, account })),
  );
  const sortedAccountRows = sortProjectAccounts(accountRows, accountSort);

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
        eyebrow="Workspace structure"
        meta={
          <>
            <Badge tone="info">{pages.length} shown</Badge>
            <Badge tone="good">{props.workspace.pages.length} total pages</Badge>
          </>
        }
        title="Projects"
      />

      <SectionTabs
        items={[
          { value: "clients", label: "Clients", count: pages.length },
          { value: "accounts", label: "Accounts", count: sortedAccountRows.length },
          { value: "publishing", label: "Publishing", count: queuedPagePosts + failedPagePosts },
        ]}
        onChange={setView}
        value={view}
      />

      {view === "clients" ? (
        <>
          <section className="project-overview-strip" aria-label="Project overview">
            <div>
              <span>Visible pages</span>
              <strong>{pages.length}</strong>
            </div>
            <div>
              <span>Connected accounts</span>
              <strong>{connectedAccountCount}</strong>
            </div>
            <div>
              <span>Queued posts</span>
              <strong>{queuedPagePosts}</strong>
            </div>
            <div>
              <span>Failed posts</span>
              <strong>{failedPagePosts}</strong>
            </div>
          </section>

          <div className="list-toolbar">
            <SortControl onChange={setClientSort} options={PROJECT_SORT_OPTIONS} value={clientSort} />
          </div>

          <div className="projects-layout">
        <div className="project-list">
          {sortedPages.length ? (
            sortedPages.map((page) => (
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
        </>
      ) : null}

      {view === "accounts" ? (
        <div className="focus-grid">
          <Card
            actions={
              <>
                <SortControl onChange={setAccountSort} options={PROJECT_ACCOUNT_SORT_OPTIONS} value={accountSort} />
                {selected ? <Button onClick={() => props.onConnectAccount(selected.id)} variant="primary">Connect account</Button> : null}
              </>
            }
            title="Connected accounts"
          >
            {sortedAccountRows.length ? (
              <ResponsiveTable
                columns={[
                  { key: "page", label: "Page", render: (item) => <strong>{item.page.name}</strong> },
                  { key: "platform", label: "Platform", render: (item) => <Badge tone="info">{item.account.platform}</Badge> },
                  { key: "name", label: "Account", render: (item) => item.account.account_name || "Unnamed account" },
                  { key: "state", label: "State", render: (item) => <Badge tone={item.account.is_active ? "good" : "warn"}>{item.account.is_active ? "Active" : "Inactive"}</Badge> },
                ]}
                getKey={(item) => item.account.id}
                items={sortedAccountRows}
              />
            ) : (
              <EmptyState
                action={selected ? <Button onClick={() => props.onConnectAccount(selected.id)}>Connect account</Button> : null}
                description="No matching pages have connected social accounts."
                title="No accounts"
              />
            )}
          </Card>
          <Card title="Account coverage">
            <BarChart
              items={pages.map((page) => ({
                label: page.name,
                value: page.social_accounts.length,
                tone: page.social_accounts.length ? "good" : "warn",
              }))}
            />
          </Card>
        </div>
      ) : null}

      {view === "publishing" ? (
        <div className="focus-grid">
          <Card
            actions={<SortControl onChange={setPublishingSort} options={PROJECT_SORT_OPTIONS} value={publishingSort} />}
            title="Page publishing health"
          >
            <ResponsiveTable
              columns={[
                { key: "page", label: "Page", render: (page) => <strong>{page.name}</strong> },
                { key: "queued", label: "Queued", render: (page) => page.stats.scheduled_posts },
                { key: "posted", label: "Posted", render: (page) => page.stats.successful_posts },
                { key: "failed", label: "Failed", render: (page) => <Badge tone={page.stats.failed_posts ? "bad" : "good"}>{page.stats.failed_posts}</Badge> },
              ]}
              getKey={(page) => page.id}
              items={publishingPages}
            />
          </Card>
          <Card title="Queued workload">
            <BarChart
              items={publishingPages.map((page) => ({
                label: page.name,
                value: page.stats.scheduled_posts,
                tone: page.stats.failed_posts ? "bad" : "info",
              }))}
            />
          </Card>
        </div>
      ) : null}
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
  canManagePlanning: boolean;
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
  onPublishRow: (row: PlanningRowRecord) => Promise<void>;
  onManualOpen: (post: PostRecord) => void;
  onManualComplete: (post: PostRecord) => Promise<void>;
  onRetryPost: (post: PostRecord) => Promise<void>;
  onImport: () => Promise<void>;
  onSchedule: (row: PlanningRowRecord) => Promise<void>;
}) {
  const calendarDays = buildCalendarDays(props.selectedMonth, props.calendarMode, props.calendarAnchor);
  const visibleEvents = props.events.filter((event) =>
    matchesQuery([event.title, event.pageName, event.status, event.platforms.join(" ")], props.query),
  );
  const draftRows = props.planning?.rows.filter((row) => !row.scheduled_post_id && !row.is_non_actionable) || [];
  const visibleDraftRows = draftRows.filter((row) =>
    matchesQuery([row.theme, row.job_nr, row.post_copy, row.linked_accounts, row.designer], props.query),
  );
  const [view, setView] = useState<"calendar" | "list" | "queue" | "drafts">("calendar");
  const [readinessSort, setReadinessSort] = useState<PlannerEventSort>("date-asc");
  const [queueSort, setQueueSort] = useState<PlannerEventSort>("date-asc");
  const [draftSort, setDraftSort] = useState<DraftSort>("order-asc");
  const selectedPage = props.workspace.pages.find((page) => page.id === props.selectedPageId) || null;
  const todayKey = toDateKey(new Date());
  const futureQueueEvents = visibleEvents.filter((event) => isPublishingQueueEvent(event, todayKey));
  const sortedReadinessEvents = sortPlannerEvents(visibleEvents, readinessSort);
  const sortedFutureQueueEvents = sortPlannerEvents(futureQueueEvents, queueSort);
  const sortedDraftRows = sortDraftRows(
    visibleDraftRows,
    draftSort,
    props.planning?.job_color_rules.required_to_schedule || READY_COLOR,
  );
  const readyDrafts =
    draftRows.filter(
      (row) => rowStatus(row, props.planning?.job_color_rules.required_to_schedule || READY_COLOR).label === "Draft",
    ).length || 0;
  const listRowsWithoutDates = sortedDraftRows.filter((row) => !parseRowDate(row));

  return (
    <div className="page-stack">
      <PageHeader
        actions={
          props.canManagePlanning ? (
            <>
              <Button onClick={props.onImport}>Import posts</Button>
              <Button icon="plus" onClick={() => props.onCreatePost(props.calendarAnchor)} variant="primary">
                Create post
              </Button>
            </>
          ) : null
        }
        eyebrow="Publishing workflow"
        meta={
          <>
            <Badge tone="info">{formatMonth(props.selectedMonth)}</Badge>
            <Badge tone={props.loading ? "warn" : "good"}>{props.loading ? "Loading" : "Synced"}</Badge>
            <Badge tone="info">{futureQueueEvents.length} queued</Badge>
          </>
        }
        title="Planner"
      />

      <SectionTabs
        items={[
          { value: "calendar", label: "Calendar", count: visibleEvents.length },
          { value: "list", label: "List", count: visibleEvents.length + listRowsWithoutDates.length },
          { value: "queue", label: "Queue", count: futureQueueEvents.length },
          { value: "drafts", label: "Drafts", count: visibleDraftRows.length },
        ]}
        onChange={setView}
        value={view}
      />

      <section className="planner-command-grid" aria-label="Planner command metrics">
        <div>
          <span>Selected client</span>
          <strong>{selectedPage?.name || "No page selected"}</strong>
        </div>
        <div>
          <span>Calendar items</span>
          <strong>{visibleEvents.length}</strong>
        </div>
        <div>
          <span>Ready drafts</span>
          <strong>{readyDrafts}</strong>
        </div>
        <div>
          <span>Drafts</span>
          <strong>{draftRows.length}</strong>
        </div>
      </section>

      {view === "calendar" ? (
        <>
      <Card className="planner-control-card">
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
            canManagePlanning={props.canManagePlanning}
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

        <Card
          actions={<SortControl onChange={setReadinessSort} options={PLANNER_EVENT_SORT_OPTIONS} value={readinessSort} />}
          title="Readiness"
        >
          <div className="queue-list">
            {sortedReadinessEvents.slice(0, 8).map((event) => (
              <PlannerEventRow
                action={
                  <PlannerEventActions
                    event={event}
                    onDeletePost={props.onDeletePost}
                    onDuplicateRow={props.onDuplicateRow}
                    onManualOpen={props.onManualOpen}
                    onPublishRow={props.onPublishRow}
                    onManualComplete={props.onManualComplete}
                    onPreview={props.onPreview}
                    onRetryPost={props.onRetryPost}
                    onSchedule={props.onSchedule}
                    canManagePlanning={props.canManagePlanning}
                  />
                }
                event={event}
                key={event.id}
              />
            ))}
            {!visibleEvents.length ? (
              <EmptyState
                description="No dated posts match this view."
                title="No calendar items"
              />
            ) : null}
          </div>
        </Card>
      </div>
        </>
      ) : null}

      {view === "list" ? (
        <>
          <Card className="planner-control-card" title="List controls">
            <div className="planner-toolbar">
              <Field label="Page/client">
                <select
                  aria-label="Select page for list"
                  onChange={(event) => props.onPageChange(Number(event.target.value))}
                  value={props.selectedPageId || ""}
                >
                  {props.workspace.pages.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="planner-list-context">
                <span>Selected</span>
                <strong>{selectedPage?.name || "No page selected"}</strong>
              </div>
            </div>
          </Card>
          <Card
            actions={<SortControl onChange={setReadinessSort} options={PLANNER_EVENT_SORT_OPTIONS} value={readinessSort} />}
            title="All posts"
          >
            <div className="queue-list queue-list-wide">
              {sortPlannerEvents(visibleEvents, readinessSort).map((event) => (
                <PlannerEventRow
                  action={
                    <PlannerEventActions
                      event={event}
                      onDeletePost={props.onDeletePost}
                      onDuplicateRow={props.onDuplicateRow}
                      onManualOpen={props.onManualOpen}
                      onPublishRow={props.onPublishRow}
                      onManualComplete={props.onManualComplete}
                      onPreview={props.onPreview}
                      onRetryPost={props.onRetryPost}
                      onSchedule={props.onSchedule}
                      canManagePlanning={props.canManagePlanning}
                    />
                  }
                  event={event}
                  key={event.id}
                />
              ))}
              {listRowsWithoutDates.map((row) => (
                <PlannerDraftRow
                  canManagePlanning={props.canManagePlanning}
                  key={`draft-${row.id}`}
                  onDuplicateRow={props.onDuplicateRow}
                  onPublishRow={props.onPublishRow}
                  onSchedule={props.onSchedule}
                  row={row}
                  status={rowStatus(row, props.planning?.job_color_rules.required_to_schedule || READY_COLOR)}
                />
              ))}
              {!visibleEvents.length && !listRowsWithoutDates.length ? (
                <EmptyState description="No posts match this search." title="No posts" />
              ) : null}
            </div>
          </Card>
        </>
      ) : null}

      {view === "queue" ? (
        <Card
          actions={<SortControl onChange={setQueueSort} options={PLANNER_EVENT_SORT_OPTIONS} value={queueSort} />}
          title="Publishing queue"
        >
          <div className="queue-list queue-list-wide">
            {sortedFutureQueueEvents.length ? (
              sortedFutureQueueEvents.map((event) => (
                <PlannerEventRow
                  action={
                    <PlannerEventActions
                      event={event}
                      onDeletePost={props.onDeletePost}
                      onDuplicateRow={props.onDuplicateRow}
                      onManualOpen={props.onManualOpen}
                      onPublishRow={props.onPublishRow}
                      onManualComplete={props.onManualComplete}
                      onPreview={props.onPreview}
                      onRetryPost={props.onRetryPost}
                      onSchedule={props.onSchedule}
                      canManagePlanning={props.canManagePlanning}
                    />
                  }
                  event={event}
                  key={event.id}
                />
              ))
            ) : (
              <EmptyState
                description="Only future queued posts appear here."
                title="No future queued posts"
              />
            )}
          </div>
        </Card>
      ) : null}

      {view === "drafts" ? (
        <Card
          actions={<SortControl onChange={setDraftSort} options={DRAFT_SORT_OPTIONS} value={draftSort} />}
          title="Drafts"
        >
          <div className="queue-list queue-list-wide">
            {sortedDraftRows.length ? sortedDraftRows.map((row) => (
              <PlannerDraftRow
                canManagePlanning={props.canManagePlanning}
                key={row.id}
                onDuplicateRow={props.onDuplicateRow}
                onPublishRow={props.onPublishRow}
                onSchedule={props.onSchedule}
                row={row}
                status={rowStatus(row, props.planning?.job_color_rules.required_to_schedule || READY_COLOR)}
              />
            )) : (
              <EmptyState
                description="Create a post to start a draft for the selected client."
                title="No drafts"
              />
            )}
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
  return Boolean(normalized)
    && normalized !== "fans"
    && normalized !== "fan_count"
    && normalized !== "online_followers"
    && normalized !== "page_follows"
    && !normalized.startsWith("page_fan");
}

function isDisplayInsight(insight: SocialInsightRecord): boolean {
  return insight.metric_value !== null && !insight.error_message && isSupportedInsightMetric(insight.metric_name);
}

function accountInsightsForDisplay(account: AnalyticsAccountRecord): SocialInsightRecord[] {
  return (Array.isArray(account.insights) ? account.insights : []).filter(isDisplayInsight);
}

function accountInsightDiagnostics(account: AnalyticsAccountRecord): SocialInsightRecord[] {
  return Array.isArray(account.diagnostics) ? account.diagnostics : [];
}

function diagnosticMessage(insight: SocialInsightRecord): string {
  if (insight.error_message) {
    return insight.error_message;
  }
  const metadata = insight.source_metadata || {};
  const reason = typeof metadata.reason === "string" ? metadata.reason : null;
  const availability = typeof metadata.availability === "string" ? metadata.availability : null;
  if (reason === "permission_unavailable") {
    return "Meta marked this metric unavailable. Check permissions, account type, and metric availability.";
  }
  if (reason === "no_data" || availability === "unavailable") {
    return "Meta returned no value for this metric in the selected refresh window.";
  }
  return "Metric unavailable or returned no numeric value.";
}

function diagnosticRawMetric(insight: SocialInsightRecord): string {
  const metadata = insight.source_metadata || {};
  const graphMetric = metadata.graph_metric;
  if (typeof graphMetric === "string" && graphMetric.trim()) {
    return graphMetric;
  }
  const candidates = metadata.candidate_metrics;
  if (Array.isArray(candidates) && candidates.length) {
    return candidates.map(String).join(", ");
  }
  const fields = metadata.candidate_fields;
  if (Array.isArray(fields) && fields.length) {
    return fields.map(String).join(", ");
  }
  return insight.metric_name;
}

function insightDiagnostics(accounts: AnalyticsAccountRecord[]): Array<{ account: AnalyticsAccountRecord; insight: SocialInsightRecord }> {
  return accounts
    .flatMap((account) => accountInsightDiagnostics(account).map((insight) => ({ account, insight })))
    .sort((a, b) => {
      const aDate = insightDate(a.insight)?.getTime() || 0;
      const bDate = insightDate(b.insight)?.getTime() || 0;
      return bDate - aDate;
    });
}

function formatMetricName(metricName: string): string {
  const labels: Record<string, string> = {
    views: "Views",
    page_media_view: "Views",
    page_views_total: "Visits",
    page_impressions_unique: "Reach",
    page_total_media_view_unique: "Viewers",
    engagement: "Content interactions",
    page_post_engagements: "Engagement",
    followers: "Followers",
    followers_count: "Followers",
    reach: "Reach",
    visits: "Visits",
    media_count: "Media count",
    profile_views: "Visits",
    reactions: "Reactions",
    likes: "Likes",
    comments: "Comments",
    shares: "Shares",
    saved: "Saves",
    accounts_engaged: "Content interactions",
    total_interactions: "Content interactions",
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
  if (["views", "page_media_view"].includes(normalized)) {
    return "views";
  }
  if (["engagement", "page_post_engagements", "total_interactions", "accounts_engaged"].includes(normalized)) {
    return "engagement";
  }
  if (["followers", "followers_count", "follower_count"].includes(normalized)) {
    return "followers";
  }
  if (["reach", "page_impressions_unique", "page_total_media_view_unique"].includes(normalized)) {
    return "reach";
  }
  if (["visits", "profile_views", "page_views_total"].includes(normalized)) {
    return "visits";
  }
  if (["media_count"].includes(normalized)) {
    return "media_count";
  }
  return normalized || "metric";
}

function startOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function sameLocalDay(left: Date, right: Date): boolean {
  return startOfLocalDay(left).getTime() === startOfLocalDay(right).getTime();
}

function insightRawDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function insightInterval(insight: SocialInsightRecord): { start: Date; end: Date } | null {
  const start = insightRawDate(insight.start_date);
  const end = insightRawDate(insight.end_date);
  if (!start || !end) {
    return null;
  }
  return {
    start: startOfLocalDay(start),
    end: startOfLocalDay(end),
  };
}

function isRangeTotalInsight(insight: SocialInsightRecord): boolean {
  const interval = insightInterval(insight);
  return Boolean(interval && !sameLocalDay(interval.start, interval.end));
}

function latestInsightTime(insight: SocialInsightRecord): number {
  const refreshedAt = insightRawDate(insight.refreshed_at);
  return refreshedAt?.getTime() || insightDate(insight)?.getTime() || 0;
}

function metricRangeBounds(
  range: AnalyticsRange,
  customStart?: string,
  customEnd?: string,
): { start: Date | null; end: Date | null } {
  const bounds = rangeBounds(range, customStart, customEnd);
  return {
    start: bounds.start ? startOfLocalDay(bounds.start) : null,
    end: bounds.end ? endOfLocalDay(bounds.end) : endOfLocalDay(new Date()),
  };
}

function selectIntervalPartition(
  rows: SocialInsightRecord[],
  targetStart: Date,
  targetEnd: Date,
): number | null {
  const latestByRange = new Map<string, SocialInsightRecord>();
  rows.forEach((row) => {
    const interval = insightInterval(row);
    if (!interval) {
      return;
    }
    if (interval.start < startOfLocalDay(targetStart) || interval.end > startOfLocalDay(targetEnd)) {
      return;
    }
    const key = `${toDateKey(interval.start)}:${toDateKey(interval.end)}`;
    const current = latestByRange.get(key);
    if (!current || latestInsightTime(row) >= latestInsightTime(current)) {
      latestByRange.set(key, row);
    }
  });
  const candidates = Array.from(latestByRange.values());
  const targetStartDay = startOfLocalDay(targetStart);
  const targetEndDay = startOfLocalDay(targetEnd);
  const exact = candidates
    .filter((row) => {
      const interval = insightInterval(row);
      return Boolean(interval && sameLocalDay(interval.start, targetStartDay) && sameLocalDay(interval.end, targetEndDay));
    })
    .sort((a, b) => latestInsightTime(b) - latestInsightTime(a));
  if (exact.length) {
    return Number(exact[0].metric_value || 0);
  }

  const selected: SocialInsightRecord[] = [];
  const cursor = new Date(targetStartDay);
  while (cursor <= targetEndDay) {
    const choices = candidates
      .filter((row) => {
        const interval = insightInterval(row);
        return Boolean(interval && sameLocalDay(interval.start, cursor) && interval.end <= targetEndDay);
      })
      .sort((a, b) => {
        const aInterval = insightInterval(a);
        const bInterval = insightInterval(b);
        const endDelta = (bInterval?.end.getTime() || 0) - (aInterval?.end.getTime() || 0);
        return endDelta || latestInsightTime(b) - latestInsightTime(a);
      });
    if (!choices.length) {
      return null;
    }
    const choice = choices[0];
    const interval = insightInterval(choice);
    if (!interval) {
      return null;
    }
    selected.push(choice);
    cursor.setTime(interval.end.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return selected.reduce((sum, row) => sum + Number(row.metric_value || 0), 0);
}

function selectBestRangeTotalInsight(
  rows: SocialInsightRecord[],
  targetStart: Date,
  targetEnd: Date,
): SocialInsightRecord | null {
  const targetStartDay = startOfLocalDay(targetStart);
  const targetEndDay = startOfLocalDay(targetEnd);
  const targetEndTime = targetEndDay.getTime();
  const candidates = rows
    .filter((row) => row.metric_value !== null && !row.error_message && isRangeTotalInsight(row))
    .map((row) => {
      const interval = insightInterval(row);
      return interval ? { row, interval } : null;
    })
    .filter((item): item is { row: SocialInsightRecord; interval: { start: Date; end: Date } } => Boolean(item))
    .filter(({ interval }) => interval.end >= targetStartDay && interval.start <= targetEndDay);
  if (!candidates.length) {
    return null;
  }

  const exact = candidates
    .filter(({ interval }) => {
      if (!sameLocalDay(interval.start, targetStartDay)) {
        return false;
      }
      if (sameLocalDay(interval.end, targetEndDay)) {
        return true;
      }
      const daysShort = Math.round((targetEndTime - interval.end.getTime()) / 86400000);
      return daysShort >= 0 && daysShort <= 1;
    })
    .sort((a, b) => latestInsightTime(b.row) - latestInsightTime(a.row));
  if (exact.length) {
    return exact[0].row;
  }

  const contained = candidates
    .filter(({ interval }) => interval.start >= targetStartDay && interval.end <= targetEndDay)
    .sort((a, b) => {
      const coverageDelta = (b.interval.end.getTime() - b.interval.start.getTime()) - (a.interval.end.getTime() - a.interval.start.getTime());
      return coverageDelta || latestInsightTime(b.row) - latestInsightTime(a.row);
    });
  if (contained.length) {
    return contained[0].row;
  }

  const covering = candidates
    .filter(({ interval }) => interval.start <= targetStartDay && interval.end >= targetEndDay)
    .sort((a, b) => {
      const spanDelta = (a.interval.end.getTime() - a.interval.start.getTime()) - (b.interval.end.getTime() - b.interval.start.getTime());
      return spanDelta || latestInsightTime(b.row) - latestInsightTime(a.row);
    });
  return covering.length ? covering[0].row : null;
}

function activityMetricValue(
  rows: SocialInsightRecord[],
  metric: string,
  start: Date | null,
  end: Date | null,
): number {
  const metricRows = rows.filter((insight) => analyticsMetricCategory(insight.metric_name) === metric);
  if (!metricRows.length) {
    return 0;
  }
  if (!start || !end) {
    const latestRows = metricRows
      .filter((insight) => insight.period === "lifetime")
      .sort((a, b) => latestInsightTime(b) - latestInsightTime(a));
    if (latestRows.length) {
      return Math.round(Number(latestRows[0].metric_value || 0));
    }
    return Math.round(metricRows.reduce((sum, insight) => sum + Number(insight.metric_value || 0), 0));
  }

  const intervalTotal = selectIntervalPartition(metricRows, start, end);
  if (intervalTotal !== null) {
    return Math.round(intervalTotal);
  }

  const rangeTotal = selectBestRangeTotalInsight(metricRows, start, end);
  if (rangeTotal) {
    return Math.round(Number(rangeTotal.metric_value || 0));
  }

  if (metric === "reach") {
    const periodRows = metricRows
      .filter((insight) => insight.period && insight.period !== "day")
      .filter((insight) => {
        const date = insightDate(insight);
        return Boolean(date && date >= start && date <= end);
      })
      .sort((a, b) => latestInsightTime(b) - latestInsightTime(a));
    return periodRows.length ? Math.round(Number(periodRows[0].metric_value || 0)) : 0;
  }

  const latestByDay = new Map<string, SocialInsightRecord>();
  metricRows.forEach((insight) => {
    if (isRangeTotalInsight(insight)) {
      return;
    }
    const date = insightDate(insight);
    if (!date || date < start || date > end) {
      return;
    }
    const key = toDateKey(date);
    const current = latestByDay.get(key);
    if (!current || latestInsightTime(insight) >= latestInsightTime(current)) {
      latestByDay.set(key, insight);
    }
  });
  return Math.round(
    Array.from(latestByDay.values()).reduce((sum, insight) => sum + Number(insight.metric_value || 0), 0),
  );
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
  const latestValueMetrics = new Set(["followers", "media_count"]);
  if (latestValueMetrics.has(metric)) {
    const candidates = accountInsightsForDisplay(account)
      .filter((insight) => analyticsMetricCategory(insight.metric_name) === metric)
      .filter((insight) => insight.period === "lifetime" || insight.period === "snapshot");
    const rangeRows = filterInsightsByRange(candidates, range, customStart, customEnd);
    const latestRows = (rangeRows.length ? rangeRows : candidates)
      .sort((a, b) => (insightDate(b)?.getTime() || 0) - (insightDate(a)?.getTime() || 0));
    return latestRows.length ? Math.round(Number(latestRows[0].metric_value || 0)) : 0;
  }
  const bounds = metricRangeBounds(range, customStart, customEnd);
  return activityMetricValue(accountInsightsForDisplay(account), metric, bounds.start, bounds.end);
}

function buildMetricTimeSeries(
  accounts: AnalyticsAccountRecord[],
  metric: string,
  range: AnalyticsRange,
  customStart?: string,
  customEnd?: string,
): TimeSeriesPoint[] {
  const buckets = new Map<string, number>();
  const latestValueMetrics = new Set(["followers", "media_count"]);
  const bounds = metricRangeBounds(range, customStart, customEnd);
  let usedRangeTotals = false;
  accounts.forEach((account) => {
    const metricRows = accountInsightsForDisplay(account)
      .filter((insight) => analyticsMetricCategory(insight.metric_name) === metric);
    const accountRows = filterInsightsByRange(metricRows, range, customStart, customEnd)
      .filter((insight) => !latestValueMetrics.has(metric) || insight.period === "lifetime" || insight.period === "snapshot");
    if (latestValueMetrics.has(metric)) {
      const accountBuckets = new Map<string, { value: number; time: number }>();
      accountRows.forEach((insight) => {
        const date = insightDate(insight);
        if (!date) {
          return;
        }
        const key = toDateKey(date);
        const time = date.getTime();
        const current = accountBuckets.get(key);
        if (!current || time >= current.time) {
          accountBuckets.set(key, { value: Number(insight.metric_value || 0), time });
        }
      });
      accountBuckets.forEach((item, key) => {
        buckets.set(key, (buckets.get(key) || 0) + item.value);
      });
      return;
    }
    if (range !== "all" && bounds.start && bounds.end) {
      const rangeTotal = selectBestRangeTotalInsight(metricRows, bounds.start, bounds.end);
      const rangeTotalDate = rangeTotal ? insightInterval(rangeTotal)?.end || insightDate(rangeTotal) : null;
      if (rangeTotal && rangeTotalDate) {
        const key = toDateKey(bounds.end);
        buckets.set(key, (buckets.get(key) || 0) + Number(rangeTotal.metric_value || 0));
        usedRangeTotals = true;
        return;
      }
    }
    const accountBuckets = new Map<string, { value: number; time: number }>();
    accountRows.forEach((insight) => {
      if (isRangeTotalInsight(insight)) {
        return;
      }
      const date = insightDate(insight);
      if (!date) {
        return;
      }
      const key = toDateKey(date);
      const time = latestInsightTime(insight);
      const current = accountBuckets.get(key);
      if (!current || time >= current.time) {
        accountBuckets.set(key, { value: Number(insight.metric_value || 0), time });
      }
    });
    accountBuckets.forEach((item, key) => {
      buckets.set(key, (buckets.get(key) || 0) + item.value);
    });
  });
  const series = Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value: Math.round(value) }));
  return usedRangeTotals ? series : expandMetricSeries(series, range, customStart, customEnd);
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
  if (["followers", "media_count"].includes(metric)) {
    return accounts.reduce((sum, account) => sum + accountMetricValue(account, metric, "all"), 0);
  }
  if (!start || !end) {
    return 0;
  }
  return accounts.reduce((sum, account) => {
    return sum + activityMetricValue(
      accountInsightsForDisplay(account),
      metric,
      startOfLocalDay(start),
      endOfLocalDay(end),
    );
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

function normalizePostMatchText(value: string | null | undefined): string {
  return String(value || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function postCaptionsMatch(localCaption: string, remoteCaption: string): boolean {
  const local = normalizePostMatchText(localCaption);
  const remote = normalizePostMatchText(remoteCaption);
  if (!local || !remote) {
    return false;
  }
  if (local === remote) {
    return true;
  }
  const shortest = Math.min(local.length, remote.length);
  if (shortest < 32) {
    return false;
  }
  if (local.slice(0, 160) === remote.slice(0, 160)) {
    return true;
  }
  return shortest >= 80 && (local.includes(remote) || remote.includes(local));
}

function datesWithinHours(first: string | null, second: string | null, hours: number): boolean {
  if (!first || !second) {
    return false;
  }
  const firstDate = new Date(first);
  const secondDate = new Date(second);
  if (Number.isNaN(firstDate.getTime()) || Number.isNaN(secondDate.getTime())) {
    return false;
  }
  return Math.abs(firstDate.getTime() - secondDate.getTime()) <= hours * 60 * 60 * 1000;
}

function localRowMatchesRemotePost(row: AnalyticsPostRow, remote: AnalyticsPostInsightRecord): boolean {
  if (row.platform !== remote.platform || row.pageId !== remote.page_id || row.platformPostId) {
    return false;
  }
  const matchWindowHours = normalizePostMatchText(remote.caption).length >= 80 ? 48 : 12;
  return postCaptionsMatch(row.caption, remote.caption) && datesWithinHours(row.publishedAt, remote.published_at, matchWindowHours);
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
  const localPostIds = new Set(posts.map((post) => post.id));
  const postInsightsByPostPlatform = new Map(
    (Array.isArray(analyticsPosts) ? analyticsPosts : [])
      .filter((item) => typeof item.internal_post_id === "number")
      .map((item) => [`${item.internal_post_id}-${item.platform}`, item]),
  );
  const postInsightsByRemoteId = new Map(
    (Array.isArray(analyticsPosts) ? analyticsPosts : [])
      .filter((item) => item.platform_post_id)
      .map((item) => [`${item.platform}-${item.platform_post_id}`, item]),
  );
  const rows: AnalyticsPostRow[] = [];
  const includedRemoteIds = new Set<string>();
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
      const resolvedPlatformPostId = platformPostId || postInsight?.platform_post_id || null;
      const row: AnalyticsPostRow = {
        id: `${post.id}-${platform}`,
        post,
        pageId: post.page_id,
        platform,
        platformPostId: resolvedPlatformPostId,
        permalink: postInsight?.permalink || post.platform_urls?.[platform] || null,
        thumbnail: postInsight?.thumbnail || firstPostMedia(post),
        caption: postInsight?.caption || post.content || "No caption saved.",
        pageName: postInsight?.page_name || post.page_name || pageNames.get(post.page_id) || "Unknown page",
        publishedAt: postInsight?.published_at || publishedAt,
        views: postInsight ? Number(postInsight.views || 0) : null,
        reach: postInsight ? Number(postInsight.reach || 0) : null,
        engagement: postInsight ? Number(postInsight.engagement || 0) : null,
        comments: postInsight ? Number(postInsight.comments || 0) : null,
        shares: postInsight ? Number(postInsight.shares || 0) : null,
        state: !resolvedPlatformPostId ? "missing_reference" : postInsight ? "ready" : "no_metrics",
      };
      if (resolvedPlatformPostId) {
        includedRemoteIds.add(`${platform}-${resolvedPlatformPostId}`);
      }
      if (matchesQuery([row.caption, row.pageName, row.platform, row.platformPostId], options.query)) {
        rows.push(row);
      }
    });
  });

  (Array.isArray(analyticsPosts) ? analyticsPosts : []).forEach((postInsight) => {
    const platformPostId = String(postInsight.platform_post_id || "").trim();
    const remoteKey = `${postInsight.platform}-${platformPostId}`;
    if (!platformPostId || includedRemoteIds.has(remoteKey)) {
      return;
    }
    if (typeof postInsight.internal_post_id === "number" && localPostIds.has(postInsight.internal_post_id)) {
      return;
    }
    const publishedAt = postInsight.published_at;
    const postDate = publishedAt ? new Date(publishedAt) : null;
    if (options.range !== "all" && postDate && !Number.isNaN(postDate.getTime())) {
      if (start && postDate < start) {
        return;
      }
      if (end && postDate > end) {
        return;
      }
    }
    if (options.platform !== "all" && postInsight.platform !== options.platform) {
      return;
    }
    const pageId = postInsight.page_id;
    if (options.pageId !== "all" && pageId !== options.pageId) {
      return;
    }
    const matchingLocalRow = rows.find((row) => localRowMatchesRemotePost(row, postInsight));
    if (matchingLocalRow) {
      matchingLocalRow.platformPostId = platformPostId;
      matchingLocalRow.permalink = postInsight.permalink;
      matchingLocalRow.thumbnail = postInsight.thumbnail || matchingLocalRow.thumbnail;
      matchingLocalRow.caption = postInsight.caption || matchingLocalRow.caption;
      matchingLocalRow.publishedAt = postInsight.published_at || matchingLocalRow.publishedAt;
      matchingLocalRow.views = Number(postInsight.views || 0);
      matchingLocalRow.reach = Number(postInsight.reach || 0);
      matchingLocalRow.engagement = Number(postInsight.engagement || 0);
      matchingLocalRow.comments = Number(postInsight.comments || 0);
      matchingLocalRow.shares = Number(postInsight.shares || 0);
      matchingLocalRow.state = postInsight.state === "ready" ? "ready" : "no_metrics";
      includedRemoteIds.add(remoteKey);
      return;
    }
    const row: AnalyticsPostRow = {
      id: `remote-${postInsight.id}`,
      post: null,
      pageId,
      platform: postInsight.platform,
      platformPostId,
      permalink: postInsight.permalink,
      thumbnail: postInsight.thumbnail,
      caption: postInsight.caption || "No caption saved.",
      pageName: postInsight.page_name || (pageId ? pageNames.get(pageId) : null) || "Unknown page",
      publishedAt,
      views: Number(postInsight.views || 0),
      reach: Number(postInsight.reach || 0),
      engagement: Number(postInsight.engagement || 0),
      comments: Number(postInsight.comments || 0),
      shares: Number(postInsight.shares || 0),
      state: postInsight.state === "ready" ? "ready" : "no_metrics",
    };
    if (matchesQuery([row.caption, row.pageName, row.platform, row.platformPostId], options.query)) {
      includedRemoteIds.add(remoteKey);
      rows.push(row);
    }
  });
  return rows
    .sort((a, b) => {
      const aDate = a.publishedAt ? new Date(a.publishedAt).getTime() : Number.POSITIVE_INFINITY;
      const bDate = b.publishedAt ? new Date(b.publishedAt).getTime() : Number.POSITIVE_INFINITY;
      if (aDate !== bDate) {
        return aDate - bDate;
      }
      return `${a.platform}-${a.id}`.localeCompare(`${b.platform}-${b.id}`);
    });
}

function sortAnalyticsPosts(rows: AnalyticsPostRow[], sort: AnalyticsPostSort): AnalyticsPostRow[] {
  return rows.slice().sort((left, right) => {
    if (sort === "date-desc" || sort === "date-asc") {
      return compareDates(left.publishedAt, right.publishedAt, sort === "date-desc")
        || compareText(left.pageName, right.pageName)
        || compareText(left.platform, right.platform);
    }
    if (sort === "views-desc" || sort === "views-asc") {
      return compareNumbers(left.views, right.views, sort === "views-desc") || compareDates(left.publishedAt, right.publishedAt, true);
    }
    if (sort === "reach-desc" || sort === "reach-asc") {
      return compareNumbers(left.reach, right.reach, sort === "reach-desc") || compareDates(left.publishedAt, right.publishedAt, true);
    }
    if (sort === "engagement-desc" || sort === "engagement-asc") {
      return compareNumbers(left.engagement, right.engagement, sort === "engagement-desc") || compareDates(left.publishedAt, right.publishedAt, true);
    }
    if (sort === "comments-desc" || sort === "comments-asc") {
      return compareNumbers(left.comments, right.comments, sort === "comments-desc") || compareDates(left.publishedAt, right.publishedAt, true);
    }
    return compareNumbers(left.shares, right.shares, sort === "shares-desc") || compareDates(left.publishedAt, right.publishedAt, true);
  });
}

function sortAnalyticsAccounts(
  accounts: AnalyticsAccountRecord[],
  sort: AnalyticsAccountSort,
  range: AnalyticsRange,
  customStart: string,
  customEnd: string,
): AnalyticsAccountRecord[] {
  return accounts.slice().sort((left, right) => {
    if (sort === "name-desc" || sort === "name-asc") {
      return compareText(left.account_name || left.page_name || left.platform, right.account_name || right.page_name || right.platform, sort === "name-desc");
    }
    const metric = sort.startsWith("engagement") ? "engagement" : sort.startsWith("followers") ? "followers" : "views";
    return compareNumbers(
      accountMetricValue(left, metric, range, customStart, customEnd),
      accountMetricValue(right, metric, range, customStart, customEnd),
      sort.endsWith("desc"),
    ) || compareText(left.account_name || left.page_name, right.account_name || right.page_name);
  });
}

function sortInsightDiagnostics(
  rows: Array<{ account: AnalyticsAccountRecord; insight: SocialInsightRecord }>,
  sort: DiagnosticSort,
): Array<{ account: AnalyticsAccountRecord; insight: SocialInsightRecord }> {
  return rows.slice().sort((left, right) => {
    if (sort === "checked-desc" || sort === "checked-asc") {
      return compareDates(
        left.insight.last_error_at || left.insight.refreshed_at,
        right.insight.last_error_at || right.insight.refreshed_at,
        sort === "checked-desc",
      );
    }
    if (sort === "account-asc") {
      return compareText(left.account.account_name || left.account.page_name, right.account.account_name || right.account.page_name);
    }
    if (sort === "metric-asc") {
      return compareText(left.insight.metric_name, right.insight.metric_name);
    }
    return compareText(left.insight.error_message ? "Error" : "Unavailable", right.insight.error_message ? "Error" : "Unavailable");
  });
}

function insightDate(insight: SocialInsightRecord): Date | null {
  const rawDate = insight.end_date || insight.start_date || insight.refreshed_at;
  if (!rawDate) {
    return null;
  }
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (insight.platform === "facebook" && insight.period === "day" && insight.end_date) {
    date.setDate(date.getDate() - 1);
  }
  return date;
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
  } else if (range === "60d") {
    start = new Date(now);
    start.setDate(now.getDate() - 60);
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
  downloadBlobFile(filename, blob);
}

function downloadBlobFile(filename: string, blob: Blob): void {
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
  onExportReport: () => Promise<void>;
  onRefreshInsights: (
    accountId?: number,
    onProgress?: (status: AnalyticsRefreshStatus) => void,
    options?: { range: AnalyticsRange; customStart?: string; customEnd?: string },
  ) => Promise<void>;
  onReloadData: () => Promise<void>;
}) {
  const [range, setRange] = useState<AnalyticsRange>("60d");
  const [customStart, setCustomStart] = useState(toDateKey(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)));
  const [customEnd, setCustomEnd] = useState(toDateKey(new Date()));
  const [platformFilter, setPlatformFilter] = useState<"all" | "facebook" | "instagram">("all");
  const [pageFilter, setPageFilter] = useState<number | "all">("all");
  const [metricFilter, setMetricFilter] = useState("views");
  const [accountSearch, setAccountSearch] = useState("");
  const [postRange, setPostRange] = useState<AnalyticsRange>("60d");
  const [postCustomStart, setPostCustomStart] = useState(toDateKey(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)));
  const [postCustomEnd, setPostCustomEnd] = useState(toDateKey(new Date()));
  const [postPlatformFilter, setPostPlatformFilter] = useState<"all" | "facebook" | "instagram">("all");
  const [postPageFilter, setPostPageFilter] = useState<number | "all">("all");
  const [postSearch, setPostSearch] = useState("");
  const [rawOpen, setRawOpen] = useState(false);
  const [view, setView] = useState<"overview" | "posts" | "accounts" | "diagnostics">("overview");
  const [postSort, setPostSort] = useState<AnalyticsPostSort>("date-desc");
  const [accountSort, setAccountSort] = useState<AnalyticsAccountSort>("views-desc");
  const [diagnosticSort, setDiagnosticSort] = useState<DiagnosticSort>("checked-desc");
  const [manualRefreshState, setManualRefreshState] = useState<"idle" | "refreshing" | "error" | "partial">("idle");
  const [manualRefreshMessage, setManualRefreshMessage] = useState("");
  const [reloadState, setReloadState] = useState<"idle" | "loading" | "error">("idle");
  const [exportState, setExportState] = useState<"idle" | "exporting" | "error">("idle");
  const reportPosts = useMemo(
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
  const filteredPosts = useMemo(
    () =>
      buildPostAnalyticsRows(props.workspace.posts, props.workspace.pages, props.accounts, props.analyticsPosts, {
        range: postRange,
        customStart: postCustomStart,
        customEnd: postCustomEnd,
        platform: postPlatformFilter,
        pageId: postPageFilter,
        query: [props.query, postSearch].filter(Boolean).join(" "),
      }),
    [props.workspace.posts, props.workspace.pages, props.accounts, props.analyticsPosts, postRange, postCustomStart, postCustomEnd, postPlatformFilter, postPageFilter, props.query, postSearch],
  );
  const filteredAccounts = props.accounts.filter((account) => {
    const platformMatches = platformFilter === "all" || account.platform === platformFilter;
    const pageMatches = pageFilter === "all" || account.page_id === pageFilter;
    const searchMatches = matchesQuery(
      [account.account_name, account.page_name, account.platform],
      [props.query, accountSearch].filter(Boolean).join(" "),
    );
    return platformMatches && pageMatches && searchMatches;
  });
  const visibleAccounts = sortAnalyticsAccounts(filteredAccounts, accountSort, range, customStart, customEnd);
  const sortedFilteredPosts = sortAnalyticsPosts(filteredPosts, postSort);
  const trendSeries = buildMetricTimeSeries(visibleAccounts, metricFilter, range, customStart, customEnd);
  const platformComparison = buildPlatformMetricComparison(visibleAccounts, metricFilter, range, customStart, customEnd);
  const accountComparison = buildAccountComparison(visibleAccounts, metricFilter, range, customStart, customEnd);
  const selectedMetricTotal = visibleAccounts.reduce((sum, account) => sum + accountMetricValue(account, metricFilter, range, customStart, customEnd), 0);
  const totalViews = visibleAccounts.reduce((sum, account) => sum + accountMetricValue(account, "views", range, customStart, customEnd), 0);
  const totalEngagement = visibleAccounts.reduce((sum, account) => sum + accountMetricValue(account, "engagement", range, customStart, customEnd), 0);
  const totalFollowers = visibleAccounts.reduce((sum, account) => sum + accountMetricValue(account, "followers", range, customStart, customEnd), 0);
  const lastRefreshed = latestAnalyticsRefresh(props.accounts);
  const nextRefresh = analyticsNextRefresh(props.workspace);
  const refreshStatus = manualRefreshState === "refreshing"
    ? "refreshing"
    : manualRefreshState === "partial"
      ? "still running"
    : props.loading || reloadState === "loading"
      ? "loading data"
    : manualRefreshState === "error"
      ? "error"
      : visibleAccounts.some((account) => account.last_error)
        ? "partial success"
        : "idle";
  const visibleDiagnostics = sortInsightDiagnostics(insightDiagnostics(visibleAccounts), diagnosticSort);
  const rawInsightRows = visibleAccounts.flatMap((account) =>
    filterInsightsByRange(accountInsightsForDisplay(account), range, customStart, customEnd)
      .map((insight) => ({ account, insight })),
  );
  useEffect(() => {
    setPostPageFilter((current) => current === "all" || props.workspace.pages.some((page) => page.id === current) ? current : "all");
  }, [props.workspace.pages]);

  async function handleManualRefresh(accountId?: number): Promise<void> {
    setManualRefreshState("refreshing");
    setReloadState("idle");
    setManualRefreshMessage("Analytics refresh requested.");
    try {
      await props.onRefreshInsights(accountId, (status) => {
        const progress = status.progress_total
          ? ` (${status.progress_current}/${status.progress_total})`
          : "";
        setManualRefreshMessage(`${status.message || "Analytics refresh is running."}${progress}`);
      }, { range, customStart, customEnd });
      setManualRefreshState("idle");
      setManualRefreshMessage("Analytics refresh finished. Showing saved database data.");
      window.setTimeout(() => {
        setManualRefreshMessage((current) =>
          current === "Analytics refresh finished. Showing saved database data." ? "" : current,
        );
      }, 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analytics refresh failed. Check diagnostics below.";
      if (message.toLowerCase().includes("still running")) {
        setManualRefreshState("partial");
        setManualRefreshMessage(message);
        return;
      }
      setManualRefreshState("error");
      setManualRefreshMessage(message);
    }
  }

  async function handleReloadData(): Promise<void> {
    setReloadState("loading");
    setManualRefreshState("idle");
    setManualRefreshMessage("Reloading saved analytics data from the database.");
    try {
      await props.onReloadData();
      setReloadState("idle");
      setManualRefreshMessage("Saved analytics data reloaded from the database.");
      window.setTimeout(() => {
        setManualRefreshMessage((current) =>
          current === "Saved analytics data reloaded from the database." ? "" : current,
        );
      }, 3500);
    } catch (error) {
      setReloadState("error");
      setManualRefreshMessage(error instanceof Error ? error.message : "Unable to reload saved analytics data.");
    }
  }

  async function handleExportReport(): Promise<void> {
    setExportState("exporting");
    setManualRefreshState("idle");
    setReloadState("idle");
    setManualRefreshMessage("Updating the Google report.");
    try {
      await props.onExportReport();
      setExportState("idle");
      setManualRefreshMessage("Google report updated.");
      window.setTimeout(() => {
        setManualRefreshMessage((current) => current === "Google report updated." ? "" : current);
      }, 3500);
    } catch (error) {
      setExportState("error");
      setManualRefreshState("error");
      setManualRefreshMessage(error instanceof Error ? error.message : "Unable to export the report.");
    }
  }

  return (
    <div className="page-stack analytics-dashboard">
      <PageHeader
        actions={
          <>
            <Button disabled={manualRefreshState === "refreshing" || props.loading} icon="refresh" onClick={() => void handleManualRefresh()}>
              {manualRefreshState === "refreshing" ? "Refreshing..." : "Refresh insights"}
            </Button>
            <Button disabled={reloadState === "loading" || props.loading} icon="refresh" onClick={() => void handleReloadData()} variant="secondary">
              {reloadState === "loading" ? "Reloading..." : "Reload data"}
            </Button>
            <Button onClick={() => setRawOpen(true)}>
              Raw data
            </Button>
            <Button
              disabled={exportState === "exporting"}
              onClick={() => void handleExportReport()}
              variant="primary"
            >
              {exportState === "exporting" ? "Exporting..." : "Export report"}
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

      {manualRefreshMessage ? (
        <div
          className={`system-alert ${manualRefreshState === "error" || reloadState === "error" ? "system-alert-error" : ""}`}
          role="status"
        >
          <Badge tone={manualRefreshState === "error" || reloadState === "error" ? "bad" : manualRefreshState === "refreshing" || manualRefreshState === "partial" || reloadState === "loading" ? "info" : "good"}>
            {manualRefreshState === "refreshing" || manualRefreshState === "partial" ? "Analytics refresh" : reloadState === "loading" ? "Database reload" : "Status"}
          </Badge>
          <strong>{manualRefreshMessage}</strong>
        </div>
      ) : null}

      <SectionTabs
        items={[
          { value: "overview", label: "Overview", detail: "Filters, KPIs, and trend charts", count: visibleAccounts.length },
          { value: "posts", label: "Posts", detail: "Post-level performance", count: filteredPosts.length },
          { value: "accounts", label: "Accounts", detail: "Account snapshots", count: visibleAccounts.length },
          { value: "diagnostics", label: "Diagnostics", detail: "Unavailable or errored metrics", count: visibleDiagnostics.length },
        ]}
        onChange={setView}
        value={view}
      />

      {view === "overview" ? (
        <>
      <div className="analytics-report-builder">
        <Card className="analytics-filter-card" title="Report filters">
          <div className="analytics-filter-grid">
            <Field label="Date range">
              <select onChange={(event) => setRange(event.target.value as AnalyticsRange)} value={range}>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="60d">60 days</option>
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
          <StatCard helper="Selected date range" label="Content interactions" value={formatCompactNumber(totalEngagement)} />
          <StatCard helper="Latest available follower counts" label="Followers" value={formatCompactNumber(totalFollowers)} />
          <StatCard helper="Facebook and Instagram accounts in scope" label="Accounts" value={formatCompactNumber(visibleAccounts.length)} />
          <StatCard helper="Posts matching the report filters" label="Posts" value={formatCompactNumber(reportPosts.length)} />
          <StatCard helper="Accounts with warnings or missing setup" label="Needs attention" tone={visibleAccounts.some((account) => account.last_error || !account.ready) ? "warn" : "good"} value={String(visibleAccounts.filter((account) => account.last_error || !account.ready).length)} />
        </section>
      </div>

      <div className="analytics-main-grid">
        <Card description={`${formatMetricName(metricFilter)} by day for the active filter set.`} title="Primary trend">
          <MetricAreaChart data={trendSeries} label={formatMetricName(metricFilter)} totalValue={selectedMetricTotal} />
        </Card>
        <Card description="Filtered Facebook vs Instagram comparison." title="Platform comparison">
          <MetricBarChart items={platformComparison} />
        </Card>
        <Card description="Top accounts for the selected metric." title="Account comparison">
          <MetricBarChart items={accountComparison} />
        </Card>
      </div>
        </>
      ) : null}

      {view === "posts" ? (
        <>
      <Card className="analytics-filter-card" title="Post filters">
        <div className="analytics-filter-grid">
          <Field label="Date range">
            <select onChange={(event) => setPostRange(event.target.value as AnalyticsRange)} value={postRange}>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="60d">60 days</option>
              <option value="month">This month</option>
              <option value="all">All time</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          <Field label="Page/client">
            <select onChange={(event) => setPostPageFilter(event.target.value === "all" ? "all" : Number(event.target.value))} value={String(postPageFilter)}>
              <option value="all">All clients</option>
              {props.workspace.pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
            </select>
          </Field>
          <Field label="Platform">
            <select onChange={(event) => setPostPlatformFilter(event.target.value as "all" | "facebook" | "instagram")} value={postPlatformFilter}>
              <option value="all">All platforms</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
            </select>
          </Field>
          <Field label="Post search">
            <input onChange={(event) => setPostSearch(event.target.value)} placeholder="Search caption or page" value={postSearch} />
          </Field>
        </div>
        {postRange === "custom" ? (
          <div className="inline-actions analytics-date-range">
            <label><span>From</span><input onChange={(event) => setPostCustomStart(event.target.value)} type="date" value={postCustomStart} /></label>
            <label><span>To</span><input onChange={(event) => setPostCustomEnd(event.target.value)} type="date" value={postCustomEnd} /></label>
          </div>
        ) : null}
      </Card>

      <Card
        actions={
          <>
            <SortControl onChange={setPostSort} options={ANALYTICS_POST_SORT_OPTIONS} value={postSort} />
            <Badge tone="info">{filteredPosts.length} posts</Badge>
          </>
        }
        title="Posts"
      >
        <AnalyticsPostGrid rows={sortedFilteredPosts} />
      </Card>
        </>
      ) : null}

      {view === "accounts" ? (
        <div className="focus-grid">
          <Card
            actions={<SortControl onChange={setAccountSort} options={ANALYTICS_ACCOUNT_SORT_OPTIONS} value={accountSort} />}
            title="Account snapshots"
          >
            <div className="analytics-account-table">
              {visibleAccounts.length ? (
                <ResponsiveTable
                  columns={[
                    {
                      key: "account",
                      label: "Account",
                      render: (account) => (
                        <span className="account-title-cell">
                          <strong>{account.account_name || account.page_name || formatMetricName(account.platform)}</strong>
                          <small>{account.page_name || "Unassigned page"}</small>
                        </span>
                      ),
                    },
                    {
                      key: "platform",
                      label: "Platform",
                      render: (account) => <Badge tone={account.platform === "instagram" ? "good" : "info"}>{formatMetricName(account.platform)}</Badge>,
                    },
                    {
                      key: "views",
                      label: "Views",
                      render: (account) => <strong className="metric-number">{formatCompactNumber(accountMetricValue(account, "views", range, customStart, customEnd))}</strong>,
                    },
                    {
                      key: "engagement",
                      label: "Interactions",
                      render: (account) => <strong className="metric-number">{formatCompactNumber(accountMetricValue(account, "engagement", range, customStart, customEnd))}</strong>,
                    },
                    {
                      key: "followers",
                      label: "Followers",
                      render: (account) => <strong className="metric-number">{formatCompactNumber(accountMetricValue(account, "followers", range, customStart, customEnd))}</strong>,
                    },
                    {
                      key: "state",
                      label: "State",
                      render: (account) => (
                        <Badge tone={account.last_error || !account.ready ? "warn" : "good"}>
                          {account.last_error || !account.ready ? "Check" : "Ready"}
                        </Badge>
                      ),
                    },
                    {
                      key: "action",
                      label: "",
                      render: (account) => (
                        <Button disabled={manualRefreshState === "refreshing"} onClick={() => void handleManualRefresh(account.id)}>
                          Refresh
                        </Button>
                      ),
                    },
                  ]}
                  getKey={(account) => account.id}
                  items={visibleAccounts}
                />
              ) : (
                <EmptyState
                  description="No accounts match the active page, platform, and search filters."
                  title="No matching accounts"
                />
              )}
            </div>
          </Card>
          <Card description="Top accounts for the currently selected metric." title="Metric ranking">
            <MetricBarChart items={accountComparison} />
          </Card>
        </div>
      ) : null}

      {view === "diagnostics" ? (
      <Card
        actions={<SortControl onChange={setDiagnosticSort} options={DIAGNOSTIC_SORT_OPTIONS} value={diagnosticSort} />}
        description="Meta metrics that returned errors, no values, or unavailable responses during refresh. These are shown separately so report totals stay clean."
        title="Insight diagnostics"
      >
        {visibleDiagnostics.length ? (
          <InsightDiagnosticsTable rows={visibleDiagnostics.slice(0, 50)} />
        ) : (
          <EmptyState
            description="No Facebook or Instagram insight errors are saved for the active report filters."
            title="No diagnostics"
          />
        )}
      </Card>
      ) : null}

      <Modal
        description="Raw insight rows for the active report filters."
        footer={
          <>
            <Button disabled={!rawInsightRows.length} onClick={() => exportInsightsAsCsv("mss-raw-insights.csv", rawInsightRows)} variant="primary">
              Export filtered raw CSV
            </Button>
            <Button onClick={() => setRawOpen(false)} variant="secondary">
              Close
            </Button>
          </>
        }
        onClose={() => setRawOpen(false)}
        open={rawOpen}
        title="Raw data"
      >
        <div className="raw-data-panel">
          <InsightRowsTable rows={rawInsightRows.slice(0, 150)} />
        </div>
      </Modal>
    </div>
  );
}

function AnalyticsPostGrid(props: { rows: AnalyticsPostRow[] }) {
  if (!props.rows.length) {
    return (
      <EmptyState
        description="No Facebook or Instagram posts match the selected page, platform, and date range."
        title="No posts"
      />
    );
  }

  return (
    <div className="analytics-post-grid">
      {props.rows.map((row) => (
        <article className="analytics-post-card" key={row.id}>
          <div className="analytics-post-media">
            <LazyImage
              alt={row.caption || row.pageName || "Post media"}
              fallback={<span className="post-thumb-placeholder" />}
              src={row.thumbnail}
            />
          </div>
          <div className="analytics-post-body">
            <div className="analytics-post-topline">
              <Badge tone={row.platform === "instagram" ? "good" : "info"}>{formatMetricName(row.platform)}</Badge>
              <span>{row.publishedAt ? formatDateOnly(row.publishedAt) : "No date"}</span>
            </div>
            <h3>{row.caption.slice(0, 140) || "No caption saved."}</h3>
            <p>{row.pageName}</p>
            <div className="analytics-post-metrics">
              <span><strong>{formatCompactNumber(row.views)}</strong><small>Views</small></span>
              <span><strong>{formatCompactNumber(row.reach)}</strong><small>Reach</small></span>
              <span><strong>{formatCompactNumber(row.engagement)}</strong><small>Interactions</small></span>
              <span><strong>{formatCompactNumber(row.comments)}</strong><small>Comments</small></span>
              <span><strong>{formatCompactNumber(row.shares)}</strong><small>Shares</small></span>
            </div>
            <div className="analytics-post-footer">
              <Badge tone={row.state === "ready" ? "good" : row.state === "no_metrics" ? "warn" : "bad"}>
                {row.state === "ready" ? "Metrics ready" : row.state === "no_metrics" ? "No metrics yet" : "Missing post ID"}
              </Badge>
              {row.permalink ? <a href={row.permalink} rel="noreferrer" target="_blank">Open post</a> : <span>No permalink</span>}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function ActivityPage(props: {
  workspace: WorkspaceData;
  planning: PlanningPagePayload | null;
  query: string;
}) {
  const [viewFilter, setViewFilter] = useState<"all" | "failed" | "manual" | "scheduled" | "planner">("all");
  const [activitySort, setActivitySort] = useState<ActivitySort>("date-desc");
  const allEntries = [
    ...props.workspace.posts.map((post) => ({
      id: `post-${post.id}`,
      title: `Post #${post.id} ${post.status}`,
      detail: post.content || "No post content saved.",
      time: formatDateTime(post.posted_at || post.scheduled_time || post.created_at),
      sortAt: dateSortValue(post.posted_at || post.scheduled_time || post.created_at),
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
        title: `Draft ${status.label}`,
        detail: row.theme || row.post_copy || "Draft updated.",
        time: formatDateTime(row.updated_at),
        sortAt: dateSortValue(row.updated_at),
        actor: row.designer || props.planning?.page.name || "Planner",
        tone: status.tone,
        kind: "planner" as const,
        status: status.label,
        manual: false,
      };
    }) || []),
  ];
  const entries = sortActivityEntries(
    allEntries.filter((item) => {
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
      .filter((item) => matchesQuery([item.title, item.detail, item.actor], props.query)),
    activitySort,
  ).slice(0, 20);
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
        eyebrow="Workspace history"
        title="Activity"
      />
      <div className="activity-layout">
        <Card
          actions={<SortControl onChange={setActivitySort} options={ACTIVITY_SORT_OPTIONS} value={activitySort} />}
          title="Recent activity"
        >
          {entries.length ? <ActivityFeed items={entries} /> : <EmptyState description="No activity matches your search." title="No activity found" />}
        </Card>
        <Card title="Audit views">
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
  const [notificationSort, setNotificationSort] = useState<NotificationSort>("priority-desc");
  const items = sortNotifications(
    props.notifications.filter((item) =>
      matchesQuery([item.title, item.detail, item.priority], props.query),
    ),
    notificationSort,
  );

  return (
    <div className="page-stack">
      <PageHeader
        actions={<Button onClick={props.onDismissAll} variant="primary">Mark all handled</Button>}
        eyebrow="Inbox"
        meta={<Badge tone={items.length ? "bad" : "good"}>{items.length} active</Badge>}
        title="Notifications"
      />
      <div className="notification-layout">
        <Card
          actions={<SortControl onChange={setNotificationSort} options={NOTIFICATION_SORT_OPTIONS} value={notificationSort} />}
          title="Priority inbox"
        >
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
        <Card title="Alert sources">
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
  const [view, setView] = useState<"workspace" | "appearance" | "automation" | "tokens" | "team" | "integrations">("workspace");
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
        <>
        <section className="settings-summary-strip" aria-label="Settings summary">
          <div>
            <span>Resolved theme</span>
            <strong>{props.theme}</strong>
          </div>
          <div>
            <span>Team members</span>
            <strong>{props.users.length}</strong>
          </div>
          <div>
            <span>Meta token</span>
            <strong>{draft.meta_global?.configured ? "Configured" : "Missing"}</strong>
          </div>
          <div>
            <span>Live posting</span>
            <strong>{draft.live_posting_enabled === "true" ? "Enabled" : "Disabled"}</strong>
          </div>
        </section>

        <SectionTabs
          items={[
            { value: "workspace", label: "Workspace", detail: "Name, timezone, routing" },
            { value: "appearance", label: "Appearance", detail: "Themes and visual mode" },
            { value: "automation", label: "Automation", detail: "Scheduler and posting flags" },
            { value: "tokens", label: "Tokens", detail: "Meta and platform credentials" },
            { value: "team", label: "Team", detail: "Users and roles", count: props.users.length },
            { value: "integrations", label: "Integrations", detail: "Connection health" },
          ]}
          onChange={setView}
          value={view}
        />

        <div className="settings-layout">
          {view === "workspace" ? (
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
          ) : null}

          {view === "appearance" ? (
          <Card description="Theme preference is saved on this browser and applied immediately." title="Appearance">
            <div className="theme-option-grid" role="radiogroup" aria-label="Theme preference">
              {[
                {
                  value: "system",
                  title: "System",
                  description: "Follow this device's light or dark mode.",
                  swatches: ["#fffdfd", "#10141d", "#dc5a72", "#6ea8fe"],
                },
                {
                  value: "light",
                  title: "Light",
                  description: "Soft white workspace with muted red controls.",
                  swatches: ["#fffdfd", "#f4eef1", "#dc5a72", "#8f3349"],
                },
                {
                  value: "dark",
                  title: "Dark",
                  description: "Charcoal command center with vivid accents.",
                  swatches: ["#080b10", "#151c28", "#6ea8fe", "#ff477e"],
                },
                {
                  value: "dark-gold",
                  title: "Dark gold",
                  description: "Black and gold interface with selective red.",
                  swatches: ["#070604", "#18130b", "#d8b45a", "#bd1326"],
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
          ) : null}

          {view === "automation" ? (
          <Card description="Automation flags saved in app settings." title="Automation">
            <div className="form-stack">
              <Toggle
                checked={draft.auto_schedule === "true"}
                description="Let the scheduler queue ready post drafts."
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
          ) : null}

          {view === "tokens" ? (
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
          ) : null}

          {view === "team" ? (
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
          ) : null}

          {view === "integrations" ? (
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
          ) : null}
        </div>
        </>
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
      label: "Create post",
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
    { title: "Plan calendar", detail: "Create posts and review upcoming work", action: () => props.onSectionOpen("planner") },
    { title: "Recover failure", detail: "Find failed posts and retry after fixing the cause", action: () => props.onSectionOpen("notifications") },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Guidance"
        actions={<Button onClick={props.onContactSupport} variant="primary">Contact support</Button>}
        title="Help"
      />
      <div className="help-grid">
        <Card title="Guides">
          <div className="saved-view-list">
            {guideActions.map((guide) => (
              <button key={guide.label} onClick={guide.action} type="button">
                <span>{guide.label}</span>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
        </Card>
        <Card title="Onboarding checklist">
          <div className="checklist">
            {[
              ["Create a client page", hasPages],
              ["Connect at least one account", hasAccounts],
              ["Import or create post drafts", hasPlanner],
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
        <Card title="Common workflows">
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
        <Card title="System status">
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

function LazyImage(props: {
  src: string | null;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const resolvedSrc = props.src ? normalizeMediaSrc(props.src) : null;
  const [shouldLoad, setShouldLoad] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => {
    setShouldLoad(false);
    setFailedSrc(null);
  }, [resolvedSrc]);

  useEffect(() => {
    if (!resolvedSrc || failedSrc === resolvedSrc) {
      return;
    }
    const node = imageRef.current;
    if (!node || !("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [failedSrc, resolvedSrc]);

  if (!resolvedSrc || failedSrc === resolvedSrc) {
    return <>{props.fallback || <span className="post-thumb-placeholder" />}</>;
  }

  return (
    <img
      alt={props.alt}
      className={props.className}
      decoding="async"
      loading="lazy"
      onError={() => setFailedSrc(resolvedSrc)}
      ref={imageRef}
      src={shouldLoad ? resolvedSrc : undefined}
    />
  );
}

function MediaThumb(props: { src: string | null; alt: string; size?: "normal" | "large" }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const resolvedSrc = props.src ? normalizeMediaSrc(props.src) : null;
  useEffect(() => {
    setFailedSrc(null);
  }, [resolvedSrc]);
  const imageSrc = resolvedSrc && failedSrc !== resolvedSrc ? resolvedSrc : LOGO_SRC;
  return (
    <div className={props.size === "large" ? "media-thumb media-thumb-large" : "media-thumb"}>
      <img
        alt={resolvedSrc && failedSrc !== resolvedSrc ? props.alt : "MSS logo"}
        decoding="async"
        loading="lazy"
        onError={() => {
          if (resolvedSrc) {
            setFailedSrc(resolvedSrc);
          }
        }}
        src={imageSrc}
      />
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

function PlannerDraftRow(props: {
  row: PlanningRowRecord;
  status: { label: string; tone: "neutral" | "good" | "warn" | "bad" | "info" };
  canManagePlanning: boolean;
  onDuplicateRow: (row: PlanningRowRecord) => Promise<void>;
  onPublishRow: (row: PlanningRowRecord) => Promise<void>;
  onSchedule: (row: PlanningRowRecord) => Promise<void>;
}) {
  const mediaUrl = firstPlanningRowMedia(props.row);
  const dateLabel = parseRowDate(props.row) || "No date";
  const timeLabel = props.row.time_value || "No time";

  return (
    <article className="planner-row planner-draft-row">
      <div className="planner-time">
        <span>Draft {props.row.row_order}</span>
        <small>{dateLabel}</small>
        <small>{timeLabel}</small>
      </div>
      <div className="planner-content">
        <div className="planner-event-title">
          <MediaThumb alt={props.row.theme || "Draft media"} src={mediaUrl} />
          <div>
            <strong>{props.row.theme || props.row.job_nr || "Untitled draft"}</strong>
            <span>{props.row.post_copy || "No post copy saved yet."}</span>
          </div>
        </div>
        <div className="chip-row">
          <span className="chip">{props.row.linked_accounts || "No accounts"}</span>
          {props.row.creative_media_count ? <span className="chip">{props.row.creative_media_count} media</span> : null}
          {props.row.designer ? <span className="chip">{props.row.designer}</span> : null}
        </div>
      </div>
      <div className="planner-row-actions">
        <Badge tone={props.status.tone}>{props.status.label}</Badge>
        {props.canManagePlanning ? (
          <>
            <Button onClick={() => props.onPublishRow(props.row)} variant="primary">
              Publish
            </Button>
            <Button onClick={() => props.onSchedule(props.row)} variant="ghost">
              Schedule
            </Button>
            <Button onClick={() => props.onDuplicateRow(props.row)} variant="ghost">
              Duplicate
            </Button>
          </>
        ) : null}
      </div>
    </article>
  );
}

function PlannerEventActions(props: {
  event: PlannerEvent;
  canManagePlanning: boolean;
  onPreview: (event: PlannerEvent) => void;
  onDuplicateRow: (row: PlanningRowRecord) => Promise<void>;
  onPublishRow: (row: PlanningRowRecord) => Promise<void>;
  onDeletePost: (post: PostRecord) => Promise<void>;
  onManualOpen: (post: PostRecord) => void;
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
      {props.canManagePlanning && event.row && !event.row.scheduled_post_id && !event.row.is_non_actionable ? (
        <>
          <Button onClick={() => props.onPublishRow(event.row as PlanningRowRecord)} variant="primary">
            Publish
          </Button>
          <Button onClick={() => props.onSchedule(event.row as PlanningRowRecord)} variant="ghost">
            Schedule
          </Button>
        </>
      ) : null}
      {props.canManagePlanning && event.row ? (
        <Button onClick={() => props.onDuplicateRow(event.row as PlanningRowRecord)} variant="ghost">
          Duplicate
        </Button>
      ) : null}
      {props.canManagePlanning && isManualPending && event.post ? (
        <Button onClick={() => props.onManualOpen(event.post as PostRecord)} variant="ghost">
          LinkedIn
        </Button>
      ) : null}
      {props.canManagePlanning && isFailed && event.post ? (
        <>
          <Button onClick={() => props.onPreview(event)} variant="ghost">
            View error
          </Button>
          <Button onClick={() => props.onRetryPost(event.post as PostRecord)} variant="ghost">
            Retry
          </Button>
        </>
      ) : null}
      {props.canManagePlanning && event.post ? (
        <Button onClick={() => props.onDeletePost(event.post as PostRecord)} variant="danger">
          Delete
        </Button>
      ) : null}
    </div>
  );
}

function CalendarGrid(props: {
  canManagePlanning: boolean;
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
            aria-label={props.canManagePlanning ? `Create post on ${key}` : `Posts on ${key}`}
            className={[
              outside ? "calendar-cell calendar-cell-muted" : "calendar-cell",
              props.canManagePlanning && props.draggingEventId ? "calendar-cell-drop-target" : "",
            ].filter(Boolean).join(" ")}
            key={key}
            onClick={props.canManagePlanning ? () => props.onCreatePost(key) : undefined}
            onDragOver={(event) => {
              if (props.canManagePlanning && props.draggingEventId) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              if (!props.canManagePlanning) {
                return;
              }
              event.preventDefault();
              const eventId = event.dataTransfer.getData("text/plain");
              const dragged = props.events.find((item) => item.id === eventId);
              if (dragged) {
                void props.onEventDrop(dragged, key);
              }
            }}
            onKeyDown={(event) => {
              if (props.canManagePlanning && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                props.onCreatePost(key);
              }
            }}
            role={props.canManagePlanning ? "button" : undefined}
            tabIndex={props.canManagePlanning ? 0 : undefined}
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
                  draggable={props.canManagePlanning}
                  key={event.id}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                  }}
                  onDragEnd={props.onEventDragEnd}
                  onDragStart={(dragEvent) => {
                    if (!props.canManagePlanning) {
                      dragEvent.preventDefault();
                      return;
                    }
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

function ChartMetaBar(props: { data: TimeSeriesPoint[]; totalValue?: number }) {
  const meta = seriesMeta(props.data);
  return (
    <div className="chart-meta-bar">
      <span>{compactDateRange(meta.start, meta.end)}</span>
      <span>Total: {formatCompactNumber(props.totalValue ?? meta.total)}</span>
      <span>{meta.days} day{meta.days === 1 ? "" : "s"}</span>
    </div>
  );
}

function MetricLineChart(props: { data: TimeSeriesPoint[]; label: string; tone?: "neutral" | "good" | "warn" | "bad" | "info"; totalValue?: number }) {
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
      <ChartMetaBar data={data} totalValue={props.totalValue} />
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

function MetricAreaChart(props: { data: TimeSeriesPoint[]; label: string; tone?: "neutral" | "good" | "warn" | "bad" | "info"; totalValue?: number }) {
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
      <ChartMetaBar data={data} totalValue={props.totalValue} />
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

function InsightDiagnosticsTable(props: {
  rows: Array<{ account: AnalyticsAccountRecord; insight: SocialInsightRecord }>;
}) {
  const rows = Array.isArray(props.rows) ? props.rows : [];
  if (!rows.length) {
    return <EmptyState description="No diagnostic rows are saved for this filter." title="No diagnostics" />;
  }
  return (
    <ResponsiveTable
      columns={[
        {
          key: "account",
          label: "Account",
          render: (row) => <strong>{row.account.account_name || row.account.page_name || "Instagram account"}</strong>,
        },
        {
          key: "metric",
          label: "Metric",
          render: (row) => (
            <span>
              {formatMetricName(row.insight.metric_name)}
              <small className="table-subtext">{diagnosticRawMetric(row.insight)}</small>
            </span>
          ),
        },
        {
          key: "date",
          label: "Last checked",
          render: (row) => formatDateTime(row.insight.last_error_at || row.insight.refreshed_at),
        },
        {
          key: "state",
          label: "State",
          render: (row) => (
            <Badge tone={row.insight.error_message ? "bad" : "warn"}>
              {row.insight.error_message ? "Error" : "Unavailable"}
            </Badge>
          ),
        },
        {
          key: "message",
          label: "Message",
          render: (row) => diagnosticMessage(row.insight),
        },
      ]}
      getKey={(row) => `${row.account.id}-${row.insight.id}`}
      items={rows}
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

function LinkedInManualModal(props: {
  open: boolean;
  post: PostRecord | null;
  onClose: () => void;
  onComplete: (post: PostRecord) => Promise<void>;
}) {
  const post = props.post;
  const manual = post?.linkedin_manual;
  const mediaItems = manual?.media_items || [];
  const copy = post?.content || "";

  return (
    <Modal
      className="linkedin-manual-modal"
      description="Use this to manually complete LinkedIn while the rest of the post is handled by the scheduler."
      footer={
        <>
          <Button onClick={props.onClose} variant="secondary">Close</Button>
          <Button
            disabled={!post}
            onClick={() => {
              if (post) {
                void props.onComplete(post);
              }
            }}
            variant="primary"
          >
            Mark LinkedIn posted
          </Button>
        </>
      }
      onClose={props.onClose}
      open={props.open}
      title="LinkedIn manual post"
    >
      {!post ? null : (
        <div className="linkedin-manual-panel">
          <div className="linkedin-manual-schedule-meta">
            <div>
              <p className="detail-label">Client</p>
              <strong>{post.page_name || "Selected page"}</strong>
            </div>
            <div>
              <p className="detail-label">LinkedIn page</p>
              {manual?.page_url ? (
                <a href={manual.page_url} rel="noreferrer" target="_blank">{manual.page_url}</a>
              ) : (
                <span className="muted">No LinkedIn page URL saved.</span>
              )}
            </div>
          </div>

          <div className="linkedin-manual-copy">
            <div className="inline-actions">
              <strong>Post copy</strong>
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText(copy);
                }}
                variant="ghost"
              >
                Copy text
              </Button>
            </div>
            <pre>{copy || "No post copy saved."}</pre>
          </div>

          <div className="linkedin-manual-assets">
            {mediaItems.length ? mediaItems.map((item) => {
              const src = normalizeMediaSrc(item.url);
              return (
                <article className="linkedin-manual-asset" key={item.path}>
                  {item.is_video ? (
                    <video className="linkedin-manual-preview" controls src={src} />
                  ) : (
                    <img alt={item.name} className="linkedin-manual-preview" src={src} />
                  )}
                  <div className="linkedin-manual-asset-meta">
                    <p className="linkedin-manual-name">{item.name}</p>
                    <a href={src} rel="noreferrer" target="_blank">Open media</a>
                  </div>
                </article>
              );
            }) : (
              <div className="linkedin-manual-empty">No media attached.</div>
            )}
          </div>
        </div>
      )}
    </Modal>
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
  onSubmit: (payload: Record<string, unknown>, mediaFiles: File[]) => Promise<void>;
}) {
  const [dateValue, setDateValue] = useState(props.defaultDate);
  const [timeValue, setTimeValue] = useState("");
  const [jobNr, setJobNr] = useState("");
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState("");
  const [link, setLink] = useState("");
  const [designer, setDesigner] = useState("");
  const [copy, setCopy] = useState("");
  const [mediaItems, setMediaItems] = useState<ComposerMediaItem[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [cropTargetId, setCropTargetId] = useState<string | null>(null);
  const [cropConfig, setCropConfig] = useState<CropConfig>({
    targetRatio: 1,
    offsetX: 50,
    offsetY: 50,
    zoom: 1,
  });
  const [cropApplying, setCropApplying] = useState(false);
  const mediaItemsRef = useRef(mediaItems);
  const cropTarget = mediaItems.find((item) => item.id === cropTargetId) || null;
  const blockingCropCount = mediaItems.filter((item) => item.cropNeeded).length;
  const pendingMediaCount = mediaItems.filter((item) => item.processing).length;
  const selectedPreviewItem = cropTarget || mediaItems[0] || null;

  useEffect(() => {
    mediaItemsRef.current = mediaItems;
  }, [mediaItems]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setDateValue(props.defaultDate);
    setTimeValue("");
    setJobNr("");
    setTitle("");
    setFormat("");
    setLink("");
    setDesigner("");
    setCopy("");
    setComposerError(null);
    setCropTargetId(null);
    setCropApplying(false);
    setMediaItems((current) => {
      current.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      return [];
    });
  }, [props.open, props.defaultDate]);

  useEffect(() => () => {
    mediaItemsRef.current.forEach((item) => {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
  }, []);

  async function addMediaFiles(files: File[]): Promise<void> {
    if (!files.length) {
      return;
    }
    setMediaBusy(true);
    setComposerError(null);
    try {
      for (const file of files) {
        const id = `${file.name}-${file.lastModified}-${crypto.randomUUID()}`;
        setMediaItems((current) => [
          ...current,
          {
            id,
            file,
            previewUrl: null,
            kind: file.type.startsWith("image/") ? "image" : "video",
            width: null,
            height: null,
            ratio: null,
            cropNeeded: false,
            processing: true,
            error: null,
          },
        ]);
        try {
          const prepared = await prepareComposerMediaItem(file, id);
          setMediaItems((current) => current.map((item) => (item.id === id ? prepared : item)));
        } catch (error) {
          setMediaItems((current) =>
            current.map((item) =>
              item.id === id
                ? {
                    ...item,
                    processing: false,
                    error: error instanceof Error ? error.message : "Could not inspect this media file.",
                  }
                : item,
            ),
          );
        }
      }
    } finally {
      setMediaBusy(false);
    }
  }

  function moveMedia(index: number, delta: -1 | 1): void {
    setMediaItems((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) {
        return current;
      }
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeMedia(id: string): void {
    setMediaItems((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      if (cropTargetId === id) {
        setCropTargetId(null);
      }
      return current.filter((item) => item.id !== id);
    });
  }

  return (
    <Modal
      className="post-composer-modal"
      footer={
        <>
          <Button onClick={props.onClose} variant="secondary">Cancel</Button>
          <Button
            disabled={!props.page || mediaBusy || cropApplying || pendingMediaCount > 0 || blockingCropCount > 0}
            form="create-row-form"
            type="submit"
            variant="primary"
          >
            Save draft
          </Button>
        </>
      }
      onClose={props.onClose}
      open={props.open}
      title="Create post"
    >
      <form
        className="post-composer"
        id="create-row-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (pendingMediaCount > 0 || mediaBusy) {
            setComposerError("Wait for media previews to finish processing before saving.");
            return;
          }
          if (blockingCropCount > 0) {
            setComposerError("Crop the images marked Crop image before saving this draft.");
            return;
          }
          setComposerError(null);
          void props.onSubmit({
            planning_month: dateValue.slice(0, 7) || props.defaultMonth,
            date_value: dateValue,
            time_value: timeValue,
            job_nr: jobNr,
            theme: title,
            post_copy: copy,
            link,
            format,
            final_creative: "",
            designer,
          }, mediaItems.map((item) => item.file));
        }}
      >
        <section className="post-composer-preview" aria-label="Post preview">
          {cropTarget ? (
            <CropDashboard
              applying={cropApplying}
              config={cropConfig}
              item={cropTarget}
              onApply={async () => {
                setCropApplying(true);
                setComposerError(null);
                try {
                  const cropped = await cropComposerMediaItem(cropTarget, cropConfig);
                  setMediaItems((current) =>
                    current.map((item) => (item.id === cropTarget.id ? cropped : item)),
                  );
                  setCropTargetId(null);
                } catch (error) {
                  setComposerError(error instanceof Error ? error.message : "Could not crop this image.");
                } finally {
                  setCropApplying(false);
                }
              }}
              onClose={() => setCropTargetId(null)}
              onConfigChange={setCropConfig}
            />
          ) : (
            <div className="composer-phone">
              <div className="composer-preview-header">
                <MediaThumb alt={props.page?.name || "Page"} src={pageImageUrl(props.page)} />
                <div>
                  <strong>{props.page?.name || "Select a page"}</strong>
                  <span>{dateValue || "Draft"} {timeValue ? `at ${timeValue}` : ""}</span>
                </div>
              </div>
              <div className="composer-media-stage">
                {selectedPreviewItem?.processing ? (
                  <div className="composer-media-empty">Preparing preview</div>
                ) : selectedPreviewItem?.previewUrl ? (
                  selectedPreviewItem.kind === "video" ? (
                    <video controls src={selectedPreviewItem.previewUrl} />
                  ) : (
                    <img alt={selectedPreviewItem.file.name} src={selectedPreviewItem.previewUrl} />
                  )
                ) : (
                  <div className="composer-media-empty">Media preview</div>
                )}
              </div>
              <div className="composer-preview-copy">
                <strong>{title || "Untitled post"}</strong>
                <p>{copy || "Post copy will appear here as you type."}</p>
                {link ? <a href={link} rel="noreferrer" target="_blank">{link}</a> : null}
              </div>
              <div className="chip-row">
                {props.page?.social_accounts.filter((account) => account.is_active).map((account) => (
                  <span className="chip" key={account.id}>{account.platform}</span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="post-composer-fields" aria-label="Post details">
          {composerError ? <div className="composer-notice composer-notice-bad">{composerError}</div> : null}
          {blockingCropCount ? (
            <div className="composer-notice composer-notice-warn">
              {blockingCropCount} image{blockingCropCount === 1 ? "" : "s"} need cropping for Instagram feed ratio.
            </div>
          ) : null}
          <div className="form-grid">
            <Field label="Date">
              <input onChange={(event) => setDateValue(event.target.value)} type="date" value={dateValue} />
            </Field>
            <Field label="Time">
              <input onChange={(event) => setTimeValue(event.target.value)} type="time" value={timeValue} />
            </Field>
            <Field label="Job Nr">
              <input onChange={(event) => setJobNr(event.target.value)} placeholder="Optional" value={jobNr} />
            </Field>
            <Field label="Post title">
              <input onChange={(event) => setTitle(event.target.value)} required value={title} />
            </Field>
            <Field label="Format">
              <input onChange={(event) => setFormat(event.target.value)} placeholder="Carousel, image, video" value={format} />
            </Field>
            <Field label="Link">
              <input onChange={(event) => setLink(event.target.value)} placeholder="Optional URL" value={link} />
            </Field>
            <Field label="Designer">
              <select onChange={(event) => setDesigner(event.target.value)} value={designer}>
                <option value="">Unassigned</option>
                {props.designerOptions.map((designer) => (
                  <option key={designer} value={designer}>{designer}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Post copy">
            <textarea onChange={(event) => setCopy(event.target.value)} rows={7} value={copy} />
          </Field>

          <Field label="Images or video">
            <input
              accept="image/*,video/*"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                void addMediaFiles(files);
                event.currentTarget.value = "";
              }}
              type="file"
            />
            <span className="field-hint">
              Images are inspected before saving. Oversized files use lightweight previews in the composer.
            </span>
          </Field>

          <div className="composer-media-list">
            {mediaItems.map((item, index) => (
              <article className="composer-media-item" key={item.id}>
                {item.processing ? (
                  <div className="composer-media-pending">...</div>
                ) : item.previewUrl && item.kind === "video" ? (
                  <video src={item.previewUrl} />
                ) : item.previewUrl ? (
                  <img alt={item.file.name} src={item.previewUrl} />
                ) : (
                  <span className="post-thumb-placeholder" />
                )}
                <div>
                  <strong>{item.file.name}</strong>
                  <span>
                    {index + 1} of {mediaItems.length} · {formatFileSize(item.file.size)}
                    {item.width && item.height ? ` · ${item.width}x${item.height}` : ""}
                  </span>
                  {item.error ? <span className="composer-media-error">{item.error}</span> : null}
                  {item.cropNeeded ? (
                    <span className="composer-media-status">Crop required: Instagram accepts 4:5 to 1.91:1.</span>
                  ) : null}
                </div>
                <div className="inline-actions">
                  {item.kind === "image" && !item.processing ? (
                    <Button
                      onClick={() => {
                        setCropTargetId(item.id);
                        setCropConfig({
                          targetRatio: recommendedCropRatio(item.width, item.height),
                          offsetX: 50,
                          offsetY: 50,
                          zoom: 1,
                        });
                      }}
                      type="button"
                      variant={item.cropNeeded ? "primary" : "ghost"}
                    >
                      {item.cropNeeded ? "Crop image" : "Crop"}
                    </Button>
                  ) : null}
                  <Button disabled={index === 0} onClick={() => moveMedia(index, -1)} type="button" variant="ghost">Up</Button>
                  <Button disabled={index === mediaItems.length - 1} onClick={() => moveMedia(index, 1)} type="button" variant="ghost">Down</Button>
                  <Button onClick={() => removeMedia(item.id)} type="button" variant="danger">Remove</Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </form>
    </Modal>
  );
}

function CropDashboard(props: {
  item: ComposerMediaItem;
  config: CropConfig;
  applying: boolean;
  onConfigChange: (config: CropConfig) => void;
  onApply: () => Promise<void>;
  onClose: () => void;
}) {
  const ratioLabel = `${props.config.targetRatio.toFixed(2)}:1`;
  return (
    <div className="crop-dashboard">
      <div className="crop-dashboard-header">
        <div>
          <strong>Crop image</strong>
          <span>{props.item.file.name}</span>
        </div>
        <Button onClick={props.onClose} type="button" variant="ghost">Back to preview</Button>
      </div>
      <div className="crop-stage-shell">
        <div className="crop-stage" style={{ aspectRatio: String(props.config.targetRatio) }}>
          {props.item.previewUrl ? (
            <img
              alt={props.item.file.name}
              src={props.item.previewUrl}
              style={{
                objectPosition: `${props.config.offsetX}% ${props.config.offsetY}%`,
                transform: `scale(${props.config.zoom})`,
              }}
            />
          ) : (
            <div className="composer-media-empty">Preparing crop preview</div>
          )}
        </div>
      </div>
      <div className="crop-control-grid">
        <Field label="Crop ratio">
          <select
            onChange={(event) =>
              props.onConfigChange({ ...props.config, targetRatio: Number(event.target.value) })
            }
            value={String(props.config.targetRatio)}
          >
            <option value={String(recommendedCropRatio(props.item.width, props.item.height))}>Recommended {ratioLabel}</option>
            <option value={String(INSTAGRAM_FEED_RATIO_MIN)}>Portrait 4:5</option>
            <option value="1">Square 1:1</option>
            <option value="1.3333333333333333">Landscape 4:3</option>
            <option value={String(INSTAGRAM_FEED_RATIO_MAX)}>Wide 1.91:1</option>
          </select>
        </Field>
        <Field label="Zoom">
          <input
            max="3"
            min="1"
            onChange={(event) =>
              props.onConfigChange({ ...props.config, zoom: Number(event.target.value) })
            }
            step="0.05"
            type="range"
            value={props.config.zoom}
          />
        </Field>
        <Field label="Horizontal">
          <input
            max="100"
            min="0"
            onChange={(event) =>
              props.onConfigChange({ ...props.config, offsetX: Number(event.target.value) })
            }
            type="range"
            value={props.config.offsetX}
          />
        </Field>
        <Field label="Vertical">
          <input
            max="100"
            min="0"
            onChange={(event) =>
              props.onConfigChange({ ...props.config, offsetY: Number(event.target.value) })
            }
            type="range"
            value={props.config.offsetY}
          />
        </Field>
      </div>
      <div className="crop-dashboard-footer">
        <span>Accepted feed range: 4:5 to 1.91:1</span>
        <Button disabled={props.applying} onClick={() => void props.onApply()} type="button" variant="primary">
          {props.applying ? "Applying crop" : "Apply crop"}
        </Button>
      </div>
    </div>
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
