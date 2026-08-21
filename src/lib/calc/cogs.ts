export function lineCogs(quantity: number, unitCostCents: number): number {
  return quantity * unitCostCents;
}

export function totalCogs(lines: { quantity: number; unitCostCents: number | null }[]): number {
  return lines.reduce((sum, l) => sum + (l.unitCostCents == null ? 0 : lineCogs(l.quantity, l.unitCostCents)), 0);
}
