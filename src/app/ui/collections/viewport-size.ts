export class RowSizes {
  private readonly tree: Float64Array;
  private readonly sizes: Float64Array;
  constructor(readonly count: number, estimate: number) {
    this.tree = new Float64Array(count + 1);
    this.sizes = new Float64Array(count).fill(estimate);
    for (let i = 1; i <= count; i++) this.tree[i] = (i & -i) * estimate;
  }
  set(index: number, size: number): number {
    const delta = size - this.sizes[index]!;
    this.sizes[index] = size;
    for (let i = index + 1; i <= this.count; i += i & -i) this.tree[i]! += delta;
    return delta;
  }
  offset(end: number): number {
    let sum = 0;
    for (let i = end; i > 0; i -= i & -i) sum += this.tree[i]!;
    return sum;
  }
  at(offset: number): number {
    let index = 0;
    let sum = 0;
    for (let bit = 2 ** Math.floor(Math.log2(this.count || 1)); bit > 0; bit = Math.floor(bit / 2)) {
      const next = index + bit;
      if (next <= this.count && sum + this.tree[next]! <= offset) {
        index = next;
        sum += this.tree[next]!;
      }
    }
    return Math.min(index, Math.max(0, this.count - 1));
  }
}
