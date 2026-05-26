import { Navigate } from "react-router-dom";
import { useCatalogScope } from "./catalog-scope-context";

/** Legacy /app/analysis — nav goes straight to category analysis. */
export function AnalysisHubPage() {
  const { routePrefix } = useCatalogScope();
  return <Navigate to={`${routePrefix}/analysis/category`} replace />;
}
