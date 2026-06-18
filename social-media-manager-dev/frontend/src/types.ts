export interface AuthUser {
  username: string;
  display_name: string;
  email: string | null;
  role: "developer" | "admin" | "designer";
  is_active: boolean;
  is_owner: boolean;
  available_tabs: string[];
}

export interface SessionPayload {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface UserRecord extends AuthUser {
  has_password: boolean;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

export interface VerifyResponse {
  valid: boolean;
  user: AuthUser;
}

export interface SocialAccount {
  id: number;
  page_id: number;
  platform: string;
  account_name: string | null;
  page_id_external: string | null;
  is_active: boolean;
  last_refreshed: string | null;
  last_tested: string | null;
  token_expires_at: string | null;
  test_status: string | null;
  test_error: string | null;
  created_at: string;
}

export interface AccountOperationResponse {
  success?: boolean;
  message?: string;
  error?: string;
  platform?: string;
  global_token?: {
    expires_at: string | null;
    refresh_expires_at: string | null;
  };
}

export interface PageStats {
  scheduled_posts: number;
  successful_posts: number;
  failed_posts: number;
}

export interface PageRecord {
  id: number;
  name: string;
  description: string | null;
  image_path: string | null;
  linkedin_page_url: string | null;
  created_at: string;
  updated_at: string;
  social_accounts: SocialAccount[];
  stats: PageStats;
}

export interface PageSettingsValues {
  default_post_time: string;
  timezone: string;
  auto_schedule: string;
  notification_enabled: string;
  live_posting_enabled: string;
}

export interface PlanningSheetSummary {
  sheet_id: number;
  page_id: number;
  page_name: string;
  linked_accounts: string;
  row_count: number;
}

export interface PlanningMonthOption {
  value: string;
  label: string;
  row_count: number;
  is_past: boolean;
}

export interface PlanningJobColorRules {
  required_to_schedule: string;
  scheduled_value: string;
  posted_value: string;
  failed_value: string;
}

export interface PlanningRowRecord {
  id: number;
  sheet_id: number;
  page_id: number | null;
  row_order: number;
  planning_month: string;
  planning_month_label: string;
  is_non_actionable: boolean;
  linked_accounts: string;
  job_nr: string;
  job_color: string;
  date_value: string;
  time_value: string;
  theme: string;
  post_copy: string;
  link: string;
  format: string;
  final_creative: string;
  deadline: string;
  mss_notes: string;
  creative_media_path: string;
  creative_media_url: string | null;
  creative_media_paths: string[];
  creative_media_urls: string[];
  creative_media_count: number;
  designer: string;
  designer_warning_sent_at: string | null;
  clarise_warning_sent_at: string | null;
  ready_warning_sent_at: string | null;
  scheduled_post_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface PlanningPagePayload {
  sheet: {
    id: number;
    page_id: number;
    page_name: string | null;
    row_count: number;
    created_at: string;
    updated_at: string;
  };
  page: PageRecord;
  rows: PlanningRowRecord[];
  selected_month: string;
  selected_month_label: string;
  current_month: string;
  month_options: PlanningMonthOption[];
  designer_options: string[];
  job_color_rules: PlanningJobColorRules;
}

export interface SchedulerJob {
  id: string;
  next_run: string | null;
}

export interface PostQueueItem {
  id?: number;
  status?: string | null;
  scheduled_for?: string | null;
  page_id?: number;
  page_name?: string | null;
}

export interface SchedulerStatus {
  running: boolean;
  scheduled_jobs: number;
  jobs: SchedulerJob[];
  queued_posts: PostQueueItem[];
  posting_posts: PostQueueItem[];
}

export interface TokenStatusRow {
  id: number;
  page_id: number;
  page_name: string;
  platform: string;
  account_name: string | null;
  expires_at: string | null;
  days_until_expiry: number | null;
  needs_refresh: boolean;
  last_refreshed: string | null;
}

export interface IntegrationAccount {
  id: number;
  page_id: number;
  page_name: string;
  platform: string;
  account_name: string | null;
  active: boolean;
  missing_fields: string[];
  ready_for_publish: boolean;
  token_expires_at: string | null;
}

export interface PostRecord {
  id: number;
  page_id: number;
  page_name: string | null;
  content: string | null;
  media_paths: string[];
  media_type: string | null;
  platforms: string[];
  scheduled_time: string | null;
  status: string;
  created_at: string;
  posted_at: string | null;
  error_message: string | null;
  platform_ids: Record<string, string | null>;
  platform_urls: Record<string, string>;
  linkedin_manual: {
    required: boolean;
    done?: boolean;
    done_at?: string | null;
    done_by?: string | null;
    page_url?: string | null;
    media_items?: Array<{
      path: string;
      name: string;
      url: string;
      is_video: boolean;
    }>;
  };
}

export interface TokenStatusSummary {
  configured: boolean;
  status: string;
  expires_at: string | null;
  days_until_expiry: number | null;
  time_left_text: string | null;
}

export interface LinkedInGlobalStatus {
  configured: boolean;
  status: string;
  expires_at: string | null;
  refresh_expires_at: string | null;
  has_refresh_token: boolean;
  time_left_text: string | null;
}

export interface SettingsUpdateResult {
  message: string;
  outcome: string;
}

export interface GlobalSettingsPayload extends PageSettingsValues {
  app_name: string;
  global_meta_user_token: string;
  facebook_app_id: string;
  facebook_app_secret: string;
  global_linkedin_access_token: string;
  global_linkedin_refresh_token: string;
  global_linkedin_token_expires_at: string;
  global_linkedin_refresh_token_expires_at: string;
  designer_email_map: string;
  meta_global?: TokenStatusSummary;
  linkedin_global?: LinkedInGlobalStatus;
  message?: string;
  warnings?: string[];
  meta_token_result?: SettingsUpdateResult;
  linkedin_token_result?: SettingsUpdateResult;
}

export interface PageSettingsPayload {
  scope: {
    type: "page";
    page_id: number;
    page_name: string;
  };
  global_defaults: GlobalSettingsPayload;
  overrides: Partial<PageSettingsValues>;
  effective: PageSettingsValues;
  meta_global?: TokenStatusSummary;
  linkedin_global?: LinkedInGlobalStatus;
}

export interface ReferenceSheetPayload {
  sheet_key: string;
  title: string;
  columns: string[];
  rows: string[][];
  scope_label?: string;
  page_id?: number;
  page_name?: string;
  message?: string;
}

export interface PlanningImportReportItem {
  file_name: string;
  status: string;
  page_name: string | null;
  page_id: number | null;
  rows_imported: number;
  rows_skipped: number;
  imported_months: string[];
  issues: string[];
  processed_file: string | null;
}

export interface PlanningImportResult {
  inbox_path: string;
  processed_path: string;
  files_seen: number;
  files_processed: number;
  files_failed: number;
  rows_imported: number;
  rows_skipped: number;
  report: PlanningImportReportItem[];
  message: string;
}

export interface SettingsSnapshot {
  app_name: string;
  timezone: string;
  auto_schedule: string;
  live_posting_enabled: string;
  notification_enabled: string;
  meta_global?: TokenStatusSummary;
  linkedin_global?: LinkedInGlobalStatus;
}

export interface WorkspaceData {
  pages: PageRecord[];
  planningSheets: PlanningSheetSummary[];
  scheduler: SchedulerStatus;
  posts: PostRecord[];
  tokenStatuses: TokenStatusRow[];
  integrations: IntegrationAccount[];
  settings: SettingsSnapshot | null;
}

export interface SocialInsightRecord {
  id: number;
  social_account_id: number;
  platform: string;
  metric_name: string;
  metric_value: number | null;
  period: string | null;
  start_date: string | null;
  end_date: string | null;
  source_metadata: Record<string, unknown>;
  refreshed_at: string;
  refresh_run_id: string | null;
  refresh_run_started_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  error_message: string | null;
}

export interface AnalyticsAccountRecord {
  id: number;
  page_id: number;
  page_name: string | null;
  platform: string;
  account_name: string | null;
  page_id_external: string | null;
  is_active: boolean;
  ready: boolean;
  last_refreshed_at: string | null;
  last_refresh_run_id: string | null;
  last_refresh_run_started_at: string | null;
  last_error: string | null;
  diagnostics?: SocialInsightRecord[];
  insight_count: number;
  insights: SocialInsightRecord[];
}

export interface AnalyticsPostInsightRecord {
  id: number | string;
  internal_post_id: number | null;
  social_account_id: number;
  page_id: number | null;
  page_name: string | null;
  account_name: string | null;
  thumbnail: string | null;
  caption: string;
  platform: string;
  platform_post_id: string;
  published_at: string | null;
  views: number;
  reach: number;
  engagement: number;
  comments: number;
  shares: number;
  permalink: string | null;
  state: string;
  metrics: Record<string, number | null>;
}

export interface AnalyticsRefreshStatus {
  id: string | null;
  status: "idle" | "queued" | "running" | "finished" | "failed" | string;
  message: string | null;
  account_id: number | null;
  started_at: string | null;
  finished_at: string | null;
  progress_current: number;
  progress_total: number;
  result: Record<string, unknown> | null;
  error: string | null;
  accepted?: boolean;
}
