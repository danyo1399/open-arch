import { fileURLToPath } from "node:url";

/** Absolute path of the skill folder (contains SKILL.md and references/). */
export const skillDir = fileURLToPath(new URL("./open-arch/", import.meta.url));
