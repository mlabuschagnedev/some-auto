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
  const pages = Array.isArray(props.workspace.pages) ? props.workspace.pages : [];
  const planningSheets = Array.isArray(props.workspace.planningSheets)
    ? props.workspace.planningSheets
    : [];
  const integrations = Array.isArray(props.workspace.integrations)
    ? props.workspace.integrations
    : [];
  const tokenStatuses = Array.isArray(props.workspace.tokenStatuses)
    ? props.workspace.tokenStatuses
    : [];
  const posts = Array.isArray(props.workspace.posts) ? props.workspace.posts : [];
  const schedulerJobs = Array.isArray(props.workspace.scheduler?.jobs)
    ? props.workspace.scheduler.jobs
    : [];

  const totalAccounts = pages.reduce(
    (count, page) => count + page.social_accounts.length,
    0,
  );

  const totalRows = planningSheets.reduce(
    (count, sheet) => count + sheet.row_count,
    0,
  );

  const integrationTotal = integrations.length > 0 ? integrations.length : totalAccounts;

  const readyIntegrations =
    integrations.length > 0
      ? integrations.filter((account) => account.ready_for_publish).length
      : totalAccounts;

  const tokenWarnings = tokenStatuses.filter((row) => row.needs_refresh).length;

  return (
    <div className="view-grid">
      <div className="stats-grid">
        <StatCard eyebrow="Footprint" title="Managed pages" value={String(pages.length)} />
        <StatCard eyebrow="Accounts" title="Connected platform accounts" value={String(totalAccounts)} />
        <StatCard eyebrow="Planning" title="Rows in monthly sheets" value={String(totalRows)} />
        <StatCard
          eyebrow="Queue"
          title="Posts in queue or processing"
          value={String(
            posts.filter((post) =>
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
                label={props.workspace.scheduler?.running ? "Running" : "Stopped"}
                tone={props.workspace.scheduler?.running ? "good" : "bad"}
              />
              <span>{props.workspace.scheduler?.scheduled_jobs ?? 0} jobs registered</span>
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
          {schedulerJobs.map((job) => (
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