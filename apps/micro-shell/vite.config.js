import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "micro_shell",
      remotes: {
        microList: "http://localhost:5111/remoteEntry.js",
        microDetail: "http://localhost:5112/remoteEntry.js",
        microCrud: "http://localhost:5113/remoteEntry.js"
      },
      shared: ["react", "react-dom"]
    })
  ],
  build: {
    target: "esnext"
  }
});
