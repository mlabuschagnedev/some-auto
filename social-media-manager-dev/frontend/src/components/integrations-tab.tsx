import { useEffect, useState } from "react";
import { loadIntegrationAccounts, loadTokenStatuses } from "../api";
import type {
  IntegrationAccount,
  PageRecord,
  SessionPayload,
  TokenStatusRow,
} from "../types";
import { EmptyState, SectionCard, StatusPill } from "./ui";

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not set";
  }
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function IntegrationsTab(props: {
  pages: PageRecord[];
  initialIntegrations: IntegrationAccount[];
  initialTokenStatuses: TokenStatusRow[];
  session: SessionPayload;
  onSessionUpdate: (nextSession: SessionPayload | null) => void;
  onNotice: (message: string, tone?: "success" | "error") => void;
}) {
  const [pageId, setPageId] = useState<number | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationAccount[]>(props.initialIntegrations);
  const [tokenStatuses, setTokenStatuses] = useState<TokenStatusRow[]>(props.initialTokenStatuses);
  const [loading, setLoading] = useState(false);

  async function refreshData(nextPageId = pageId): Promise<void> {
    setLoading(true);
    try {
      const [integrationItems, tokenItems] = await Promise.all([
        loadIntegrationAccounts(
          props.session,
          props.onSessionUpdate,
          nextPageId === null ? undefined : nextPageId,
        ),
        loadTokenStatuses(props.session, props.onSessionUpdate),
      ]);
      setIntegrations(integrationItems);
      setTokenStatuses(
        nextPageId === null
          ? tokenItems
          : tokenItems.filter((row) => row.page_id === nextPageId),
      );
    } catch (error) {
      props.onNotice(
        error instanceof Error ? error.message : "Unable to load integration data.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setIntegrations(props.initialIntegrations);
    setTokenStatuses(props.initialTokenStatuses);
  }, [props.initialIntegrations, props.initialTokenStatuses]);

  return (
    <div className="view-grid">
      <SectionCard
        title="Integrations"
        subtitle="Publishing readiness and token health in the new workspace."
        actions={
          <button className="secondary-button" onClick={() => void refreshData()} type="button">
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        }
      >
        <div className="toolbar">
          <select
            className="search-input"
            onChange={(event) => {
              const nextPageId = event.target.value ? Number(event.target.value) : null;
              setPageId(nextPageId);
              void refreshData(nextPageId);
            }}
            value={pageId ?? ""}
          >
            <option value="">All pages</option>
            {props.pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.name}
              </option>
            ))}
          </select>
        </div>

        <div className="dual-grid">
          <SectionCard
            title="Publish readiness"
            subtitle="Accounts blocked by missing credentials or configuration."
          >
            {!integrations.length ? (
              <EmptyState text="No integration accounts found." />
            ) : (
              <div className="alert-list">
                {integrations.map((account) => (
                  <article className="alert-row" key={account.id}>
                    <div>
                      <h3>
                        {account.page_name} - {account.platform}
                      </h3>
                      <p>{account.account_name || "Unnamed account"}</p>
                      {account.missing_fields.length ? (
                        <p className="inline-error">
                          Missing: {account.missing_fields.join(", ")}
                        </p>
                      ) : null}
                    </div>
                    <StatusPill
                      label={account.ready_for_publish ? "Ready" : "Blocked"}
                      tone={account.ready_for_publish ? "good" : "warn"}
                    />
                  </article>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Token health"
            subtitle="Accounts that need token refresh attention."
          >
            {!tokenStatuses.length ? (
              <EmptyState text="No token rows found." />
            ) : (
              <div className="alert-list">
                {tokenStatuses.map((row) => (
                  <article className="alert-row" key={row.id}>
                    <div>
                      <h3>
                        {row.page_name} - {row.platform}
                      </h3>
                      <p>{row.account_name || "Unnamed account"}</p>
                      <p className="muted">Expires: {formatDateTime(row.expires_at)}</p>
                    </div>
                    <StatusPill
                      label={row.needs_refresh ? "Needs refresh" : "Healthy"}
                      tone={row.needs_refresh ? "warn" : "good"}
                    />
                  </article>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </SectionCard>
    </div>
  );
}
