/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0f172a",
          700: "#334155",
          500: "#64748b",
          300: "#cbd5e1",
        },
        surface: {
          DEFAULT: "#ffffff",
          soft: "#f7f8fa",
          line: "#e6e8ee",
        },
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.12)",
      },
      borderRadius: {
        xl2: "18px",
      },
    },
  },
  plugins: [],
};
