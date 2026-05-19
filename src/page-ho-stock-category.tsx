import { Navigate } from "react-router-dom";

/** Legacy path — open default category with dropdown on the detail page. */
export function HoStockCategoryPage() {
  return <Navigate to="/app/ho-stock/category/monitor" replace />;
}
