import { formatUnits, parseUnits } from "viem";

// One formatter per unit: USDC/credits use 6 decimals, LONG/SHORT/WAVE use 18.
export const CREDIT_DECIMALS = 6;
export const TOKEN_DECIMALS = 18;

function trim(value: string) {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export function fmtUsdc(value: bigint, maxDecimals = 4) {
  const number = Number(formatUnits(value, CREDIT_DECIMALS));
  return number.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

export function fmtMoney(value: bigint) {
  const number = Number(formatUnits(value, CREDIT_DECIMALS));
  return `$${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// LONG, SHORT and WAVE shares; keeps tiny balances legible instead of rounding them to zero.
export function fmtToken(value: bigint, maxDecimals = 8) {
  const full = formatUnits(value, TOKEN_DECIMALS);
  const [whole, fraction = ""] = full.split(".");
  return trim(`${whole}.${fraction.slice(0, maxDecimals)}`) || "0";
}

export function parseCredits(value: string) {
  return parsePositive(value, CREDIT_DECIMALS);
}

export function parseToken(value: string) {
  return parsePositive(value, TOKEN_DECIMALS);
}

function parsePositive(value: string, decimals: number) {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) throw new Error("Enter a valid positive amount.");
  const [, fraction = ""] = value.trim().split(".");
  if (fraction.length > decimals) throw new Error(`At most ${decimals} decimal places are supported.`);
  const amount = parseUnits(value.trim(), decimals);
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  return amount;
}

export function fmtPercentChange(percent: number | null) {
  if (percent === null || Number.isNaN(percent)) return "—";
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

// A 1e18-scaled gross return (1.0 = flat) shown as a percentage change.
export function fmtReturn(grossReturnX18: bigint) {
  return fmtPercentChange(Number(grossReturnX18) / 1e16 - 100);
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
