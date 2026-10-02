import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        carolina: {
          DEFAULT: "#7BAFD4",
          hover: "#93BFDF",
          subtle: "#12263A",
          on: "#081018",
          canvas: "#090D13",
          surface: "#101722",
          "surface-raised": "#182230",
          border: "#243242",
          primary: "#F0F6FC",
          secondary: "#8B9BB0",
        },
      },
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
        "fade-in": "fadeIn 0.2s ease-out",
        "scale-in": "scaleIn 0.2s ease-out",
        "slide-in-right": "slideInRight 0.25s ease-out",
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
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        scaleIn: {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        slideInRight: {
          from: { opacity: "0.5", transform: "translateX(100%)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
