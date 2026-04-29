import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "microCrud",
      publicPath: "auto",
      filename: "remoteEntry.js",
      exposes: {
        "./CrudPanel": "./src/CrudPanel.jsx"
      },
      shared: ["react", "react-dom"]
    })
  ],
  preview: {
    cors: true,
    headers: {
      "Access-Control-Allow-Origin": "*"
    }
  },
  build: { target: "esnext" }
});
