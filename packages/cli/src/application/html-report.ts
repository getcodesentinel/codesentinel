import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CodeSentinelReport } from "@codesentinel/reporter";

const HTML_REPORT_DIR = ".codesentinel/report";

const getBundledHtmlAppPath = (): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), "html-report-app");

const serializeReportBootstrap = (report: CodeSentinelReport): string =>
  `window.__CODESENTINEL_REPORT__ = ${JSON.stringify(report).replaceAll("</", "<\\/")};\n`;

const escapeInlineScript = (script: string): string =>
  script
    .replaceAll("</script", "<\\/script")
    .replaceAll("<script", "\\x3Cscript")
    .replaceAll("<!--", "\\x3C!--")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");

const ensureDirectory = async (directoryPath: string): Promise<void> => {
  await mkdir(directoryPath, { recursive: true });
};

const readReferencedAssets = async (
  appPath: string,
  indexHtml: string,
): Promise<{ styles: string[]; scripts: string[] }> => {
  const stylesheetPaths = [
    ...indexHtml.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*>/g),
  ]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);

  const styles = await Promise.all(
    stylesheetPaths.map(async (href) => readFile(resolve(appPath, href), "utf8")),
  );

  const scriptPaths = [...indexHtml.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/g)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);

  const scripts = await Promise.all(
    scriptPaths.map(async (src) => readFile(resolve(appPath, src), "utf8")),
  );

  return { styles, scripts };
};

const inlineBuiltHtml = async (appPath: string, report: CodeSentinelReport): Promise<string> => {
  const indexHtml = await readFile(resolve(appPath, "index.html"), "utf8");
  const { styles, scripts } = await readReferencedAssets(appPath, indexHtml);

  const htmlWithoutExternalAssets = indexHtml
    .replace(/\s*<link[^>]+rel=["']stylesheet["'][^>]*>\s*/g, "")
    .replace(/\s*<script[^>]+src=["'][^"']+["'][^>]*><\/script>\s*/g, "");

  const inlineStyles = styles.map((style) => `<style>\n${style}\n</style>`).join("\n");
  const bootstrapScript = `<script>\n${serializeReportBootstrap(report)}</script>`;
  const inlineScripts = scripts
    .map((script) => `<script>\n${escapeInlineScript(script)}\n</script>`)
    .join("\n");

  return htmlWithoutExternalAssets
    .replace("</head>", () => `${inlineStyles === "" ? "" : `${inlineStyles}\n`}</head>`)
    .replace(
      "</body>",
      () => `${bootstrapScript}\n${inlineScripts === "" ? "" : `${inlineScripts}\n`}</body>`,
    );
};

const assertHtmlAppAssets = async (assetPath: string): Promise<void> => {
  const assetStats = await stat(assetPath).catch(() => undefined);
  if (assetStats === undefined || !assetStats.isDirectory()) {
    throw new Error(
      `html_report_assets_missing: expected built app at ${assetPath}. Run the workspace build first.`,
    );
  }
};

export type WriteHtmlReportBundleOptions = {
  repositoryPath: string;
  outputPath?: string;
  bundledAppPath?: string;
};

export const resolveHtmlReportOutputPath = (
  repositoryPath: string,
  outputPath?: string,
): string => {
  const invocationCwd = process.env["INIT_CWD"] ?? process.cwd();
  return resolve(invocationCwd, outputPath ?? join(repositoryPath, HTML_REPORT_DIR));
};

export const writeHtmlReportBundle = async (
  report: CodeSentinelReport,
  options: WriteHtmlReportBundleOptions,
): Promise<string> => {
  const bundledAppPath = options.bundledAppPath ?? getBundledHtmlAppPath();
  await assertHtmlAppAssets(bundledAppPath);

  const outputPath = resolveHtmlReportOutputPath(options.repositoryPath, options.outputPath);
  await rm(outputPath, { recursive: true, force: true });
  await ensureDirectory(outputPath);
  await writeFile(
    resolve(outputPath, "index.html"),
    await inlineBuiltHtml(bundledAppPath, report),
    "utf8",
  );

  return outputPath;
};
