import type { AuthUser, WorkspaceData } from "../types";
import { SectionCard, StatCard, StatusPill } from "./ui";

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not set";
  }
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function OverviewTab(props: { workspace: WorkspaceData; user: AuthUser }) {
  const totalAccounts = props.workspace.pages.reduce(
    (count, page) => count + page.social_accounts.length,
    0,
  );
  const totalRows = props.workspace.planningSheets.reduce(
    (count, sheet) => count + sheet.row_count,
    0,
  );
  const integrationTotal =
    props.workspace.integrations.length > 0 ? props.workspace.integrations.length : totalAccounts;
  const readyIntegrations =
    props.workspace.integrations.length > 0
      ? props.workspace.integrations.filter((account) => account.ready_for_publish).length
      : totalAccounts;
  const tokenWarnings = props.workspace.tokenStatuses.filter((row) => row.needs_refresh).length;

  return (
    <div className="view-grid">
      <div className="stats-grid">
        <StatCard eyebrow="Footprint" title="Managed pages" value={String(props.workspace.pages.length)} />
        <StatCard eyebrow="Accounts" title="Connected platform accounts" value={String(totalAccounts)} />
        <StatCard eyebrow="Planning" title="Rows in monthly sheets" value={String(totalRows)} />
        <StatCard
          eyebrow="Queue"
          title="Posts in queue or processing"
          value={String(
            props.workspace.posts.filter((post) =>
              ["draft", "scheduled", "posting", "manual_pending"].includes(post.status),
            ).length,
          )}
          tone="accent"
        />
      </div>

      <SectionCard title="System snapshot" subtitle="Current operational readout from the dev backend.">
        <div className="meta-grid">
          <div>
            <p className="detail-label">Scheduler</p>
            <div className="status-row">
              <StatusPill
                label={props.workspace.scheduler.running ? "Running" : "Stopped"}
                tone={props.workspace.scheduler.running ? "good" : "bad"}
              />
              <span>{props.workspace.scheduler.scheduled_jobs} jobs registered</span>
            </div>
          </div>
          <div>
            <p className="detail-label">Integrations</p>
            <div className="status-row">
              <StatusPill
                label={`${readyIntegrations}/${integrationTotal} ready`}
                tone={readyIntegrations === integrationTotal ? "good" : "warn"}
              />
              <span>Accounts ready to publish</span>
            </div>
          </div>
          <div>
            <p className="detail-label">Token warnings</p>
            <div className="status-row">
              <StatusPill
                label={tokenWarnings === 0 ? "Clear" : `${tokenWarnings} attention`}
                tone={tokenWarnings === 0 ? "good" : "warn"}
              />
              <span>Developer token health checks</span>
            </div>
          </div>
          <div>
            <p className="detail-label">Signed in as</p>
            <div className="status-row">
              <StatusPill label={props.user.role} />
              <span>{props.user.display_name}</span>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Upcoming scheduler jobs"
        subtitle="These are the background jobs currently registered in the Flask scheduler."
      >
        <div className="job-list">
          {props.workspace.scheduler.jobs.map((job) => (
            <article className="job-item" key={job.id}>
              <div>
                <h3>{job.id}</h3>
                <p>Next run: {formatDateTime(job.next_run)}</p>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
