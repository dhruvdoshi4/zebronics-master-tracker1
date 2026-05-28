import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./use-auth";
import { getDefaultAppPath } from "./tenants";
import {
  clearWelcomeShown,
  getWelcomeConfig,
  isWelcomePending,
} from "./welcome-users";

export function WelcomeSplashPage() {
  const { user, isLoading, session } = useAuth();
  const welcomeEmail = user?.email ?? session?.user?.email ?? null;
  const config = getWelcomeConfig(welcomeEmail);
  const shouldShow = isWelcomePending() && Boolean(config);

  useEffect(() => {
    if (shouldShow) {
      clearWelcomeShown();
    }
  }, [shouldShow]);

  if (!isLoading && !session) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={getDefaultAppPath(user?.email ?? session?.user?.email)} replace />;
}
