import { basesForChannel, type Basis, type Channel } from "../lib/ledger";

type Props = {
  channel: Channel;
  value: Basis;
  onChange: (basis: Basis) => void;
};

export function BasisToggle({ channel, value, onChange }: Props) {
  const options = basesForChannel(channel);
  if (options.length <= 1) return null;

  return (
    <div className="tabs lens-tabs basis-tabs" role="tablist" aria-label="Base temporal">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          className={value === o.id ? "active" : ""}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
