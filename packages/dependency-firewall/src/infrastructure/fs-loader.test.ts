import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { selectLockfile } from "./fs-loader.js";

const cleanupPaths: string[] = [];

const createTempDir = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "codesentinel-lock-select-"));
  cleanupPaths.push(root);
  return root;
};

afterEach(async () => {
  for (const path of cleanupPaths.splice(0, cleanupPaths.length)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("selectLockfile", () => {
  it("prefers pnpm lock when multiple lockfiles are present", async () => {
    const root = await createTempDir();
    await writeFile(join(root, "package-lock.json"), "{}", "utf8");
    await writeFile(join(root, "yarn.lock"), "", "utf8");
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    const selected = selectLockfile(root);
    expect(selected?.kind).toBe("pnpm");
  });
});
