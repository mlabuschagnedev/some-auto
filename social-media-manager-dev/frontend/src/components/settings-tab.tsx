import { useEffect, useState } from "react";
import {
  createUserRecord,
  deleteUserRecord,
  loadGlobalSettings,
  loadTokenStatuses,
  loadUsers,
  updateGlobalSettings,
  updateUserRecord,
} from "../api";
import type {
  GlobalSettingsPayload,
  SchedulerStatus,
  SessionPayload,
  TokenStatusRow,
  UserRecord,
} from "../types";
import { EmptyState, Field, SectionCard, StatusPill } from "./ui";

interface UserFormState {
  username: string;
  display_name: string;
  email: string;
  role: "developer" | "admin" | "designer";
  password: string;
  is_active: boolean;
}

const EMPTY_USER_FORM: UserFormState = {
  username: "",
  display_name: "",
  email: "",
  role: "designer",
  password: "",
  is_active: true,
};

function isoToLocalInput(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
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

function asEnabled(value: string | undefined): string {
  return value === "true" ? "Enabled" : "Disabled";
}

function toUserForm(user: UserRecord | null): UserFormState {
  if (!user) {
    return EMPTY_USER_FORM;
  }
  return {
    username: user.username,
    display_name: user.display_name || "",
    email: user.email || "",
    role: user.role,
    password: "",
    is_active: user.is_active,
  };
}

export function SettingsTab(props: {
  session: SessionPayload;
  scheduler: SchedulerStatus;
  onSessionUpdate: (nextSession: SessionPayload | null) => void;
  onNotice: (message: string, tone?: "success" | "error") => void;
}) {
  const [settings, setSettings] = useState<GlobalSettingsPayload | null>(null);
  const [tokenStatuses, setTokenStatuses] = useState<TokenStatusRow[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [userForm, setUserForm] = useState<UserFormState>(EMPTY_USER_FORM);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      loadGlobalSettings(props.session, props.onSessionUpdate),
      loadTokenStatuses(props.session, props.onSessionUpdate),
      loadUsers(props.session, props.onSessionUpdate),
    ])
      .then(([settingsPayload, tokenPayload, userPayload]) => {
        if (cancelled) {
          return;
        }
        setSettings(settingsPayload);
        setTokenStatuses(tokenPayload);
        setUsers(userPayload);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          props.onNotice(
            error instanceof Error ? error.message : "Unable to load settings data.",
            "error",
          );
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
  }, [props.onNotice, props.onSessionUpdate, props.session]);

  async function refreshAll(): Promise<void> {
    const [settingsPayload, tokenPayload, userPayload] = await Promise.all([
      loadGlobalSettings(props.session, props.onSessionUpdate),
      loadTokenStatuses(props.session, props.onSessionUpdate),
      loadUsers(props.session, props.onSessionUpdate),
    ]);
    setSettings(settingsPayload);
    setTokenStatuses(tokenPayload);
    setUsers(userPayload);
  }

  async function handleSettingsSave(): Promise<void> {
    if (!settings) {
      return;
    }
    setSavingSettings(true);
    try {
      const response = await updateGlobalSettings(props.session, props.onSessionUpdate, {
        app_name: settings.app_name,
        default_post_time: settings.default_post_time,
        timezone: settings.timezone,
        auto_schedule: settings.auto_schedule,
        notification_enabled: settings.notification_enabled,
        live_posting_enabled: settings.live_posting_enabled,
        facebook_app_id: settings.facebook_app_id,
        facebook_app_secret: settings.facebook_app_secret,
        global_meta_user_token: settings.global_meta_user_token,
        global_linkedin_access_token: settings.global_linkedin_access_token,
        global_linkedin_refresh_token: settings.global_linkedin_refresh_token,
        global_linkedin_token_expires_at: settings.global_linkedin_token_expires_at,
        global_linkedin_refresh_token_expires_at:
          settings.global_linkedin_refresh_token_expires_at,
        designer_email_map: settings.designer_email_map,
      });
      setSettings(response);
      setTokenStatuses(await loadTokenStatuses(props.session, props.onSessionUpdate));
      if (response.meta_token_result?.message) {
        props.onNotice(response.meta_token_result.message, "success");
      } else if (response.linkedin_token_result?.message) {
        props.onNotice(response.linkedin_token_result.message, "success");
      } else if (response.warnings?.length) {
        props.onNotice(`Settings saved with warnings: ${response.warnings.join(" | ")}`, "error");
      } else {
        props.onNotice(response.message || "Settings saved.", "success");
      }
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "Unable to save settings.", "error");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleUserSave(): Promise<void> {
    setSavingUser(true);
    try {
      const payload: Record<string, unknown> = {
        username: userForm.username.trim(),
        display_name: userForm.display_name.trim(),
        email: userForm.email.trim(),
        role: userForm.role,
        is_active: userForm.is_active,
      };
      if (userForm.password) {
        payload.password = userForm.password;
      }

      const response = editingUsername
        ? await updateUserRecord(
            props.session,
            props.onSessionUpdate,
            editingUsername,
            payload,
          )
        : await createUserRecord(props.session, props.onSessionUpdate, payload);

      if (response.username === props.session.user.username) {
        props.onSessionUpdate({
          ...props.session,
          user: {
            ...props.session.user,
            display_name: response.display_name,
            email: response.email,
            role: response.role,
            is_active: response.is_active,
            is_owner: response.is_owner,
            available_tabs: response.available_tabs,
            username: response.username,
          },
        });
      }

      await refreshAll();
      setEditingUsername(null);
      setUserForm(EMPTY_USER_FORM);
      props.onNotice(editingUsername ? "User updated." : "User created.", "success");
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "Unable to save the user.", "error");
    } finally {
      setSavingUser(false);
    }
  }

  async function handleUserDelete(username: string): Promise<void> {
    if (!window.confirm(`Delete user ${username}?`)) {
      return;
    }
    try {
      await deleteUserRecord(props.session, props.onSessionUpdate, username);
      await refreshAll();
      if (editingUsername === username) {
        setEditingUsername(null);
        setUserForm(EMPTY_USER_FORM);
      }
      props.onNotice("User deleted.", "success");
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "Unable to delete the user.", "error");
    }
  }

  if (loading) {
    return (
      <div className="view-grid">
        <SectionCard title="Settings" subtitle="Loading developer workspace controls.">
          <EmptyState text="Loading settings..." />
        </SectionCard>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="view-grid">
        <SectionCard title="Settings" subtitle="Developer-only global controls.">
          <EmptyState text="Settings data is not available." />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="view-grid">
      <SectionCard
        title="Global settings"
        subtitle="Developer-only app defaults, shared credentials, and email routing."
        actions={
          <button className="secondary-button" onClick={() => void refreshAll()} type="button">
            Refresh
          </button>
        }
      >
        <div className="settings-grid">
          <div className="settings-status-card">
            <p className="detail-label">Meta</p>
            <strong>{settings.meta_global?.status || "unknown"}</strong>
            <p>{settings.meta_global?.time_left_text || "No expiry data"}</p>
          </div>
          <div className="settings-status-card">
            <p className="detail-label">LinkedIn</p>
            <strong>{settings.linkedin_global?.status || "unknown"}</strong>
            <p>{settings.linkedin_global?.time_left_text || "No expiry data"}</p>
          </div>
        </div>

        <div className="form-grid">
          <Field label="App name">
            <input
              onChange={(event) => setSettings((current) => (current ? { ...current, app_name: event.target.value } : current))}
              value={settings.app_name}
            />
          </Field>
          <Field label="Default Post Time">
            <input
              onChange={(event) => setSettings((current) => (current ? { ...current, default_post_time: event.target.value } : current))}
              type="time"
              value={settings.default_post_time}
            />
          </Field>
          <Field label="Timezone">
            <input
              onChange={(event) => setSettings((current) => (current ? { ...current, timezone: event.target.value } : current))}
              value={settings.timezone}
            />
          </Field>
          <Field label="Auto Schedule">
            <select
              onChange={(event) => setSettings((current) => (current ? { ...current, auto_schedule: event.target.value } : current))}
              value={settings.auto_schedule}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </Field>
          <Field label="Notifications">
            <select
              onChange={(event) =>
                setSettings((current) =>
                  current ? { ...current, notification_enabled: event.target.value } : current,
                )
              }
              value={settings.notification_enabled}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </Field>
          <Field label="Live Posting">
            <select
              onChange={(event) =>
                setSettings((current) =>
                  current ? { ...current, live_posting_enabled: event.target.value } : current,
                )
              }
              value={settings.live_posting_enabled}
            >
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          </Field>
          <Field label="Facebook App ID">
            <input
              onChange={(event) => setSettings((current) => (current ? { ...current, facebook_app_id: event.target.value } : current))}
              value={settings.facebook_app_id}
            />
          </Field>
          <Field label="Facebook App Secret">
            <input
              onChange={(event) => setSettings((current) => (current ? { ...current, facebook_app_secret: event.target.value } : current))}
              type="password"
              value={settings.facebook_app_secret}
            />
          </Field>
          <Field label="Global Meta User Token">
            <textarea
              onChange={(event) =>
                setSettings((current) =>
                  current ? { ...current, global_meta_user_token: event.target.value } : current,
                )
              }
              rows={4}
              value={settings.global_meta_user_token}
            />
          </Field>
          <Field label="Designer Email Routing" hint="One mapping per line in the form Name=email@example.com">
            <textarea
              onChange={(event) =>
                setSettings((current) =>
                  current ? { ...current, designer_email_map: event.target.value } : current,
                )
              }
              rows={4}
              value={settings.designer_email_map}
            />
          </Field>
          <Field label="Global LinkedIn Access Token">
            <textarea
              onChange={(event) =>
                setSettings((current) =>
                  current
                    ? { ...current, global_linkedin_access_token: event.target.value }
                    : current,
                )
              }
              rows={4}
              value={settings.global_linkedin_access_token}
            />
          </Field>
          <Field label="Global LinkedIn Refresh Token">
            <textarea
              onChange={(event) =>
                setSettings((current) =>
                  current
                    ? { ...current, global_linkedin_refresh_token: event.target.value }
                    : current,
                )
              }
              rows={4}
              value={settings.global_linkedin_refresh_token}
            />
          </Field>
          <Field label="LinkedIn Token Expires">
            <input
              onChange={(event) =>
                setSettings((current) =>
                  current
                    ? { ...current, global_linkedin_token_expires_at: event.target.value }
                    : current,
                )
              }
              type="datetime-local"
              value={isoToLocalInput(settings.global_linkedin_token_expires_at)}
            />
          </Field>
          <Field label="LinkedIn Refresh Expires">
            <input
              onChange={(event) =>
                setSettings((current) =>
                  current
                    ? {
                        ...current,
                        global_linkedin_refresh_token_expires_at: event.target.value,
                      }
                    : current,
                )
              }
              type="datetime-local"
              value={isoToLocalInput(settings.global_linkedin_refresh_token_expires_at)}
            />
          </Field>
        </div>

        <div className="form-actions">
          <button
            className="primary-button"
            disabled={savingSettings}
            onClick={() => void handleSettingsSave()}
            type="button"
          >
            {savingSettings ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Scheduler and token health" subtitle="Operational visibility for the dev backend.">
        <div className="settings-grid">
          <div>
            <p className="detail-label">Scheduler</p>
            <strong>{props.scheduler.running ? "Running" : "Stopped"}</strong>
            <p>{props.scheduler.scheduled_jobs} jobs registered</p>
          </div>
          <div>
            <p className="detail-label">Global posture</p>
            <strong>{asEnabled(settings.live_posting_enabled)}</strong>
            <p>Notifications {asEnabled(settings.notification_enabled).toLowerCase()}</p>
          </div>
        </div>

        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Next Run</th>
              </tr>
            </thead>
            <tbody>
              {props.scheduler.jobs.length ? (
                props.scheduler.jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.id}</td>
                    <td>{formatDateTime(job.next_run)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2}>No jobs</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Platform</th>
                <th>Account</th>
                <th>Days Left</th>
                <th>Needs Refresh</th>
              </tr>
            </thead>
            <tbody>
              {tokenStatuses.length ? (
                tokenStatuses.map((row) => (
                  <tr key={row.id}>
                    <td>{row.page_name}</td>
                    <td>{row.platform}</td>
                    <td>{row.account_name || "-"}</td>
                    <td>{row.days_until_expiry ?? "-"}</td>
                    <td>
                      <StatusPill
                        label={row.needs_refresh ? "Yes" : "No"}
                        tone={row.needs_refresh ? "warn" : "good"}
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>No token data</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="User management" subtitle="Users are global. Active designer users become planner dropdown options automatically.">
        <div className="dual-grid">
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Email</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length ? (
                  users.map((user) => (
                    <tr key={user.username}>
                      <td>{user.display_name}</td>
                      <td>{user.username}</td>
                      <td>{user.is_owner ? "owner" : user.role}</td>
                      <td>
                        <StatusPill
                          label={user.is_active ? "Active" : "Inactive"}
                          tone={user.is_active ? "good" : "warn"}
                        />
                      </td>
                      <td>{user.email || "-"}</td>
                      <td>
                        <div className="inline-actions">
                          <button
                            className="secondary-button"
                            onClick={() => {
                              setEditingUsername(user.username);
                              setUserForm(toUserForm(user));
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="danger-button"
                            disabled={user.is_owner}
                            onClick={() => void handleUserDelete(user.username)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>No users configured.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="workspace-main">
            <h3>{editingUsername ? `Edit ${editingUsername}` : "Create User"}</h3>
            <div className="form-grid">
              <Field label="Username">
                <input
                  disabled={!!editingUsername}
                  onChange={(event) =>
                    setUserForm((current) => ({ ...current, username: event.target.value }))
                  }
                  value={userForm.username}
                />
              </Field>
              <Field label="Display Name">
                <input
                  onChange={(event) =>
                    setUserForm((current) => ({ ...current, display_name: event.target.value }))
                  }
                  value={userForm.display_name}
                />
              </Field>
              <Field label="Email">
                <input
                  onChange={(event) =>
                    setUserForm((current) => ({ ...current, email: event.target.value }))
                  }
                  type="email"
                  value={userForm.email}
                />
              </Field>
              <Field label="Role">
                <select
                  disabled={users.find((item) => item.username === editingUsername)?.is_owner}
                  onChange={(event) =>
                    setUserForm((current) => ({
                      ...current,
                      role: event.target.value as UserFormState["role"],
                    }))
                  }
                  value={userForm.role}
                >
                  <option value="developer">developer</option>
                  <option value="admin">admin</option>
                  <option value="designer">designer</option>
                </select>
              </Field>
              <Field label="Password" hint={editingUsername ? "Leave blank to keep the current password." : "Minimum 8 characters."}>
                <input
                  onChange={(event) =>
                    setUserForm((current) => ({ ...current, password: event.target.value }))
                  }
                  type="password"
                  value={userForm.password}
                />
              </Field>
              <label className="checkbox-field">
                <input
                  checked={userForm.is_active}
                  onChange={(event) =>
                    setUserForm((current) => ({ ...current, is_active: event.target.checked }))
                  }
                  type="checkbox"
                />
                <span>User active</span>
              </label>
            </div>
            <div className="form-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setEditingUsername(null);
                  setUserForm(EMPTY_USER_FORM);
                }}
                type="button"
              >
                Reset
              </button>
              <button
                className="primary-button"
                disabled={savingUser}
                onClick={() => void handleUserSave()}
                type="button"
              >
                {savingUser ? "Saving..." : editingUsername ? "Save User" : "Create User"}
              </button>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
