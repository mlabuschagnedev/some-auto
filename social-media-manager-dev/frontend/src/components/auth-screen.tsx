export function AuthScreen(props: {
  busy: boolean;
  error: string | null;
  onSubmit: (username: string, password: string) => void;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-copy">
          <p className="eyebrow">Dev Frontend</p>
          <h1>MSS SoME-Auto</h1>
          <p>
            This dev workspace now carries the operational frontend directly.
            The live site remains untouched until you choose to ship changes.
          </p>
        </div>
        <LoginForm
          busy={props.busy}
          error={props.error}
          onSubmit={props.onSubmit}
        />
      </section>
    </main>
  );
}

function LoginForm(props: {
  busy: boolean;
  error: string | null;
  onSubmit: (username: string, password: string) => void;
}) {
  return (
    <form
      className="auth-form"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        props.onSubmit(
          String(formData.get("username") || ""),
          String(formData.get("password") || ""),
        );
      }}
    >
      <label>
        <span>Username</span>
        <input
          autoComplete="username"
          disabled={props.busy}
          name="username"
          placeholder="Enter your username"
        />
      </label>
      <label>
        <span>Password</span>
        <input
          autoComplete="current-password"
          disabled={props.busy}
          name="password"
          placeholder="Enter your password"
          type="password"
        />
      </label>
      {props.error ? <p className="form-error">{props.error}</p> : null}
      <button className="primary-button" disabled={props.busy} type="submit">
        {props.busy ? "Signing in..." : "Enter workspace"}
      </button>
    </form>
  );
}
