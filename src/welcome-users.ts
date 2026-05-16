export type WelcomeTheme = "boss" | "intern";

export type WelcomeUserConfig = {
  email: string;
  firstName: string;
  title: string;
  theme: WelcomeTheme;
};

const WELCOME_USERS: WelcomeUserConfig[] = [
  {
    email: "hari@zebronics.com",
    firstName: "Hari",
    title: "Category Boss",
    theme: "boss",
  },
  {
    email: "ram@zebronics.com",
    firstName: "Ram",
    title: "The Category Intern",
    theme: "intern",
  },
];

const WELCOME_SESSION_KEY = "zebronics_pending_welcome";

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getWelcomeConfig(email: string | null | undefined): WelcomeUserConfig | null {
  if (!email) return null;
  const key = normalizeLoginEmail(email);
  return WELCOME_USERS.find((u) => u.email === key) ?? null;
}

export function markWelcomePending(): void {
  sessionStorage.setItem(WELCOME_SESSION_KEY, "1");
}

export function isWelcomePending(): boolean {
  return sessionStorage.getItem(WELCOME_SESSION_KEY) === "1";
}

export function clearWelcomeShown(): void {
  sessionStorage.removeItem(WELCOME_SESSION_KEY);
}

export function clearWelcomePending(): void {
  sessionStorage.removeItem(WELCOME_SESSION_KEY);
}
