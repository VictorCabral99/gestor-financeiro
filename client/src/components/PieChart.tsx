type Slice = { name: string; color: string; total: number };

type Props = {
  slices: Slice[];
  size?: number;
};

export function PieChart({ slices, size = 220 }: Props) {
  const total = slices.reduce((s, x) => s + x.total, 0);
  if (total <= 0) {
    return (
      <div className="pie-empty muted" style={{ width: size, height: size }}>
        Sem despesas
      </div>
    );
  }

  const r = size / 2;
  const cx = r;
  const cy = r;
  const radius = r - 4;

  let angle = -Math.PI / 2;
  const paths: { d: string; color: string; name: string }[] = [];

  for (const slice of slices) {
    const sweep = (slice.total / total) * Math.PI * 2;
    const end = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x1 = cx + radius * Math.cos(angle);
    const y1 = cy + radius * Math.sin(angle);
    const x2 = cx + radius * Math.cos(end);
    const y2 = cy + radius * Math.sin(end);
    const d =
      sweep >= Math.PI * 2 - 1e-6
        ? `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius} Z`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
    paths.push({ d, color: slice.color, name: slice.name });
    angle = end;
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Gráfico de categorias">
      {paths.map((p) => (
        <path key={p.name} d={p.d} fill={p.color} stroke="#fff" strokeWidth={2}>
          <title>{p.name}</title>
        </path>
      ))}
    </svg>
  );
}
