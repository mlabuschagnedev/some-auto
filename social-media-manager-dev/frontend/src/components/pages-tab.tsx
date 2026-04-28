import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  createPageRecord,
  createSocialAccount,
  deletePageRecord,
  deleteSocialAccount,
  loadGlobalReferenceSheet,
  loadPageReferenceSheet,
  loadPageSettings,
  loadPages,
  refreshSocialAccountToken,
  saveGlobalReferenceSheet,
  savePageReferenceSheet,
  testSocialAccount,
  updatePageRecord,
  updatePageSettings,
  updateSocialAccount,
} from "../api";
import type {
  PageRecord,
  PageSettingsValues,
  ReferenceSheetPayload,
  SessionPayload,
  SocialAccount,
} from "../types";
import { ReferenceSheetEditor } from "./reference-sheet-editor";
import { EmptyState, Field, SectionCard, StatusPill } from "./ui";

const PLATFORM_OPTIONS = ["facebook", "instagram", "linkedin", "twitter", "pinterest"];
const GLOBAL_REFERENCE_SHEETS = [
  { key: "contact_info", label: "Contact info" },
  { key: "login_details", label: "Login details" },
];
const PAGE_REFERENCE_SHEETS = [
  { key: "sheet_one", label: "Info Sheet 1" },
  { key: "sheet_two", label: "Info Sheet 2" },
];
const DEFAULT_PAGE_SETTINGS: PageSettingsValues = {
  default_post_time: "10:00",
  timezone: "Africa/Johannesburg",
  auto_schedule: "true",
  notification_enabled: "true",
  live_posting_enabled: "false",
};

interface PageFormState {
  name: string;
  description: string;
  linkedin_page_url: string;
  image: File | null;
}

interface AccountFormState {
  platform: string;
  account_name: string;
  page_id_external: string;
  access_token: string;
  access_token_secret: string;
  api_key: string;
  api_secret: string;
  refresh_token: string;
  token_expires_at: string;
  is_active: boolean;
}

interface ReferenceSheetState {
  payload: ReferenceSheetPayload;
  scope: { type: "global" } | { type: "page"; pageId: number };
}

const EMPTY_PAGE_FORM: PageFormState = {
  name: "",
  description: "",
  linkedin_page_url: "",
  image: null,
};

const EMPTY_ACCOUNT_FORM: AccountFormState = {
  platform: "facebook",
  account_name: "",
  page_id_external: "",
  access_token: "",
  access_token_secret: "",
  api_key: "",
  api_secret: "",
  refresh_token: "",
  token_expires_at: "",
  is_active: true,
};

function toPageForm(page: PageRecord | null): PageFormState {
  if (!page) {
    return EMPTY_PAGE_FORM;
  }
  return {
    name: page.name,
    description: page.description || "",
    linkedin_page_url: page.linkedin_page_url || "",
    image: null,
  };
}

