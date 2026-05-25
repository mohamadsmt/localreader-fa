import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Vazirmatn Variable", "system-ui", "sans-serif"],
        fa: ["Vazirmatn Variable", "system-ui", "sans-serif"],
        reader: ["Charter", "Georgia", "Vazirmatn Variable", "serif"]
      },
      colors: {
        ink: "#171717",
        paper: "#fbfaf7",
        line: "#e6e0d7",
        saffron: "#c47a2c",
        moss: "#5c6f55"
      }
    }
  },
  plugins: []
} satisfies Config;
