#!/usr/bin/env node

import { config as loadDotenv } from "dotenv";
import { Command, type Command as CommandType } from "commander";
import { resolve } from "node:path";

import { runPipelinePhase, runFullPipeline } from "./pipelineCommands.js";
import type { IPipelinePhaseName } from "./pipelineCommands.js";
import { PHASE_DESCRIPTIONS, formatGhaStepName } from "./phaseDescriptions.js";
import { runOptionsSchema } from "./types.js";

const loadEnvForWorkspace = (workspaceRoot: string): void => {
  loadDotenv({ path: resolve(workspaceRoot, ".env") });
  loadDotenv({ path: resolve(workspaceRoot, "../.env") });
};

const resolveConfigPath = (workspaceRoot: string, config: string): string =>
  config.startsWith("/") ? resolve(config) : resolve(workspaceRoot, config);

const parseRunOptions = (flags: {
  config: string;
  workspaceRoot: string;
  repo?: string;
  prNumber?: number;
  prUrl?: string;
  dryRun?: boolean;
  reportsOnly?: boolean;
  skipCodeAgent?: boolean;
  changedFiles?: string[];
}) => {
  const workspaceRoot = resolve(flags.workspaceRoot);
  loadEnvForWorkspace(workspaceRoot);

  return runOptionsSchema.parse({
    config: resolveConfigPath(workspaceRoot, flags.config),
    repo: flags.repo,
    prNumber: flags.prNumber,
    prUrl: flags.prUrl,
    workspaceRoot,
    dryRun: flags.dryRun ?? false,
    reportsOnly: flags.reportsOnly ?? false,
    skipCodeAgent: flags.skipCodeAgent ?? false,
    changedFiles: flags.changedFiles,
  });
};

const addSharedRunOptions = (command: CommandType): CommandType =>
  command
    .requiredOption("--config <path>", "Path to instrument.config.json")
    .option("--repo <slug>", "GitHub repo slug, e.g. owner/repo")
    .option("--pr-number <number>", "Pull request number", (value) => Number(value))
    .option("--pr-url <url>", "Pull request URL for cloud code agent")
    .option("--workspace-root <path>", "Workspace root", process.cwd())
    .option("--dry-run", "Simulate agents and Mixpanel deploy", false)
    .option("--reports-only", "Skip Mixpanel deployment", false)
    .option("--skip-code-agent", "Skip code instrumentation agent", false)
    .option("--changed-files <files...>", "Changed files relative to workspace root");

const addPhaseCommand = (
  program: CommandType,
  name: IPipelinePhaseName,
  description: string,
): void => {
  addSharedRunOptions(
    program
      .command(name)
      .description(description)
      .action(async (flags) => {
        const options = parseRunOptions(flags);
        const result = await runPipelinePhase(name, options);

        console.log(JSON.stringify(result, null, 2));
      }),
  );
};

const program = new Command();

program
  .name("instrument")
  .description("Orchestrate the Instrument PR analytics pipeline")
  .version("0.1.0");

addSharedRunOptions(
  program
    .command("run")
    .description("Run the full Instrument pipeline for a pull request")
    .action(async (flags) => {
      const options = parseRunOptions(flags);
      const result = await runFullPipeline(options);

      console.log(JSON.stringify(result, null, 2));
    }),
);

addPhaseCommand(program, "pre-scan", formatGhaStepName(PHASE_DESCRIPTIONS["pre-scan"]));
addPhaseCommand(
  program,
  "code-agent",
  formatGhaStepName(PHASE_DESCRIPTIONS["code-agent"]),
);
addPhaseCommand(
  program,
  "review",
  formatGhaStepName(PHASE_DESCRIPTIONS["standards-review"]),
);
addPhaseCommand(
  program,
  "dashboard",
  formatGhaStepName(PHASE_DESCRIPTIONS["dashboard-agent"]),
);
addPhaseCommand(
  program,
  "deploy",
  formatGhaStepName(PHASE_DESCRIPTIONS["mixpanel-deploy"]),
);
addPhaseCommand(
  program,
  "comment",
  formatGhaStepName(PHASE_DESCRIPTIONS["github-comment"]),
);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Instrument CLI failed";
  console.error(message);
  process.exit(1);
});
