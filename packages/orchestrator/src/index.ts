#!/usr/bin/env node

import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import { resolve } from "node:path";

import { runPipeline } from "./runPipeline.js";
import { runOptionsSchema } from "./types.js";

const program = new Command();

program
  .name("instrument")
  .description("Orchestrate the Instrument PR analytics pipeline")
  .version("0.1.0");

program
  .command("run")
  .description("Run the full Instrument pipeline for a pull request")
  .requiredOption("--config <path>", "Path to instrument.config.json")
  .option("--repo <slug>", "GitHub repo slug, e.g. owner/repo")
  .option("--pr-number <number>", "Pull request number", (value) => Number(value))
  .option("--pr-url <url>", "Pull request URL for cloud code agent")
  .option("--workspace-root <path>", "Workspace root", process.cwd())
  .option("--dry-run", "Simulate agents and Mixpanel deploy", false)
  .option("--reports-only", "Skip Mixpanel deployment", false)
  .option("--skip-code-agent", "Skip code instrumentation agent", false)
  .option("--changed-files <files...>", "Changed files relative to workspace root")
  .action(async (flags) => {
    const workspaceRoot = resolve(flags.workspaceRoot);
    loadDotenv({ path: resolve(workspaceRoot, ".env") });
    loadDotenv({ path: resolve(workspaceRoot, "../.env") });

    const configPath = flags.config.startsWith("/")
      ? resolve(flags.config)
      : resolve(workspaceRoot, flags.config);

    const options = runOptionsSchema.parse({
      config: configPath,
      repo: flags.repo,
      prNumber: flags.prNumber,
      prUrl: flags.prUrl,
      workspaceRoot,
      dryRun: flags.dryRun,
      reportsOnly: flags.reportsOnly,
      skipCodeAgent: flags.skipCodeAgent,
      changedFiles: flags.changedFiles,
    });

    const result = await runPipeline(options);

    console.log(JSON.stringify(result, null, 2));
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Instrument CLI failed";
  console.error(message);
  process.exit(1);
});
