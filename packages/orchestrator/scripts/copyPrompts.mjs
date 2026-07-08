import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const promptsSrc = join(root, "../src/prompts");
const promptsDest = join(root, "../dist/prompts");

mkdirSync(promptsDest, { recursive: true });
cpSync(promptsSrc, promptsDest, { recursive: true });
