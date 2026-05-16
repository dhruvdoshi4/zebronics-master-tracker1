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
const WELCOME_EMAIL_KEY = "zebronics_pending_welcome_email";

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getWelcomeConfig(email: string | null | undefined): WelcomeUserConfig | null {
  if (!email) return null;
  const key = normalizeLoginEmail(email);
  const exact = WELCOME_USERS.find((u) => u.email === key);
  if (exact) return exact;

  // Same mailbox, different casing / alias host still on zebronics.com
  const [local, domain] = key.split("@");
  if (!local || !domain) return null;
  if (!domain.endsWith("zebronics.com")) return null;

  if (local === "hari" || local.startsWith("hari.")) return WELCOME_USERS[0];
  if (local === "ram" || local.startsWith("ram.")) return WELCOME_USERS[1];

  return null;
}

export function markWelcomePending(email: string): void {
  sessionStorage.setItem(WELCOME_SESSION_KEY, "1");
  sessionStorage.setItem(WELCOME_EMAIL_KEY, normalizeLoginEmail(email));
}

export function isWelcomePending(): boolean {
  return sessionStorage.getItem(WELCOME_SESSION_KEY) === "1";
}

export function getPendingWelcomeEmail(): string | null {
  const raw = sessionStorage.getItem(WELCOME_EMAIL_KEY);
  return raw ? normalizeLoginEmail(raw) : null;
}

export function clearWelcomeShown(): void {
  sessionStorage.removeItem(WELCOME_SESSION_KEY);
  sessionStorage.removeItem(WELCOME_EMAIL_KEY);
}
