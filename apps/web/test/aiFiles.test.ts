import { describe, expect, it } from "vitest";
import { FILE_BYTES_LIMIT, FILES_LIMIT, FileProblem, findFiles, FOUND_LIMIT, LINES_LIMIT, pathTest, readFile, searchFiles } from "../src/ai/files.js";
import { FakeFile, FakeFolder } from "./fakeFolder.js";

/** A small repository: source, docs, and what the model isn't shown. */
function repo(): FakeFolder {
  const root = new FakeFolder("shop");
  root.put("README.md", "# Shop\n\nSells things.\n");
  root.put("src/main.ts", 'import { checkout } from "./api/checkout.js";\n\ncheckout();\n');
  root.put("src/api/checkout.ts", "export function checkout() {\n  // Takes PAYMENT through Stripe.\n  return pay();\n}\n");
  root.put("src/api/checkout.test.ts", 'test("checkout takes payment", () => {});\n');
  root.put("docs/architecture.openarch", "{}\n");
  root.put(".env", "STRIPE_KEY=sk_live_secret\n");
  root.put(".git/config", "[core]\n");
  root.put("src/.cache/payment.ts", "payment\n");
  root.put("node_modules/stripe/index.js", "module.exports = payment;\n");
  return root;
}

describe("the files a model can read, in a folder opened from the start page", () => {
  it("are listed by path, in order, without hidden files and folders or node_modules", async () => {
    expect(await findFiles(repo(), {})).toBe(["docs/architecture.openarch", "README.md", "src/api/checkout.test.ts", "src/api/checkout.ts", "src/main.ts"].join("\n"));
  });

  it("are found by a pattern, or by text in their path, in the whole folder or one inside it", async () => {
    const root = repo();
    expect(await findFiles(root, { pattern: "*.ts" })).toBe("src/api/checkout.test.ts\nsrc/api/checkout.ts\nsrc/main.ts");
    expect(await findFiles(root, { pattern: "src/*.ts" })).toBe("src/main.ts");
    expect(await findFiles(root, { pattern: "src/**/*.test.ts" })).toBe("src/api/checkout.test.ts");
    expect(await findFiles(root, { pattern: "CHECKOUT" })).toBe("src/api/checkout.test.ts\nsrc/api/checkout.ts");
    expect(await findFiles(root, { folder: "src/api/", pattern: "*.ts" })).toBe("src/api/checkout.test.ts\nsrc/api/checkout.ts");
    expect(await findFiles(root, { pattern: "*.go" })).toBe('No file matches "*.go" in the folder.');
    expect(await findFiles(root, { folder: "docs", pattern: "*.md" })).toBe('No file matches "*.md" in docs.');
    expect(await findFiles(new FakeFolder("empty"), {})).toBe("No files in the folder.");
  });

  it("match a pattern as it's written: * in one name, ** across folders, ? one character, capitals aside", () => {
    const matches = (pattern: string, path: string) => pathTest(pattern)(path);
    expect(matches("*.ts", "main.ts")).toBe(true);
    expect(matches("*.ts", "src/api/main.ts")).toBe(true);
    expect(matches("*.ts", "src/main.tsx")).toBe(false);
    expect(matches("src/*.ts", "src/api/main.ts")).toBe(false);
    expect(matches("src/**/*.ts", "src/main.ts")).toBe(true);
    expect(matches("src/**/*.ts", "src/a/b/main.ts")).toBe(true);
    expect(matches("src/**", "src/a/b/main.ts")).toBe(true);
    expect(matches("**/api/*", "src/api/main.ts")).toBe(true);
    expect(matches("main.?s", "src/main.ts")).toBe(true);
    expect(matches("main.?s", "src/main.tss")).toBe(false);
    expect(matches("?ain.ts", "/ain.ts")).toBe(false);
    expect(matches("*.TS", "Main.ts")).toBe(true);
    // Without a wildcard it's text the path has; with none at all, everything matches.
    expect(matches("api/check", "src/API/checkout.ts")).toBe(true);
    expect(matches("  ", "anything")).toBe(true);
    // Characters that mean something in other patterns are only themselves.
    expect(matches("a+(b).[c]*", "a+(b).[c]d")).toBe(true);
    expect(matches("a.b*", "axb")).toBe(false);
  });

  it("match a pattern with many wildcards without taking long", () => {
    const started = Date.now();
    expect(pathTest(`${"*a".repeat(40)}*b`)("a".repeat(400))).toBe(false);
    expect(pathTest(`${"**/".repeat(30)}x`)(`${"a/".repeat(60)}y`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("are read with their lines numbered: all of a short one, or the lines asked for", async () => {
    const root = repo();
    expect(await readFile(root, { path: "src/api/checkout.ts" })).toBe("src/api/checkout.ts (4 lines):\n1: export function checkout() {\n2:   // Takes PAYMENT through Stripe.\n3:   return pay();\n4: }");
    expect(await readFile(root, { path: "./src/api/../api/checkout.ts", from: 2, lines: 2 })).toBe("src/api/checkout.ts (lines 2 to 3 of 4): Read on with from: 4.\n2:   // Takes PAYMENT through Stripe.\n3:   return pay();");
    expect(await readFile(root, { path: "src/api/checkout.ts", from: 4 })).toBe("src/api/checkout.ts (lines 4 to 4 of 4):\n4: }");
    expect(await readFile(root, { path: "src/api/checkout.ts", from: 9 })).toBe("src/api/checkout.ts has 4 lines, so there's none at 9.");
    // A file with Windows line endings, and one with no line break at its end.
    root.put("notes.txt", "one\r\ntwo");
    expect(await readFile(root, { path: "notes.txt" })).toBe("notes.txt (2 lines):\n1: one\n2: two");
    root.put("empty.txt", "");
    expect(await readFile(root, { path: "empty.txt" })).toBe("empty.txt (1 line):\n1: ");
  });

  it("are read at most so many lines at a time, saying where to read on", async () => {
    const root = repo();
    root.put("long.txt", Array.from({ length: LINES_LIMIT + 20 }, (_, i) => `line ${i + 1}`).join("\n"));
    const first = await readFile(root, { path: "long.txt", lines: 100_000 });
    expect(first.split("\n")).toHaveLength(LINES_LIMIT + 1);
    expect(first.split("\n")[0]).toBe(`long.txt (lines 1 to ${LINES_LIMIT} of ${LINES_LIMIT + 20}): Read on with from: ${LINES_LIMIT + 1}.`);
    expect((await readFile(root, { path: "long.txt", from: LINES_LIMIT + 1 })).split("\n")).toHaveLength(21);
  });

  it("can't be read when they're hidden, in node_modules, outside the folder, missing, too big or not text", async () => {
    const root = repo();
    const refused = (path: string): Promise<Error> => readFile(root, { path }).then(
      (text) => new Error(`Read, when it shouldn't have been: ${text}`),
      (e: unknown) => e as Error,
    );
    for (const path of [".env", ".git/config", "src/.cache/payment.ts", "node_modules/stripe/index.js", "src/../.env"]) {
      const error = await refused(path);
      expect(error, path).toBeInstanceOf(FileProblem);
      expect(error.message, path).toMatch(/isn't read: hidden files and folders, and node_modules, are left out\.$/);
    }
    expect((await refused("../other/secret.txt")).message).toBe('The path "../other/secret.txt" is outside the folder. Give one inside it, like src/main.ts.');
    expect((await refused("src/gone.ts")).message).toBe("There's no file src/gone.ts. Use find_files to see what's there.");
    expect((await refused("gone/main.ts")).message).toBe("There's no folder gone. Use find_files to see what's there.");
    // A folder isn't a file, and a file isn't a folder.
    expect((await refused("src")).message).toBe("There's no file src. Use find_files to see what's there.");
    expect((await refused("README.md/x")).message).toBe("There's no folder README.md. Use find_files to see what's there.");
    expect((await refused(" ")).message).toBe("Give the file's path, like src/main.ts.");
    root.put("big.log", "x".repeat(FILE_BYTES_LIMIT + 1));
    expect((await refused("big.log")).message).toBe("big.log can't be read: it's bigger than 1 MB, or it isn't text.");
    // One of exactly that size is read.
    root.put("full.log", "x".repeat(FILE_BYTES_LIMIT));
    expect((await readFile(root, { path: "full.log" })).startsWith("full.log (1 line):\n1: xxx")).toBe(true);
    root.put("logo.png", "");
    ((root.entries.get("logo.png") as FakeFile).bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]));
    expect((await refused("logo.png")).message).toBe("logo.png can't be read: it's bigger than 1 MB, or it isn't text.");
    await expect(findFiles(root, { folder: "../other" })).rejects.toThrow('The folder "../other" is outside the folder.');
    await expect(findFiles(root, { folder: ".git" })).rejects.toThrow(FileProblem);
  });

  it("are searched for text, capitals aside, with each line's file and number", async () => {
    const root = repo();
    // The .env file, the hidden cache and node_modules have "payment" in them too, and aren't searched.
    expect(await searchFiles(root, { text: "payment" })).toBe('src/api/checkout.test.ts:1: test("checkout takes payment", () => {});\nsrc/api/checkout.ts:2: // Takes PAYMENT through Stripe.');
    expect(await searchFiles(root, { text: "Payment", pattern: "*.test.ts" })).toBe('src/api/checkout.test.ts:1: test("checkout takes payment", () => {});');
    expect(await searchFiles(root, { text: "sells", folder: "src" })).toBe('Nothing in src has "sells" in it.');
    expect(await searchFiles(root, { text: "sk_live" })).toBe('Nothing in the folder has "sk_live" in it.');
    await expect(searchFiles(root, { text: "  " })).rejects.toThrow("Give the text to search for.");
  });

  it("are searched past the ones that are too big, aren't text or can't be read, and long lines are cut", async () => {
    const root = repo();
    root.put("big.log", `payment\n${"x".repeat(FILE_BYTES_LIMIT)}`);
    root.put("logo.png", "payment");
    (root.entries.get("logo.png") as FakeFile).bytes = new Uint8Array([0xff, 0xfe]);
    root.put("locked.txt", "payment");
    (root.entries.get("locked.txt") as FakeFile).unreadable = true;
    root.put("wide.txt", `payment ${"y".repeat(500)}`);
    (root.entries.get("src") as FakeFolder).entries.set("private", Object.assign(new FakeFolder("private"), { unreadable: true }));
    const found = (await searchFiles(root, { text: "payment" })).split("\n");
    expect(found.map((line) => line.split(":")[0])).toEqual(["src/api/checkout.test.ts", "src/api/checkout.ts", "wide.txt"]);
    expect(found[2]).toBe(`wide.txt:1: payment ${"y".repeat(232)}…`);
  });

  it("stop at so many matches, and say there are more", async () => {
    const root = new FakeFolder("big");
    for (let i = 0; i < FOUND_LIMIT + 5; i++) root.put(`src/file-${String(i).padStart(4, "0")}.ts`, "payment\n");
    const listed = (await findFiles(root, {})).split("\n");
    expect(listed).toHaveLength(FOUND_LIMIT + 1);
    expect(listed[FOUND_LIMIT]).toBe(`(There are more: these are the first ${FOUND_LIMIT}. Narrow the pattern, or give a folder.)`);
    const lines = (await searchFiles(root, { text: "payment" })).split("\n");
    expect(lines).toHaveLength(FOUND_LIMIT + 1);
    expect(lines[FOUND_LIMIT]).toBe(`(There are more: these are the first ${FOUND_LIMIT}. Narrow the search, or give a folder.)`);
    // Exactly as many as fit aren't said to be more.
    const exact = new FakeFolder("exact");
    for (let i = 0; i < FOUND_LIMIT; i++) exact.put(`file-${i}.ts`, "payment\n");
    expect((await findFiles(exact, {})).split("\n")).toHaveLength(FOUND_LIMIT);
  });

  it("stop looking after so many files, and say so", async () => {
    const root = new FakeFolder("huge");
    for (let i = 0; i < FILES_LIMIT + 3; i++) root.put(`a/file-${i}.txt`, "");
    root.put("z/last.md", "payment");
    expect(await findFiles(root, { pattern: "*.md" })).toBe(`No file matches "*.md" in the folder.\n(Stopped after ${FILES_LIMIT} files. Give a folder to look in the rest.)`);
    expect(await searchFiles(root, { text: "payment" })).toBe(`Nothing in the folder has "payment" in it.\n(Stopped after ${FILES_LIMIT} files. Give a folder to look in the rest.)`);
    expect(await findFiles(root, { pattern: "*.md", folder: "z" })).toBe("z/last.md");
  });

  it("stop when the request is stopped", async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(findFiles(repo(), {}, stop.signal)).rejects.toMatchObject({ name: "AbortError" });
    await expect(searchFiles(repo(), { text: "payment" }, stop.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
