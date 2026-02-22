import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  tsconfig: "./tsconfig.tsup.json",
  format: ["esm"],
  target: "node24",
  noExternal: [/^@codesentinel\//],
  external: ["typescript"],
  dts: true,
  sourcemap: true,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
