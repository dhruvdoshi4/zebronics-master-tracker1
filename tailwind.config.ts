import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: false,
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;

