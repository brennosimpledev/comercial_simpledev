import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#00B2FF",
          dark: "#0090d4",
          light: "#AFEFFF",
        },
        navy: {
          DEFAULT: "#0A203A",
          mid: "#102B49",
          light: "#163E6D",
        },
      },
    },
  },
  plugins: [],
};

export default config;
