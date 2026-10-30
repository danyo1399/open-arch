/**
 * Places outside the browser that workspace files are imported from and
 * exported to. A provider only copies files in and out: the workspaces
 * themselves live in the browser (library.ts), and nothing stays linked to the
 * file. Files on this device come first; cloud storage (Dropbox, iCloud Drive,
 * …) can be added as more providers.
 */
import { FILE_EXTENSION } from "@open-arch/core";
import { download } from "./hosts.js";

export interface PickedFile {
  name: string;
  text: string;
}

export interface FileProvider {
  id: string;
  importLabel: string;
  exportLabel: string;
  /** Ask the user for workspace files. Resolves to none when they cancel. */
  pick(): Promise<PickedFile[]>;
  /** Save a copy of a workspace file there. Resolves to false when the user cancels. */
  save(name: string, text: string): Promise<boolean>;
}

const ACCEPT = `${FILE_EXTENSION},application/json`;

export async function readFiles(files: Iterable<File>): Promise<PickedFile[]> {
  return Promise.all([...files].map(async (file) => ({ name: file.name, text: await file.text() })));
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
  showSaveFilePicker(options: object): Promise<{ createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> }>;
}

/** Chrome and Edge ask where to save; other browsers download the file. */
async function saveLocalFile(name: string, text: string): Promise<boolean> {
  if (!("showSaveFilePicker" in window)) {
    download(name, text, "application/json");
    return true;
  }
  try {
    const handle = await (window as unknown as SavePicker).showSaveFilePicker({
      id: "open-arch",
      suggestedName: name,
      types: [{ description: "open-arch workspace", accept: { "application/json": [FILE_EXTENSION] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(text);
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
  pick: pickLocalFiles,
  save: saveLocalFile,
};

/** Every provider, in the order the buttons appear. */
export const providers: FileProvider[] = [deviceFiles];
