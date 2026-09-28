// Two decimals, as a balance reads. Below a dollar, significant digits instead, so a reply that cost
// $0.0042 does not read as $0.00.
export function usd(amount: number): string {
  const small = amount > 0 && amount < 1 ? { minimumSignificantDigits: 2, maximumSignificantDigits: 3 } : {};
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', ...small }).format(amount);
}
