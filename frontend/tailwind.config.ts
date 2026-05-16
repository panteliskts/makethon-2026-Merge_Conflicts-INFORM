import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        background:     "var(--color-bg)",
        sidebar:        "var(--color-sidebar)",
        card:           "var(--color-card)",
        "card-border":  "var(--color-card-border)",
        accent:         "var(--color-accent)",
        "accent-hover": "var(--color-accent-hover)",
        ember:          "var(--color-ember)",
        moss:           "var(--color-moss)",
        paper:          "var(--color-paper)",
        ink:            "var(--color-ink)",
        muted:          "var(--color-muted)",
        "text-primary":   "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
      },
      spacing: {
        section: "var(--section-gap)",
      },
      maxWidth: {
        prose: "65ch",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
        "4xl": "2rem",
      },
      transitionTimingFunction: {
        expo:   "cubic-bezier(0.16, 1, 0.3, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      transitionDuration: {
        DEFAULT: "160ms",
      },
      boxShadow: {
        diffuse: "0 20px 60px -20px rgba(0,0,0,0.08), 0 4px 16px -4px rgba(0,0,0,0.06)",
        accent:  "0 8px 32px -8px color-mix(in srgb, var(--color-accent) 40%, transparent)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.55s cubic-bezier(0.16,1,0.3,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
