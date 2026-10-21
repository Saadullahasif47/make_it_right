/** @type {import("prettier").Config} */
const config = {
  printWidth: 100,
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindStylesheet: "./src/app/globals.css",
  tailwindFunctions: ["cn"],
};

export default config;
