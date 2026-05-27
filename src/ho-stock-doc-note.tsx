/** One-line DOC formula for HO Stock (Monitor+Projector tenant). */
export function HoStockDocExplanation({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-sm text-zinc-500 dark:text-zinc-400"}>
      Amazon DRR = <strong>DRR</strong> or <strong>15 Days Avg</strong>; Flipkart DRR ={" "}
      <strong>DRR</strong> or <strong>7 Days Avg</strong>. PO uses <strong>28 Days Avg</strong>.
      DOC = (HO + Gurgaon +
      channel inventory) ÷ (Amazon DRR + Flipkart DRR), rounded down.
    </p>
  );
}
