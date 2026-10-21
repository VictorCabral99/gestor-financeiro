import { useState } from "react";
import { money } from "../lib/format";
import type { CategoryTreeNode } from "../lib/expenseHelpers";

type Props = {
  nodes: CategoryTreeNode[];
  /** Total geral para % do período (pai). */
  grandTotal: number;
  /** Se true, começa com pais que têm subcategorias expandidos. */
  defaultExpanded?: boolean;
};

export function CategoryBreakdown({
  nodes,
  grandTotal,
  defaultExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (!defaultExpanded) return new Set();
    return new Set(nodes.filter((n) => n.children.length > 1 || n.children.some((c) => !c.direct)).map((n) => n.key));
  });

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (nodes.length === 0) {
    return <p className="empty">Nenhuma despesa neste período.</p>;
  }

  return (
    <div className="cat-breakdown">
      {nodes.map((node) => {
        const pct =
          grandTotal > 0 ? Math.round((node.total / grandTotal) * 100) : 0;
        const hasSubs = node.children.some((c) => !c.direct) || node.children.length > 1;
        const open = expanded.has(node.key);
        const showChildren = hasSubs && open;

        return (
          <div className="cat-node" key={node.key}>
            <button
              type="button"
              className={`cat-parent${hasSubs ? "" : " cat-parent-static"}`}
              onClick={() => hasSubs && toggle(node.key)}
              aria-expanded={hasSubs ? open : undefined}
              disabled={!hasSubs}
            >
              <span className="cat-parent-main">
                {hasSubs && (
                  <span className="cat-chevron" aria-hidden>
                    {open ? "▾" : "▸"}
                  </span>
                )}
                <span
                  className="cat-dot"
                  style={{ background: node.color }}
                  aria-hidden
                />
                <strong>{node.name}</strong>
                {hasSubs && (
                  <span className="muted cat-subcount">
                    {node.children.filter((c) => !c.direct).length ||
                      node.children.length}{" "}
                    sub
                  </span>
                )}
              </span>
              <span className="cat-parent-side">
                <span className="amount">{money(node.total)}</span>
                <span className="muted">{pct}%</span>
              </span>
            </button>
            <div className="year-bar-track cat-bar">
              <div
                className="year-bar-fill"
                style={{ width: `${pct}%`, background: node.color }}
              />
            </div>

            {showChildren && (
              <div className="cat-children">
                {node.children.map((child) => {
                  const childOfParent =
                    node.total > 0
                      ? Math.round((child.total / node.total) * 100)
                      : 0;
                  const childOfAll =
                    grandTotal > 0
                      ? Math.round((child.total / grandTotal) * 100)
                      : 0;
                  return (
                    <div className="cat-child" key={child.key}>
                      <div className="cat-child-main">
                        <span
                          className="cat-dot cat-dot-sm"
                          style={{ background: child.color }}
                          aria-hidden
                        />
                        <span className={child.direct ? "muted" : undefined}>
                          {child.name}
                        </span>
                      </div>
                      <div className="cat-child-side">
                        <span className="amount">{money(child.total)}</span>
                        <span className="muted">
                          {childOfParent}% da cat.
                          {grandTotal > 0 ? ` · ${childOfAll}%` : ""}
                        </span>
                      </div>
                      <div className="year-bar-track cat-bar cat-bar-child">
                        <div
                          className="year-bar-fill"
                          style={{
                            width: `${childOfParent}%`,
                            background: child.color,
                            opacity: child.direct ? 0.45 : 0.85,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
