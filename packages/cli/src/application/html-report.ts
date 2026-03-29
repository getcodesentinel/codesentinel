import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CodeSentinelReport } from "@codesentinel/reporter";

const HTML_REPORT_DIR = ".codesentinel/report";
const HTML_REPORT_DATA_FILE = "report-data.js";

const getBundledHtmlAppPath = (): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), "html-report-app");

const injectReportDataScript = (indexHtml: string): string => {
  const scriptTag = `<script src="./${HTML_REPORT_DATA_FILE}"></script>`;
  if (indexHtml.includes(scriptTag)) {
    return indexHtml;
  }

  if (indexHtml.includes("</head>")) {
    return indexHtml.replace("</head>", `  ${scriptTag}\n</head>`);
  }

  return `${scriptTag}\n${indexHtml}`;
};

const serializeReportBootstrap = (report: CodeSentinelReport): string =>
  `window.__CODESENTINEL_REPORT__ = ${JSON.stringify(report).replaceAll("</", "<\\/")};\n`;

const ensureDirectory = async (directoryPath: string): Promise<void> => {
  await mkdir(directoryPath, { recursive: true });
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
  await ensureDirectory(outputPath);
  await cp(bundledAppPath, outputPath, { recursive: true, force: true });

  const indexPath = join(outputPath, "index.html");
  const indexHtml = await readFile(indexPath, "utf8");
  await writeFile(indexPath, injectReportDataScript(indexHtml), "utf8");
  await writeFile(
    join(outputPath, HTML_REPORT_DATA_FILE),
    serializeReportBootstrap(report),
    "utf8",
  );

  return outputPath;
};
