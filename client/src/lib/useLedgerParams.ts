import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { currentMonth } from "./format";
import {
  parseBasis,
  parseChannel,
  type Basis,
  type Channel,
} from "./ledger";

type Options = {
  /** Inclui month na URL (default true). */
  withMonth?: boolean;
  /** Inclui year na URL. */
  withYear?: boolean;
};

export function useLedgerParams(options: Options = {}) {
  const withMonth = options.withMonth !== false;
  const withYear = !!options.withYear;
  const [searchParams, setSearchParams] = useSearchParams();

  const monthParam = searchParams.get("month");
  const yearParam = searchParams.get("year");
  const channel = parseChannel(searchParams.get("canal"));
  const basis = parseBasis(searchParams.get("base"), channel);

  const month =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentMonth();
  const year = yearParam ? Number(yearParam) : Number(month.slice(0, 4));

  const patch = useCallback(
    (next: Partial<{ month: string; year: number; channel: Channel; basis: Basis }>) => {
      const nextChannel = next.channel ?? channel;
      let nextBasis = next.basis ?? basis;
      if (next.channel && next.basis === undefined) {
        // ao trocar canal, escolhe default inteligente
        nextBasis = parseBasis(null, nextChannel);
      } else {
        nextBasis = parseBasis(nextBasis, nextChannel);
      }

      const params: Record<string, string> = {
        canal: nextChannel,
        base: nextBasis,
      };
      if (withMonth) {
        params.month = next.month ?? month;
      }
      if (withYear) {
        params.year = String(next.year ?? year);
      }
      setSearchParams(params);
    },
    [basis, channel, month, setSearchParams, withMonth, withYear, year],
  );

  const query = useMemo(
    () => {
      const q = new URLSearchParams({
        canal: channel,
        base: basis,
      });
      if (withMonth) q.set("month", month);
      if (withYear) q.set("year", String(year));
      return q.toString();
    },
    [basis, channel, month, withMonth, withYear, year],
  );

  return {
    month,
    year,
    channel,
    basis,
    query,
    setMonth: (m: string) => patch({ month: m }),
    setYear: (y: number) => patch({ year: y }),
    setChannel: (c: Channel) => patch({ channel: c }),
    setBasis: (b: Basis) => patch({ basis: b }),
    patch,
    movementsHref: `/despesas?${query}`,
    monthHref: `/?${query}`,
  };
}
