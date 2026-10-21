import { CHANNELS, type Channel } from "../lib/ledger";

type Props = {
  value: Channel;
  onChange: (channel: Channel) => void;
};

export function ChannelTabs({ value, onChange }: Props) {
  return (
    <div className="tabs lens-tabs" role="tablist" aria-label="Canal">
      {CHANNELS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          aria-selected={value === c.id}
          title={c.hint}
          className={value === c.id ? "active" : ""}
          onClick={() => onChange(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
