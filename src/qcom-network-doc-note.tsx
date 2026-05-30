/** Network DOC formula for QCom channel dashboards. */
export function QcomNetworkDocExplanation({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-sm text-zinc-500"}>
      QCom DRR = Zepto + Blinkit + Big Basket + Instamart DRR for the same catalogue SKU.
      Amazon and Flipkart DRR come from the latest sellout master across all ecom workspaces
      (Monitor, Personal Audio, Rithika, Pravin, Home Audio) when the HO row has an ASIN or FSN.
      Network DOC = (HO + Gurgaon + Amazon inv + Flipkart inv + all QCom inv) ÷ (Amazon DRR +
      Flipkart DRR + QCom DRR), rounded down. Rows below 90 days are highlighted.
    </p>
  );
}