function toAccountForm(account?: SocialAccount | null): AccountFormState {
  if (!account) {
    return EMPTY_ACCOUNT_FORM;
  }
  return {
    platform: account.platform,
    account_name: account.account_name || "",
    page_id_external: account.page_id_external || "",
    access_token: "",
    access_token_secret: "",
    api_key: "",
    api_secret: "",
    refresh_token: "",
    token_expires_at: account.token_expires_at ? account.token_expires_at.slice(0, 16) : "",
    is_active: account.is_active,
  };
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not set";
  }
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function PagesTab(props: {
  initialPages: PageRecord[];
  session: SessionPayload;
  onSessionUpdate: (nextSession: SessionPayload | null) => void;
  canEditPages: boolean;
  canCreateDeletePages: boolean;
  canManageAccounts: boolean;
  onWorkspaceChanged: () => Promise<void> | void;
  onNotice: (message: string, tone?: "success" | "error") => void;
}) {
  const [pages, setPages] = useState<PageRecord[]>(props.initialPages);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedPageId, setSelectedPageId] = useState<number | null>(
    props.initialPages[0]?.id ?? null,
  );
  const [pageForm, setPageForm] = useState<PageFormState>(toPageForm(props.initialPages[0] || null));
  const [pageSettingsForm, setPageSettingsForm] = useState<PageSettingsValues>(DEFAULT_PAGE_SETTINGS);
  const [pageSettingsLoading, setPageSettingsLoading] = useState(false);
  const [accountForm, setAccountForm] = useState<AccountFormState>(EMPTY_ACCOUNT_FORM);
  const [accountEditId, setAccountEditId] = useState<number | null>(null);
  const [savingPage, setSavingPage] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);
  const [referenceSheet, setReferenceSheet] = useState<ReferenceSheetState | null>(null);
  const [referenceSheetSaving, setReferenceSheetSaving] = useState(false);

  useEffect(() => {
    setPages(props.initialPages);
    if (!props.initialPages.some((page) => page.id === selectedPageId)) {
      setSelectedPageId(props.initialPages[0]?.id ?? null);
    }
  }, [props.initialPages, selectedPageId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadPages(props.session, props.onSessionUpdate, deferredSearch)
      .then((items) => {
        if (cancelled) {
          return;
        }
        setPages(items);
        if (!items.some((page) => page.id === selectedPageId)) {
          setSelectedPageId(items[0]?.id ?? null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          props.onNotice(error instanceof Error ? error.message : "Unable to load pages.", "error");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deferredSearch, props.onSessionUpdate, props.onNotice, props.session, selectedPageId]);

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) || null,
    [pages, selectedPageId],
  );

  useEffect(() => {
    setPageForm(toPageForm(creatingPage ? null : selectedPage));
    setAccountEditId(null);
    setAccountForm(EMPTY_ACCOUNT_FORM);
  }, [creatingPage, selectedPage]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedPage || creatingPage || !props.canEditPages) {
      setPageSettingsForm(DEFAULT_PAGE_SETTINGS);
      setPageSettingsLoading(false);
      return;
    }
    setPageSettingsLoading(true);
    void loadPageSettings(props.session, props.onSessionUpdate, selectedPage.id)
      .then((payload) => {
        if (!cancelled) {
          setPageSettingsForm({
            default_post_time:
              payload.effective.default_post_time || DEFAULT_PAGE_SETTINGS.default_post_time,
            timezone: payload.effective.timezone || DEFAULT_PAGE_SETTINGS.timezone,
            auto_schedule: payload.effective.auto_schedule || DEFAULT_PAGE_SETTINGS.auto_schedule,
            notification_enabled:
              payload.effective.notification_enabled || DEFAULT_PAGE_SETTINGS.notification_enabled,
            live_posting_enabled:
              payload.effective.live_posting_enabled || DEFAULT_PAGE_SETTINGS.live_posting_enabled,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          props.onNotice(
            error instanceof Error ? error.message : "Unable to load page settings.",
            "error",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPageSettingsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [creatingPage, props.canEditPages, props.onNotice, props.onSessionUpdate, props.session, selectedPage]);

  async function refreshPages(): Promise<void> {
    const items = await loadPages(props.session, props.onSessionUpdate, deferredSearch);
    setPages(items);
  }

  async function handlePageSave(): Promise<void> {
    if (!pageForm.name.trim()) {
      props.onNotice("Page name is required.", "error");
      return;
    }

    setSavingPage(true);
    try {
      const formData = new FormData();
      formData.set("name", pageForm.name.trim());
      formData.set("description", pageForm.description.trim());
      formData.set("linkedin_page_url", pageForm.linkedin_page_url.trim());
      if (pageForm.image) {
        formData.set("image", pageForm.image);
      }

      if (creatingPage) {
        const created = await createPageRecord(props.session, props.onSessionUpdate, formData);
        setCreatingPage(false);
        setSelectedPageId(created.id);
        props.onNotice("Page created.", "success");
      } else if (selectedPage) {
        await updatePageRecord(props.session, props.onSessionUpdate, selectedPage.id, formData);
        if (props.canEditPages) {
          await updatePageSettings(props.session, props.onSessionUpdate, selectedPage.id, {
            ...pageSettingsForm,
          });
        }
        props.onNotice("Page updated.", "success");
      }

      await refreshPages();
      await props.onWorkspaceChanged();
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "Unable to save the page.", "error");
    } finally {
      setSavingPage(false);
    }
  }

  async function handlePageDelete(): Promise<void> {
    if (!selectedPage) {
      return;
    }
    if (!window.confirm(`Delete ${selectedPage.name}?`)) {
      return;
    }

    try {
      await deletePageRecord(props.session, props.onSessionUpdate, selectedPage.id);
      props.onNotice("Page deleted.", "success");
      await refreshPages();
      await props.onWorkspaceChanged();
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "Unable to delete the page.", "error");
    }
  }

  async function handleAccountSave(): Promise<void> {
    if (!selectedPage) {
      return;
    }
    setSavingAccount(true);
    try {
      const payload: Record<string, unknown> = {
        platform: accountForm.platform,
        account_name: accountForm.account_name,
        page_id_external: accountForm.page_id_external,
        token_expires_at: accountForm.token_expires_at ? `${accountForm.token_expires_at}:00` : "",
        is_active: accountForm.is_active,
      };

      if (accountForm.access_token.trim()) {
        payload.access_token = accountForm.access_token;
      }
      if (accountForm.access_token_secret.trim()) {
        payload.access_token_secret = accountForm.access_token_secret;
      }
      if (accountForm.api_key.trim()) {
        payload.api_key = accountForm.api_key;
      }
      if (accountForm.api_secret.trim()) {
        payload.api_secret = accountForm.api_secret;
      }
      if (accountForm.refresh_token.trim()) {
        payload.refresh_token = accountForm.refresh_token;
      }

      if (accountEditId) {
        await updateSocialAccount(props.session, props.onSessionUpdate, accountEditId, payload);
        props.onNotice("Account updated.", "success");
      } else {
        await createSocialAccount(
          props.session,
          props.onSessionUpdate,
          selectedPage.id,
          payload,
        );
        props.onNotice("Account connected.", "success");
      }

      setAccountEditId(null);
      setAccountForm(EMPTY_ACCOUNT_FORM);
      await refreshPages();
      await props.onWorkspaceChanged();
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "Unable to save the account.", "error");
    } finally {
      setSavingAccount(false);
    }
  }

  async function handleAccountAction(
    action: () => Promise<unknown>,
    successMessage: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      await action();
      props.onNotice(successMessage, "success");
      await refreshPages();
      await props.onWorkspaceChanged();
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : errorMessage, "error");
    }
  }

  async function openGlobalSheet(sheetKey: string): Promise<void> {
    try {
      const payload = await loadGlobalReferenceSheet(
        props.session,
        props.onSessionUpdate,
        sheetKey,
      );
      setReferenceSheet({
        payload,
        scope: { type: "global" },
      });
    } catch (error) {
      props.onNotice(
        error instanceof Error ? error.message : "Unable to load the reference sheet.",
        "error",
      );
    }
  }

  async function openPageSheet(sheetKey: string): Promise<void> {
    if (!selectedPage) {
      return;
    }
    try {
      const payload = await loadPageReferenceSheet(
        props.session,
        props.onSessionUpdate,
        selectedPage.id,
        sheetKey,
      );
      setReferenceSheet({
        payload,
        scope: { type: "page", pageId: selectedPage.id },
      });
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "Unable to load the page sheet.", "error");
    }
  }

  async function saveReferenceSheetDraft(draft: {
    title: string;
    columns: string[];
    rows: string[][];
  }): Promise<void> {
    if (!referenceSheet) {
      return;
    }
    setReferenceSheetSaving(true);
    try {
      const payload =
        referenceSheet.scope.type === "global"
          ? await saveGlobalReferenceSheet(
              props.session,
              props.onSessionUpdate,
              referenceSheet.payload.sheet_key,
              draft,
            )
          : await savePageReferenceSheet(
              props.session,
              props.onSessionUpdate,
              referenceSheet.scope.pageId,
              referenceSheet.payload.sheet_key,
              draft,
            );
      setReferenceSheet({
        ...referenceSheet,
        payload,
      });
      props.onNotice(payload.message || "Reference sheet saved.", "success");
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "Unable to save the sheet.", "error");
    } finally {
      setReferenceSheetSaving(false);
    }
  }

  return (
    <>
      <div className="view-grid">
        <SectionCard
          title="Pages"
          subtitle="Manage page identity, page-level settings, connected accounts, and shared reference sheets directly in React."
        >
          <div className="toolbar">
            <input
              className="search-input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search pages"
              value={search}
            />
            <div className="inline-actions">
              {props.canEditPages
                ? GLOBAL_REFERENCE_SHEETS.map((sheet) => (
                    <button
                      className="secondary-button"
                      key={sheet.key}
                      onClick={() => void openGlobalSheet(sheet.key)}
                      type="button"
                    >
                      {sheet.label}
                    </button>
                  ))
                : null}
              {props.canCreateDeletePages ? (
                <button
                  className="secondary-button"
                  onClick={() => setCreatingPage(true)}
                  type="button"
                >
                  New page
                </button>
              ) : null}
            </div>
          </div>

          <div className="workspace-grid">
            <aside className="workspace-sidebar">
              {pages.map((page) => (
                <button
                  className={
                    page.id === selectedPageId && !creatingPage
                      ? "sidebar-item sidebar-item-active"
                      : "sidebar-item"
                  }
                  key={page.id}
                  onClick={() => {
                    setCreatingPage(false);
                    setSelectedPageId(page.id);
                  }}
                  type="button"
                >
                  <strong>{page.name}</strong>
                  <span>{page.social_accounts.length} accounts</span>
                </button>
              ))}
              {!pages.length && !loading ? <EmptyState text="No pages found." /> : null}
            </aside>

            <div className="workspace-main">
              <SectionCard
                title={creatingPage ? "Create page" : selectedPage?.name || "Select a page"}
                subtitle={
                  creatingPage
                    ? "New pages automatically receive a planning sheet."
                    : "Core page profile, page overrides, and per-page reference sheets."
                }
                actions={
                  selectedPage && props.canCreateDeletePages && !creatingPage ? (
                    <button className="danger-button" onClick={handlePageDelete} type="button">
                      Delete page
                    </button>
                  ) : null
                }
              >
                {creatingPage || selectedPage ? (
                  <div className="workspace-main">
                    <div className="form-grid">
                      <Field label="Page name">
                        <input
                          onChange={(event) =>
                            setPageForm((current) => ({ ...current, name: event.target.value }))
                          }
                          value={pageForm.name}
                        />
                      </Field>
                      <Field label="LinkedIn page URL">
                        <input
                          onChange={(event) =>
                            setPageForm((current) => ({
                              ...current,
                              linkedin_page_url: event.target.value,
                            }))
                          }
                          value={pageForm.linkedin_page_url}
                        />
                      </Field>
                      <Field label="Description">
                        <textarea
                          onChange={(event) =>
                            setPageForm((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                          rows={4}
                          value={pageForm.description}
                        />
                      </Field>
                      <Field
                        label="Image"
                        hint={selectedPage?.image_path ? `Current image: ${selectedPage.image_path}` : undefined}
                      >
                        <input
                          accept="image/*"
                          onChange={(event) =>
                            setPageForm((current) => ({
                              ...current,
                              image: event.target.files?.[0] || null,
                            }))
                          }
                          type="file"
                        />
                      </Field>
                    </div>

                    {!creatingPage && selectedPage ? (
                      <div className="form-grid">
                        <Field label="Default Post Time">
                          <input
                            onChange={(event) =>
                              setPageSettingsForm((current) => ({
                                ...current,
                                default_post_time: event.target.value,
                              }))
                            }
                            type="time"
                            value={pageSettingsForm.default_post_time}
                          />
                        </Field>
                        <Field label="Timezone">
                          <input
                            onChange={(event) =>
                              setPageSettingsForm((current) => ({
                                ...current,
                                timezone: event.target.value,
                              }))
                            }
                            value={pageSettingsForm.timezone}
                          />
                        </Field>
                        <Field label="Auto Schedule">
                          <select
                            onChange={(event) =>
                              setPageSettingsForm((current) => ({
                                ...current,
                                auto_schedule: event.target.value,
                              }))
                            }
                            value={pageSettingsForm.auto_schedule}
                          >
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        </Field>
                        <Field label="Notifications">
                          <select
                            onChange={(event) =>
                              setPageSettingsForm((current) => ({
                                ...current,
                                notification_enabled: event.target.value,
                              }))
                            }
                            value={pageSettingsForm.notification_enabled}
                          >
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        </Field>
                        <Field label="Live Posting">
                          <select
                            onChange={(event) =>
                              setPageSettingsForm((current) => ({
                                ...current,
                                live_posting_enabled: event.target.value,
                              }))
                            }
                            value={pageSettingsForm.live_posting_enabled}
                          >
                            <option value="false">false</option>
                            <option value="true">true</option>
                          </select>
                        </Field>
                        <div className="reference-sheet-actions">
                          <p className="detail-label">Page Reference Sheets</p>
                          <div className="inline-actions">
                            {PAGE_REFERENCE_SHEETS.map((sheet) => (
                              <button
                                className="secondary-button"
                                key={sheet.key}
                                onClick={() => void openPageSheet(sheet.key)}
                                type="button"
                              >
                                {sheet.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {props.canEditPages ? (
                      <div className="form-actions">
                        {creatingPage ? (
                          <button
                            className="secondary-button"
                            onClick={() => setCreatingPage(false)}
                            type="button"
                          >
                            Cancel
                          </button>
                        ) : null}
                        <button
                          className="primary-button"
                          disabled={savingPage || pageSettingsLoading}
                          onClick={() => void handlePageSave()}
                          type="button"
                        >
                          {savingPage
                            ? "Saving..."
                            : creatingPage
                              ? "Create page"
                              : "Save page"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState text="Select a page from the left to start managing it." />
                )}
              </SectionCard>
              {selectedPage ? (
                <SectionCard
                  title="Connected accounts"
                  subtitle="Test, refresh, edit, and remove account bindings without leaving the new workspace."
                >
                  <div className="account-list">
                    {selectedPage.social_accounts.map((account) => (
                      <article className="account-card" key={account.id}>
                        <div className="account-card-header">
                          <div>
                            <h3>{account.account_name || "Unnamed account"}</h3>
                            <p>{account.platform}</p>
                          </div>
                          <StatusPill
                            label={account.is_active ? "Active" : "Inactive"}
                            tone={account.is_active ? "good" : "warn"}
                          />
                        </div>
                        <div className="account-card-body">
                          <p className="muted">External ID: {account.page_id_external || "Not set"}</p>
                          <p className="muted">Token expiry: {formatDateTime(account.token_expires_at)}</p>
                          <p className="muted">Last tested: {formatDateTime(account.last_tested)}</p>
                          {account.test_error ? <p className="inline-error">{account.test_error}</p> : null}
                        </div>
                        {props.canManageAccounts ? (
                          <div className="inline-actions">
                            <button
                              className="secondary-button"
                              onClick={() => {
                                setAccountEditId(account.id);
                                setAccountForm(toAccountForm(account));
                              }}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="secondary-button"
                              onClick={() =>
                                void handleAccountAction(
                                  () => testSocialAccount(props.session, props.onSessionUpdate, account.id),
                                  "Account test completed.",
                                  "Unable to test the account.",
                                )
                              }
                              type="button"
                            >
                              Test
                            </button>
                            <button
                              className="secondary-button"
                              onClick={() =>
                                void handleAccountAction(
                                  () =>
                                    refreshSocialAccountToken(
                                      props.session,
                                      props.onSessionUpdate,
                                      account.id,
                                    ),
                                  "Token refresh completed.",
                                  "Unable to refresh the account token.",
                                )
                              }
                              type="button"
                            >
                              Refresh
                            </button>
                            <button
                              className="danger-button"
                              onClick={() => {
                                if (!window.confirm("Delete this account?")) {
                                  return;
                                }
                                void handleAccountAction(
                                  () => deleteSocialAccount(props.session, props.onSessionUpdate, account.id),
                                  "Account deleted.",
                                  "Unable to delete the account.",
                                );
                              }}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>

                  {props.canManageAccounts ? (
                    <div className="account-editor">
                      <h3>{accountEditId ? "Edit account" : "Connect account"}</h3>
                      <div className="form-grid">
                        <Field label="Platform">
                          <select
                            onChange={(event) =>
                              setAccountForm((current) => ({
                                ...current,
                                platform: event.target.value,
                              }))
                            }
                            value={accountForm.platform}
                          >
                            {PLATFORM_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Account name">
                          <input
                            onChange={(event) =>
                              setAccountForm((current) => ({
                                ...current,
                                account_name: event.target.value,
                              }))
                            }
                            value={accountForm.account_name}
                          />
                        </Field>
                        <Field label="External page or account ID">
                          <input
                            onChange={(event) =>
                              setAccountForm((current) => ({
                                ...current,
                                page_id_external: event.target.value,
                              }))
                            }
                            value={accountForm.page_id_external}
                          />
                        </Field>
                        <Field label="Token expiry">
                          <input
                            onChange={(event) =>
                              setAccountForm((current) => ({
                                ...current,
                                token_expires_at: event.target.value,
                              }))
                            }
                            type="datetime-local"
                            value={accountForm.token_expires_at}
                          />
                        </Field>
                        <Field label="Access token">
                          <textarea
                            onChange={(event) =>
                              setAccountForm((current) => ({
                                ...current,
                                access_token: event.target.value,
                              }))
                            }
                            rows={3}
                            value={accountForm.access_token}
                          />
                        </Field>
                        <Field label="Refresh token">
                          <textarea
                            onChange={(event) =>
                              setAccountForm((current) => ({
                                ...current,
                                refresh_token: event.target.value,
                              }))
                            }
                            rows={3}
                            value={accountForm.refresh_token}
                          />
                        </Field>
                        <Field label="Access token secret">
                          <input
                            onChange={(event) =>
                              setAccountForm((current) => ({
                                ...current,
                                access_token_secret: event.target.value,
                              }))
                            }
                            value={accountForm.access_token_secret}
                          />
                        </Field>
                        <Field label="API key">
                          <input
                            onChange={(event) =>
                              setAccountForm((current) => ({
                                ...current,
                                api_key: event.target.value,
                              }))
                            }
                            value={accountForm.api_key}
                          />
                        </Field>
                        <Field label="API secret">
                          <input
                            onChange={(event) =>
                              setAccountForm((current) => ({
                                ...current,
                                api_secret: event.target.value,
                              }))
                            }
                            value={accountForm.api_secret}
                          />
                        </Field>
                        <label className="checkbox-field">
                          <input
                            checked={accountForm.is_active}
                            onChange={(event) =>
                              setAccountForm((current) => ({
                                ...current,
                                is_active: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />
                          <span>Account is active</span>
                        </label>
                      </div>
                      <div className="form-actions">
                        <button
                          className="secondary-button"
                          onClick={() => {
                            setAccountEditId(null);
                            setAccountForm(EMPTY_ACCOUNT_FORM);
                          }}
                          type="button"
                        >
                          Reset
                        </button>
                        <button
                          className="primary-button"
                          disabled={savingAccount}
                          onClick={() => void handleAccountSave()}
                          type="button"
                        >
                          {savingAccount
                            ? "Saving..."
                            : accountEditId
                              ? "Save account"
                              : "Connect account"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </SectionCard>
              ) : null}
            </div>
          </div>
        </SectionCard>
      </div>

      <ReferenceSheetEditor
        onClose={() => setReferenceSheet(null)}
        onSave={saveReferenceSheetDraft}
        open={!!referenceSheet}
        payload={referenceSheet?.payload || null}
        prefix={
          referenceSheet?.scope.type === "page"
            ? `page-${referenceSheet.scope.pageId}-${referenceSheet.payload.sheet_key}`
            : `global-${referenceSheet?.payload.sheet_key || "sheet"}`
        }
        saving={referenceSheetSaving}
        subtitle={
          referenceSheet?.scope.type === "page"
            ? `Internal page sheet for ${selectedPage?.name || "the selected page"}.`
            : "Shared internal reference sheet for page operations."
        }
      />
    </>
  );
}
