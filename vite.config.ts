import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode ?? "development", process.cwd(), "");
  for (const key of Object.keys(env)) {
    if (!(key in process.env)) {
      process.env[key] = env[key];
    }
  }
  return {
    vite: {
      resolve: {
        alias: {
          "entities/lib/decode.js": path.resolve(__dirname, "node_modules/entities/lib/decode.js"),
          "entities/lib/encode.js": path.resolve(__dirname, "node_modules/entities/lib/encode.js"),
          "entities": path.resolve(__dirname, "node_modules/entities"),
        },
      },
    },
  };
});
