import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  tsconfig: "./tsconfig.tsup.json",
  format: ["esm"],
  target: "node22",
  dts: true,
  sourcemap: true,
  clean: true,
});
