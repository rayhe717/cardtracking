/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#FAF3E1",
        creamAlt: "#F5E7C6",
        accent: "#FA8112",
        dark: "#222222",
      },
    },
  },
  plugins: [],
};
