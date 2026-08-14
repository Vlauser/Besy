/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // Классы font-display и font-ui были в разметке, но в конфиге их не
      // существовало — то есть не делали ничего, и типографики у приложения
      // не было никакой. Системный шрифт выбран намеренно: на iOS это SF
      // Pro, и он выглядит роднее любого подгружаемого.
      fontFamily: {
        ui: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
