export type InvoiceCalculationLine = { quantity:number; unitPrice:number; discount:number };

export const toMinor = (value:number) => Math.round((Number.isFinite(value) ? value : 0) * 100);

export function calculateInvoiceTotals(lines:InvoiceCalculationLine[], vatRateBps = 1500) {
  const calculatedLines = lines.map((line) => {
    const unitPriceMinor = Math.max(0, toMinor(line.unitPrice));
    const grossMinor = Math.max(0, Math.trunc(line.quantity)) * unitPriceMinor;
    const discountMinor = Math.min(Math.max(0, toMinor(line.discount)), grossMinor);
    const taxableMinor = grossMinor - discountMinor;
    const vatMinor = Math.round(taxableMinor * vatRateBps / 10_000);
    return { unitPriceMinor, grossMinor, discountMinor, taxableMinor, vatMinor, lineTotalMinor:taxableMinor + vatMinor };
  });
  return {
    lines:calculatedLines,
    subtotalMinor:calculatedLines.reduce((sum,line)=>sum+line.grossMinor,0),
    discountMinor:calculatedLines.reduce((sum,line)=>sum+line.discountMinor,0),
    vatMinor:calculatedLines.reduce((sum,line)=>sum+line.vatMinor,0),
    totalMinor:calculatedLines.reduce((sum,line)=>sum+line.lineTotalMinor,0),
  };
}
