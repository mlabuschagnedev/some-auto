import { startTransition, useEffect, useEffectEvent, useState } from "react";
import {
  ApiError,
  clearStoredSession,
  loadWorkspaceData,
  loginWithPassword,
  logoutSession,
  readStoredSession,
  restoreStoredSession,
  writeStoredSession,
} from "./api";
import { AuthScreen } from "./components/auth-screen";
import { IntegrationsTab } from "./components/integrations-tab";
import { OverviewTab } from "./components/overview-tab";
import { PagesTab } from "./components/pages-tab";
import { PlanningTab } from "./components/planning-tab";
import { PostsTab } from "./components/posts-tab";
import { SettingsTab } from "./components/settings-tab";
import type { AuthUser, SessionPayload, WorkspaceData } from "./types";

type AppTab =
  | "overview"
  | "pages"
  | "scheduled"
  | "posted"
  | "planning"
  | "integrations"
  | "settings";

interface AppTabDefinition {
  id: AppTab;
  label: string;
  allowed: boolean;
}

function buildVisibleTabs(user: AuthUser | null): AppTabDefinition[] {
  if (!user) {
    return [];
  }

  const tabs = new Set(user.available_tabs);
  const definitions: AppTabDefinition[] = [
    { id: "overview", label: "Overview", allowed: true },
    { id: "pages", label: "Pages", allowed: tabs.has("pages") },
    { id: "scheduled", label: "Scheduled", allowed: tabs.has("scheduled") },
    { id: "posted", label: "Posted", allowed: tabs.has("posted") },
    { id: "planning", label: "Planning", allowed: tabs.has("planning") },
    {
      id: "integrations",
      label: "Integrations",
      allowed: user.role === "developer",
    },
    { id: "settings", label: "Settings", allowed: user.role === "developer" },
  ];
  return definitions.filter((tab) => tab.allowed);
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("overview");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" } | null>(null);

  const applySession = useEffectEvent((nextSession: SessionPayload | null) => {
    if (nextSession) {
      writeStoredSession(nextSession);
    } else {
      clearStoredSession();
    }

    startTransition(() => {
      setSession(nextSession);
      if (!nextSession) {
        setWorkspace(null);
        setActiveTab("overview");
      }
    });
  });

  const notify = useEffectEvent((text: string, tone: "success" | "error" = "success") => {
    setNotice({ text, tone });
    window.setTimeout(() => {
      setNotice((current) => (current?.text === text ? null : current));
    }, 3500);
  });

  const refreshWorkspace = useEffectEvent(async () => {
    if (!session) {
      return;
    }
    setWorkspaceLoading(true);
    setWorkspaceError(null);

    try {
      const nextWorkspace = await loadWorkspaceData(session, applySession);
      startTransition(() => {
        setWorkspace(nextWorkspace);
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        applySession(null);
        setWorkspaceError(error.message);
      } else {
        setWorkspaceError(
          error instanceof Error ? error.message : "Unable to load workspace data.",
        );
      }
    } finally {
      setWorkspaceLoading(false);
    }
  });

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const stored = readStoredSession();
      if (!stored) {
        setBooting(false);
        return;
      }

      try {
        const restored = await restoreStoredSession(stored, (nextSession) => {
          if (!cancelled) {
            applySession(nextSession);
          }
        });
        if (!cancelled && !restored) {
          applySession(null);
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
    if (session) {
      void refreshWorkspace();
    }
  }, [session]);

  const visibleTabs = buildVisibleTabs(session?.user ?? null);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(visibleTabs[0]?.id || "overview");
    }
  }, [activeTab, visibleTabs]);

  if (booting) {
    return (
      <main className="loading-shell">
        <div className="loading-panel">
          <p className="eyebrow">React + TypeScript Migration</p>
          <h1>Loading workspace</h1>
        </div>
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
            .then((nextSession) => applySession(nextSession))
            .catch((error: unknown) => {
              setAuthError(
                error instanceof Error
                  ? error.message
                  : "Unable to sign in with those credentials.",
              );
            })
            .finally(() => {
              setAuthBusy(false);
            });
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Dev frontend only</p>
          <h1>Sample SoMe-Auto</h1>
          <p className="topbar-copy">
            This dev frontend now carries the operational workflows directly,
            while the live site stays untouched.
          </p>
        </div>
        <div className="topbar-actions">
          <div className="identity-chip">
            <span>{session.user.display_name}</span>
            <strong>{session.user.role}</strong>
          </div>
          <button className="secondary-button" onClick={() => void refreshWorkspace()} type="button">
            {workspaceLoading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              void logoutSession(session, applySession);
            }}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>

      <nav className="tab-bar">
        {visibleTabs.map((tab) => (
          <button
            className={tab.id === activeTab ? "tab-button tab-button-active" : "tab-button"}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {workspaceError ? <p className="banner banner-error">{workspaceError}</p> : null}
      {notice ? (
        <p className={notice.tone === "error" ? "banner banner-error" : "banner"}>
          {notice.text}
        </p>
      ) : null}
      {workspaceLoading ? <p className="banner">Refreshing live data from the dev backend...</p> : null}

      {!workspace ? <p className="banner">Workspace data has not loaded yet.</p> : null}

      {workspace && activeTab === "overview" ? (
        <OverviewTab user={session.user} workspace={workspace} />
      ) : null}
      {workspace && activeTab === "pages" ? (
        <PagesTab
          canCreateDeletePages={session.user.role === "developer"}
          canEditPages={["developer", "admin"].includes(session.user.role)}
          canManageAccounts={session.user.role === "developer"}
          initialPages={workspace.pages}
          onNotice={notify}
          onSessionUpdate={applySession}
          onWorkspaceChanged={refreshWorkspace}
          session={session}
        />
      ) : null}
      {workspace && activeTab === "scheduled" ? (
        <PostsTab
          canManage={["developer", "admin"].includes(session.user.role)}
          canManualLinkedIn={session.user.is_owner}
          initialPosts={workspace.posts}
          mode="scheduled"
          onNotice={notify}
          onSessionUpdate={applySession}
          onWorkspaceChanged={refreshWorkspace}
          session={session}
        />
      ) : null}
      {workspace && activeTab === "posted" ? (
        <PostsTab
          canManage={["developer", "admin"].includes(session.user.role)}
          canManualLinkedIn={session.user.is_owner}
          initialPosts={workspace.posts}
          mode="posted"
          onNotice={notify}
          onSessionUpdate={applySession}
          onWorkspaceChanged={refreshWorkspace}
          session={session}
        />
      ) : null}
      {workspace && activeTab === "planning" ? (
        <PlanningTab
          canDeleteRows={["developer", "admin"].includes(session.user.role)}
          initialSheets={workspace.planningSheets}
          onNotice={notify}
          onSessionUpdate={applySession}
          onWorkspaceChanged={refreshWorkspace}
          session={session}
        />
      ) : null}
      {workspace && activeTab === "integrations" ? (
        <IntegrationsTab
          initialIntegrations={workspace.integrations}
          initialTokenStatuses={workspace.tokenStatuses}
          onNotice={notify}
          onSessionUpdate={applySession}
          pages={workspace.pages}
          session={session}
        />
      ) : null}
      {workspace && activeTab === "settings" ? (
        <SettingsTab
          onNotice={notify}
          onSessionUpdate={applySession}
          scheduler={workspace.scheduler}
          session={session}
        />
      ) : null}
    </main>
  );
}

