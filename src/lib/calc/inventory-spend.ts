export function netInventorySpend(input: { itemCostsCents: number[] }): number {
  return input.itemCostsCents.reduce((a, b) => a + b, 0);
}
