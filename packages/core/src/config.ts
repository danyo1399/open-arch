import { isMap } from "yaml";
import { FieldReader, parseFrontmatter } from "./frontmatter.js";
import { DEFAULT_CONFIG, type Diagnostic, type WorkspaceConfig } from "./types.js";

export const CONFIG_FILE = "open-arch.yaml";

export const DEFAULT_CONFIG_TEXT = `# open-arch workspace. Elements live in \`model/\`, views in \`views/\`.
version: 1
model: model
views: views
# Generated Mermaid preview in every view file: mermaid | none
preview: mermaid
`;

export function parseConfig(text: string): { config: WorkspaceConfig; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const config: WorkspaceConfig = { ...DEFAULT_CONFIG };
  const fm = parseFrontmatter(text, 1);
  for (const error of fm.doc.errors) {
    diagnostics.push({ severity: "error", rule: "config-invalid", message: error.message, path: CONFIG_FILE, line: fm.lineAt(error.pos[0]) });
  }
  if (fm.doc.errors.length || fm.doc.contents === null) return { config, diagnostics };
  if (!isMap(fm.doc.contents)) {
    diagnostics.push({ severity: "error", rule: "config-invalid", message: `${CONFIG_FILE} must be a YAML map.`, path: CONFIG_FILE, line: 1 });
    return { config, diagnostics };
  }

  const read = new FieldReader(fm, fm.doc.contents, CONFIG_FILE, diagnostics);
  const version = read.string("version");
  if (version !== undefined && version !== "1") {
    diagnostics.push({ severity: "error", rule: "config-invalid", message: `Unsupported workspace version ${version}; this tool reads version 1.`, path: CONFIG_FILE, line: read.line("version") });
  }
  for (const key of ["model", "views"] as const) {
    const value = read.string(key);
    if (value === undefined) continue;
    const clean = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    if (!clean || clean.startsWith("/") || clean.split("/").includes("..")) {
      diagnostics.push({ severity: "error", rule: "config-invalid", message: `\`${key}\` must be a folder inside the workspace.`, path: CONFIG_FILE, line: read.line(key) });
    } else {
      config[key] = clean;
    }
  }
  if (config.model === config.views) {
    diagnostics.push({ severity: "error", rule: "config-invalid", message: "`model` and `views` must be different folders.", path: CONFIG_FILE, line: read.line("views") });
  }
  const preview = read.string("preview");
  if (preview === "mermaid" || preview === "none") config.preview = preview;
  else if (preview !== undefined) {
    diagnostics.push({ severity: "error", rule: "config-invalid", message: "`preview` must be `mermaid` or `none`.", path: CONFIG_FILE, line: read.line("preview") });
  }
  return { config, diagnostics };
}
