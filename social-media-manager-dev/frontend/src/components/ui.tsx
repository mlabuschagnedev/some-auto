import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type BadgeTone = "neutral" | "good" | "warn" | "bad" | "info";

export function Icon(props: { name: string; className?: string }) {
  const common = {
    className: props.className || "icon",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  };

  switch (props.name) {
    case "dashboard":
      return (
        <svg {...common}>
          <path d="M4 5.5h6v6H4z" />
          <path d="M14 5.5h6v3.5h-6z" />
          <path d="M14 13h6v5.5h-6z" />
          <path d="M4 15h6v3.5H4z" />
        </svg>
      );
    case "projects":
      return (
        <svg {...common}>
          <path d="M4 7.5h16" />
          <path d="M7 4.5h10a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10a3 3 0 0 1 3-3z" />
          <path d="M9 12h6" />
          <path d="M9 16h4" />
        </svg>
      );
    case "planner":
      return (
        <svg {...common}>
          <path d="M7 3.5v3" />
          <path d="M17 3.5v3" />
          <path d="M4.5 8.5h15" />
          <path d="M6.5 5.5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2z" />
          <path d="M8 12h2" />
          <path d="M12 12h2" />
          <path d="M16 12h1" />
          <path d="M8 16h2" />
          <path d="M12 16h2" />
        </svg>
      );
    case "analytics":
      return (
        <svg {...common}>
          <path d="M4.5 19.5h15" />
          <path d="M7 16v-5" />
          <path d="M12 16V6" />
          <path d="M17 16v-8" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <path d="M4 12h4l2-5 4 10 2-5h4" />
        </svg>
      );
    case "notifications":
      return (
        <svg {...common}>
          <path d="M18 9.5a6 6 0 0 0-12 0c0 7-2.5 7-2.5 7h17S18 16.5 18 9.5z" />
          <path d="M9.8 19a2.4 2.4 0 0 0 4.4 0" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z" />
          <path d="M19.4 15a1.8 1.8 0 0 0 .3 2l.1.1-2 3.4-.2-.1a1.8 1.8 0 0 0-2 .2 8 8 0 0 1-1.5.6 1.8 1.8 0 0 0-1.4 1.4v.3H8.8v-.3a1.8 1.8 0 0 0-1.3-1.4 8 8 0 0 1-1.5-.6 1.8 1.8 0 0 0-2-.2l-.2.1-2-3.4.1-.1a1.8 1.8 0 0 0 .3-2 8 8 0 0 1-.2-1.6A1.8 1.8 0 0 0 .8 12l-.3-.1V8.1l.3-.1A1.8 1.8 0 0 0 2 6.6c0-.5.1-1.1.3-1.6a1.8 1.8 0 0 0-.3-2l-.1-.1 2-3.4.2.1a1.8 1.8 0 0 0 2-.2c.5-.2 1-.4 1.5-.6A1.8 1.8 0 0 0 8.8 1.4v-.3h3.9v.3A1.8 1.8 0 0 0 14 2.8c.5.2 1 .4 1.5.6a1.8 1.8 0 0 0 2 .2l.2-.1 2 3.4-.1.1a1.8 1.8 0 0 0-.3 2c.2.5.3 1.1.3 1.6a1.8 1.8 0 0 0 1.2 1.4l.3.1v3.8l-.3.1a1.8 1.8 0 0 0-1.4 1.1z" />
        </svg>
      );
    case "help":
      return (
        <svg {...common}>
          <path d="M9.4 9a2.7 2.7 0 1 1 4.5 2c-1 .8-1.9 1.3-1.9 2.8" />
          <path d="M12 17h.01" />
          <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <path d="M10.8 18.1a7.3 7.3 0 1 1 0-14.6 7.3 7.3 0 0 1 0 14.6z" />
          <path d="m16.2 16.2 4.3 4.3" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M20 7v5h-5" />
          <path d="M4 17v-5h5" />
          <path d="M18.2 9a6.5 6.5 0 0 0-10.7-2.5L4 10" />
          <path d="M5.8 15a6.5 6.5 0 0 0 10.7 2.5L20 14" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...common}>
          <path d="m9 6 6 6-6 6" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
          <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
        </svg>
      );
    case "filter":
      return (
        <svg {...common}>
          <path d="M4 6h16" />
          <path d="M7 12h10" />
          <path d="M10 18h4" />
        </svg>
      );
    case "sun":
      return (
        <svg {...common}>
          <path d="M12 4V2" />
          <path d="M12 22v-2" />
          <path d="m4.9 4.9-1.4-1.4" />
          <path d="m20.5 20.5-1.4-1.4" />
          <path d="M4 12H2" />
          <path d="M22 12h-2" />
          <path d="m4.9 19.1-1.4 1.4" />
          <path d="m20.5 3.5-1.4 1.4" />
          <path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
        </svg>
      );
    case "moon":
      return (
        <svg {...common}>
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.7 8.7 0 1 0 20.5 14.5z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
  }
}

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    icon?: string;
  },
) {
  const { className, variant = "secondary", icon, children, ...rest } = props;
  return (
    <button className={`btn btn-${variant}${className ? ` ${className}` : ""}`} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function IconButton(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: string;
    label: string;
    variant?: ButtonVariant;
  },
) {
  const { className, icon, label, variant = "ghost", ...rest } = props;
  return (
    <button
      aria-label={label}
      className={`icon-btn icon-btn-${variant}${className ? ` ${className}` : ""}`}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Card(props: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card${props.className ? ` ${props.className}` : ""}`}>
      {props.title || props.description || props.actions ? (
        <div className="card-header">
          <div>
            {props.title ? <h2>{props.title}</h2> : null}
            {props.description ? <p>{props.description}</p> : null}
          </div>
          {props.actions ? <div className="card-actions">{props.actions}</div> : null}
        </div>
      ) : null}
      {props.children}
    </section>
  );
}

export function SectionCard(props: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Card actions={props.actions} description={props.subtitle} title={props.title}>
      {props.children}
    </Card>
  );
}

export function PageHeader(props: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {props.eyebrow ? <p className="eyebrow">{props.eyebrow}</p> : null}
        <h1>{props.title}</h1>
        {props.description ? <p>{props.description}</p> : null}
        {props.meta ? <div className="page-meta">{props.meta}</div> : null}
      </div>
      {props.actions ? <div className="page-actions">{props.actions}</div> : null}
    </header>
  );
}

export function Badge(props: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`badge badge-${props.tone || "neutral"}`}>{props.children}</span>;
}

export function StatCard(props:
  | {
      label: string;
      value: string;
      helper: string;
      trend?: string;
      tone?: BadgeTone;
    }
  | {
      eyebrow: string;
      title: string;
      value: string;
      tone?: "default" | "accent";
    }
) {
  const label = "label" in props ? props.label : props.eyebrow;
  const helper = "helper" in props ? props.helper : props.title;
  const trend = "trend" in props ? props.trend : undefined;
  const badgeTone: BadgeTone =
    !("tone" in props) || !props.tone
      ? "info"
      : props.tone === "accent"
        ? "info"
        : props.tone === "default"
          ? "neutral"
          : props.tone;

  return (
    <article className="stat-card">
      <div className="stat-card-top">
        <p>{label}</p>
        {trend ? <Badge tone={badgeTone}>{trend}</Badge> : null}
      </div>
      <strong>{props.value}</strong>
      <span>{helper}</span>
    </article>
  );
}

export function StatusPill(props: {
  label: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return <Badge tone={props.tone || "neutral"}>{props.label}</Badge>;
}

export function EmptyState(props:
  | {
      title: string;
      description: string;
      action?: ReactNode;
    }
  | {
      text: string;
    }
) {
  const title = "title" in props ? props.title : "Nothing here yet";
  const description = "description" in props ? props.description : props.text;
  const action = "action" in props ? props.action : undefined;

  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name="plus" />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function Field(props: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
      {props.hint ? <small>{props.hint}</small> : null}
      {props.error ? <small className="field-error">{props.error}</small> : null}
    </label>
  );
}

export function TextInput(
  props: InputHTMLAttributes<HTMLInputElement> & {
    icon?: string;
  },
) {
  const { icon, className, ...rest } = props;
  return (
    <div className={`input-shell${icon ? " input-shell-icon" : ""}${className ? ` ${className}` : ""}`}>
      {icon ? <Icon name={icon} /> : null}
      <input {...rest} />
    </div>
  );
}

export function ProgressBar(props: { value: number; label?: string }) {
  const value = Math.max(0, Math.min(100, props.value));
  return (
    <div className="progress" aria-label={props.label} aria-valuemax={100} aria-valuemin={0} aria-valuenow={value} role="progressbar">
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

export function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{props.label}</strong>
        {props.description ? <small>{props.description}</small> : null}
      </span>
      <input
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

export function Modal(props: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  if (!props.open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-modal="true" className={`modal-panel${props.className ? ` ${props.className}` : ""}`} role="dialog">
        <div className="modal-header">
          <div>
            <h2>{props.title}</h2>
            {props.description ? <p>{props.description}</p> : null}
          </div>
          <IconButton icon="close" label="Close modal" onClick={props.onClose} />
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer ? <div className="modal-footer">{props.footer}</div> : null}
      </section>
    </div>
  );
}

export function ResponsiveTable<T>(props: {
  columns: Array<{ key: string; label: string; render: (item: T) => ReactNode }>;
  items: T[];
  getKey: (item: T) => string | number;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => (
            <tr key={props.getKey(item)}>
              {props.columns.map((column) => (
                <td data-label={column.label} key={column.key}>
                  {column.render(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
