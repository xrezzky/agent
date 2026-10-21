import type { Config } from "tailwindcss";

/**
 * Konfigurasi Tailwind.
 * Tema mengikuti class `dark` pada elemen <html> (dikelola ThemeProvider).
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Palet netral dengan aksen elegan (identitas visual sendiri).
        ink: {
          50: "#f7f7f5",
          100: "#ececec",
          200: "#d9d9d6",
          300: "#b9b9b3",
          400: "#8a8a82",
          500: "#6b6b64",
          600: "#55554f",
          700: "#41413d",
          800: "#2a2a27",
          850: "#202020",
          900: "#171716",
          950: "#0e0e0d",
        },
        accent: {
          300: "#a7c7d9",
          400: "#7fa8c9",
          500: "#5b8db8",
          600: "#46719c",
          700: "#37597b",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.25s ease-out",
        "pulse-soft": "pulseSoft 1.6s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(2px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.45" },
          "50%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
