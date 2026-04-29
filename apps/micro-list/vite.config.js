import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "microList",
      publicPath: "auto",
      filename: "remoteEntry.js",
      exposes: {
        "./ListApp": "./src/ListApp.jsx"
      },
      shared: ["react", "react-dom"]
    })
  ],
  build: {
    target: "esnext"
  }
});
