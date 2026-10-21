import type { ReactNode } from "react";
import { BasisToggle } from "./BasisToggle";
import { ChannelTabs } from "./ChannelTabs";
import type { Basis, Channel } from "../lib/ledger";

type Props = {
  channel: Channel;
  basis: Basis;
  onChannel: (c: Channel) => void;
  onBasis: (b: Basis) => void;
  right?: ReactNode;
};

export function LensBar({ channel, basis, onChannel, onBasis, right }: Props) {
  return (
    <div className="lens-bar">
      <div className="lens-bar-main">
        <ChannelTabs value={channel} onChange={onChannel} />
        <BasisToggle channel={channel} value={basis} onChange={onBasis} />
      </div>
      {right ? <div className="lens-bar-right">{right}</div> : null}
    </div>
  );
}
