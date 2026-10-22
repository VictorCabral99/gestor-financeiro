import type { CSSProperties, ReactNode } from "react";

function onPhone(): boolean {
  return document.documentElement.classList.contains("shell");
}

/** No celular, o painel abre e fecha. No computador, fica sempre aberto. */
export function HomeFold({
  title,
  hint,
  action,
  children,
  style,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  if (!onPhone()) {
    return (
      <div className="panel" style={style}>
        <div className="section-head">
          <div>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {hint ? (
              <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
                {hint}
              </p>
            ) : null}
          </div>
          {action}
        </div>
        {children}
      </div>
    );
  }

  return (
    <details className="panel home-fold" style={style}>
      <summary>
        <h2>{title}</h2>
      </summary>
      <div className="home-fold-body">
        {action ? <div className="home-fold-action">{action}</div> : null}
        {children}
      </div>
    </details>
  );
}
