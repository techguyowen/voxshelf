import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        dyslexic: [
          "OpenDyslexic",
          '"Atkinson Hyperlegible"',
          '"Comic Sans MS"',
          "Verdana",
          "sans-serif",
        ],
        readable: ['"Atkinson Hyperlegible"', "system-ui", "sans-serif"],
      },
      animation: {
        "pulse-glow": "pulseGlow 1.6s ease-in-out infinite",
        "fade-up": "fadeUp 0.25s ease-out",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.75" },
        },
        fadeUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
