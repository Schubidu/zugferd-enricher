/** Exact integer-cent arithmetic; ambiguous currency numbers remain unknown. */
export function parseCents(input: string): bigint | null {
  let value = input.trim().replace(/^(?:EUR|€)\s*/i, "").replace(/\s*(?:EUR|€)$/i, "");
  value = value.replace(/\u00a0/g, " ").trim();
  const negative = value.startsWith("-");
  if (negative || value.startsWith("+")) value = value.slice(1).trim();
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  const decimal = Math.max(comma, dot);
  if (decimal < 0 || value.length - decimal !== 3) return null;
  const integerPart = value.slice(0, decimal);
  const centsPart = value.slice(decimal + 1);
  const separator = decimal === comma ? "." : ",";
  const groups = integerPart.split(separator);
  if (!/^\d{2}$/.test(centsPart)) return null;
  if (integerPart.includes(decimal === comma ? "," : ".")) return null;
  if (groups.length > 1) {
    if (!/^\d{1,3}$/.test(groups[0] ?? "") ||
        !groups.slice(1).every(group => /^\d{3}$/.test(group))) return null;
  } else if (!/^\d+$/.test(integerPart)) return null;
  const cents = BigInt(groups.join("")) * 100n + BigInt(centsPart);
  return negative ? -cents : cents;
}

export function checkTotals(
  net: string | null,
  tax: string | null,
  gross: string | null,
): { status: "unknown" | "match" | "mismatch"; deltaCents?: string } {
  const parsed = [net, tax, gross].map(x => x === null ? null : parseCents(x));
  if (parsed.some(x => x === null)) return { status: "unknown" };
  const delta = parsed[0]! + parsed[1]! - parsed[2]!;
  return { status: delta === 0n ? "match" : "mismatch", deltaCents: delta.toString() };
}

/**
 * Adds only explicitly extracted line amounts, with no assumption about whether
 * the amounts are net, gross or exempt from VAT. Incomplete input has no total.
 */
export function sumLineItemAmounts(items: readonly { amount: string }[]): {
  totalCents: bigint | null;
  itemCount: number;
  invalidCount: number;
} {
  let total = 0n;
  let invalidCount = 0;
  for (const item of items) {
    const amount = parseCents(item.amount);
    if (amount === null) invalidCount++;
    else total += amount;
  }
  return {
    totalCents: items.length > 0 && invalidCount === 0 ? total : null,
    itemCount: items.length,
    invalidCount,
  };
}

/** Deterministic German euro formatting without converting bigint to number. */
export function formatEuroCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const euros = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fractional = (absolute % 100n).toString().padStart(2, "0");
  return (negative ? "-" : "") + euros + "," + fractional + " €";
}
