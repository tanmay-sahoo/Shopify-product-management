import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f4f7fb",
        ink: "#122033",
        muted: "#64748b",
        line: "#dbe4f0",
        panel: "#ffffff",
        brand: "#2563eb",
        brandSoft: "#dbeafe",
        success: "#15803d",
        warning: "#d97706",
        danger: "#dc2626"
      },
      boxShadow: {
        panel: "0 18px 48px rgba(15, 23, 42, 0.08)"
      },
      borderRadius: {
        xl2: "1.25rem"
      }
    }
  },
  plugins: []
};

export default config;
