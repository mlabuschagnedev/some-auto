export function SectionCard(props: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="section-card">
      <div className="section-heading">
        <div>
          <h2>{props.title}</h2>
          {props.subtitle ? <p>{props.subtitle}</p> : null}
        </div>
        {props.actions ? <div className="section-actions">{props.actions}</div> : null}
      </div>
      {props.children}
    </section>
  );
}

export function StatCard(props: {
  eyebrow: string;
  title: string;
  value: string;
  tone?: "default" | "accent";
}) {
  return (
    <article className={`stat-card ${props.tone === "accent" ? "stat-card-accent" : ""}`}>
      <p className="eyebrow">{props.eyebrow}</p>
      <h3>{props.value}</h3>
      <p>{props.title}</p>
    </article>
  );
}

export function StatusPill(props: {
  label: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const tone = props.tone || "neutral";
  return <span className={`status-pill status-pill-${tone}`}>{props.label}</span>;
}

export function EmptyState(props: { text: string }) {
  return <p className="empty-state">{props.text}</p>;
}

export function Field(props: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
      {props.hint ? <small>{props.hint}</small> : null}
    </label>
  );
}
