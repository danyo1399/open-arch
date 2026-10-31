/**
 * Places outside the browser that workspace files are imported from and
 * exported to. A provider only copies files in and out: the workspaces
 * themselves live in the browser (library.ts), and nothing stays linked to the
 * file. Files on this device come first; cloud storage (Dropbox, iCloud Drive,
 * …) can be added as more providers.
 */
import { FILE_EXTENSION } from "@open-arch/core";
import { download } from "./hosts.js";

/** A file the user picked: a workspace, or a zip of them (transfer.ts reads both). */
export interface PickedFile {
  name: string;
  data: Uint8Array;
}

/** A file to export: a workspace's text, or a zip of several. */
export interface ExportFile {
  name: string;
  data: string | Uint8Array;
}

export interface FileProvider {
  id: string;
  importLabel: string;
  exportLabel: string;
  exportAllLabel: string;
  /** Ask the user for files to import. Resolves to none when they cancel. */
  pick(): Promise<PickedFile[]>;
  /** Save a copy of a file there. Resolves to false when the user cancels. */
  save(file: ExportFile): Promise<boolean>;
}

const ACCEPT = `${FILE_EXTENSION},application/json,.zip,application/zip`;

export async function readFiles(files: Iterable<File>): Promise<PickedFile[]> {
  return Promise.all([...files].map(async (file) => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) })));
}

/** <input type="file"> works in every browser, and lets the user pick several files at once. */
function pickLocalFiles(): Promise<PickedFile[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.multiple = true;
    input.hidden = true;
    const finish = (files: PickedFile[] | Promise<PickedFile[]>) => {
      input.remove();
      Promise.resolve(files).then(resolve, reject);
    };
    input.addEventListener("change", () => finish(readFiles(input.files ?? [])));
    input.addEventListener("cancel", () => finish([]));
    // Safari only opens the picker for an input that's in the page.
    document.body.append(input);
    input.click();
  });
}

interface SavePicker {
  showSaveFilePicker(options: object): Promise<{ createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }> }>;
}

const fileType = (name: string) =>
  name.endsWith(".zip")
    ? { description: "open-arch workspaces", mime: "application/zip", extension: ".zip" }
    : { description: "open-arch workspace", mime: "application/json", extension: FILE_EXTENSION };

/** Chrome and Edge ask where to save; other browsers download the file. */
async function saveLocalFile({ name, data }: ExportFile): Promise<boolean> {
  const type = fileType(name);
  if (!("showSaveFilePicker" in window)) {
    download(name, data as BlobPart, type.mime);
    return true;
  }
  try {
    const handle = await (window as unknown as SavePicker).showSaveFilePicker({
      id: "open-arch",
      suggestedName: name,
      types: [{ description: type.description, accept: { [type.mime]: [type.extension] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(data as BlobPart);
    await writable.close();
    return true;
  } catch (error) {
    if ((error as Error).name === "AbortError") return false;
    throw error;
  }
}

export const deviceFiles: FileProvider = {
  id: "device",
  importLabel: "Import file…",
  exportLabel: "Export file…",
  exportAllLabel: "Export all…",
  pick: pickLocalFiles,
  save: saveLocalFile,
};

/** Every provider, in the order the buttons appear. */
export const providers: FileProvider[] = [deviceFiles];
