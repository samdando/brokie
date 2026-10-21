import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build works from any folder (GitHub Pages project sites etc.).
export default defineConfig({ plugins: [react()], base: "./", build: { target: "es2020" } });
