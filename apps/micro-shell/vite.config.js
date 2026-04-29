import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";
import { defineConfig } from "vite";

const remoteListUrl = process.env.VITE_REMOTE_MICRO_LIST_URL || "http://localhost:5111/remoteEntry.js";
const remoteDetailUrl = process.env.VITE_REMOTE_MICRO_DETAIL_URL || "http://localhost:5112/remoteEntry.js";
const remoteCrudUrl = process.env.VITE_REMOTE_MICRO_CRUD_URL || "http://localhost:5113/remoteEntry.js";

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "micro_shell",
      remotes: {
        microList: remoteListUrl,
        microDetail: remoteDetailUrl,
        microCrud: remoteCrudUrl
      },
      shared: ["react", "react-dom"]
    })
  ],
  build: {
    target: "esnext"
  }
});
