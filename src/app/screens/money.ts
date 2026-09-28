// Two decimals, as a balance reads. Below a dollar, significant digits instead, so a reply that cost
// $0.0042 does not read as $0.00.
export function usd(amount: number): string {
  const small = amount > 0 && amount < 1 ? { minimumSignificantDigits: 2, maximumSignificantDigits: 3 } : {};
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', ...small }).format(amount);
}

// Copilot's AI credits (1 credit = $0.01), to two decimals, or two significant digits below one.
export function creditAmount(amount: number): string {
  const digits = amount > 0 && amount < 1 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 2 };
  return new Intl.NumberFormat('ko-KR', digits).format(amount);
}

export const credits = (amount: number) => `${creditAmount(amount)} 크레딧`;
