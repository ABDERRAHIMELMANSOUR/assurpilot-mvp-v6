/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Deep navy used for the sidebar and the auth screen.
        navy: {
          950: "#0B132B",
          900: "#0D1B2A",
          800: "#1B263B",
          700: "#243447",
        },
        // Brand accent. `brand.DEFAULT` is the electric cyan; the ramp gives
        // tints for hovers, rings and translucent fills.
        brand: {
          DEFAULT: "#00D2C8",
          50: "#E6FBFA",
          100: "#C0F5F2",
          200: "#8AECE7",
          300: "#4FE0D9",
          400: "#1FD5CC",
          500: "#00D2C8",
          600: "#06B6D4",
          700: "#0E8F9B",
          800: "#116B75",
          900: "#124F57",
        },
      },
      boxShadow: {
        // Ultra-soft card elevation.
        soft: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        lift: "0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 6px -2px rgb(15 23 42 / 0.05)",
        // Glow behind the brand button / logo.
        glow: "0 0 0 1px rgb(0 210 200 / 0.20), 0 8px 24px -6px rgb(0 210 200 / 0.45)",
      },
      borderRadius: {
        xl2: "0.875rem",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
      },
      keyframes: {
        "fade-rise": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-rise": "fade-rise 0.25s ease-out both",
      },
    },
  },
  plugins: [],
};
