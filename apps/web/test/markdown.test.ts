// @vitest-environment happy-dom
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { linkTo, loadParser, Markdown } from "../src/panels/Markdown.js";
import { mount } from "./dom.js";

/** Markdown drawn as Ask AI draws it, once its parser has loaded. */
async function drawn(text: string): Promise<HTMLElement> {
  await loadParser();
  return mount(createElement(Markdown, { text, className: "answer" })).querySelector<HTMLElement>(".answer")!;
}

describe("Ask AI's markdown", () => {
  // First, as the parser is loaded the first time it's needed.
  it("shows the text as it's written, with its code and bold, until the parser has loaded, then draws it", async () => {
    const host = mount(createElement(Markdown, { text: "# Done\n\nAdded `cache`, **once**.", className: "answer" }));
    expect(host.querySelector(".answer > p")!.innerHTML).toBe("# Done\n\nAdded <code>cache</code>, <strong>once</strong>.");
    await act(() => loadParser());
    expect(host.querySelector(".answer h3")!.textContent).toBe("Done");
    expect(host.querySelector(".answer > p")!.innerHTML).toBe("Added <code>cache</code>, <strong>once</strong>.");
  });

  it("draws headings, emphasis, lists, code, quotes and rules", async () => {
    const answer = await drawn(
      [
        "# Changes",
        "",
        "I added **two** systems, *both* external, and ~~nothing~~ else:",
        "",
        "- `payments`, which takes payment",
        "- `courier`, with:",
        "  1. a queue",
        "  2. a worker",
        "",
        "3. third",
        "4. fourth",
        "",
        "> Check the names.",
        "",
        "```",
        "open-arch show payments",
        "```",
        "",
        "---",
        "",
        "Line one  ",
        "line two",
      ].join("\n"),
    );
    expect(answer.querySelector("h3")!.textContent).toBe("Changes");
    expect(answer.querySelector("strong")!.textContent).toBe("two");
    expect(answer.querySelector("em")!.textContent).toBe("both");
    expect(answer.querySelector("del")!.textContent).toBe("nothing");
    expect([...answer.querySelectorAll(":scope > ul > li > p > code")].map((c) => c.textContent)).toEqual(["payments", "courier"]);
    expect([...answer.querySelectorAll("ul ol li")].map((li) => li.textContent)).toEqual(["a queue", "a worker"]);
    expect(answer.querySelector(":scope > ol")!.getAttribute("start")).toBe("3");
    expect(answer.querySelector("blockquote")!.textContent).toBe("Check the names.");
    expect(answer.querySelector("pre > code")!.textContent).toBe("open-arch show payments");
    expect(answer.querySelector("hr")).not.toBeNull();
    expect(answer.querySelector("br")).not.toBeNull();
  });

  it("draws tables with their alignment, and task lists", async () => {
    const answer = await drawn(["| Element | Kind |", "| :-- | --: |", "| `shop` | system |", "", "- [x] Added the cache", "- [ ] Named it"].join("\n"));
    expect([...answer.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Element", "Kind"]);
    expect([...answer.querySelectorAll("td")].map((td) => [td.textContent, td.style.textAlign])).toEqual([
      ["shop", "left"],
      ["system", "right"],
    ]);
    const tasks = [...answer.querySelectorAll<HTMLInputElement>("li.task input")];
    expect(tasks.map((box) => [box.checked, box.disabled])).toEqual([
      [true, true],
      [false, true],
    ]);
  });

  it("opens links only to the web or to write an email, in a new window", async () => {
    const answer = await drawn("[docs](https://example.com/docs), [mail](mailto:a@example.com), [script](javascript:alert(1)) and [file](file:///etc/passwd)");
    expect([...answer.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href"), a.target, a.rel])).toEqual([
      ["docs", "https://example.com/docs", "_blank", "noopener noreferrer"],
      ["mail", "mailto:a@example.com", "_blank", "noopener noreferrer"],
    ]);
    expect(answer.textContent).toBe("docs, mail, script and file");
    // The kinds of address notes link to, and nothing relative: an answer is on no page.
    for (const url of ["https://example.com", "mailto:a@example.com", "tel:+441234", "ftp://example.com/f"]) expect(linkTo(url)).toBe(url);
    for (const url of ["javascript:alert(1)", " java\tscript:alert(1)", "data:text/html,x", "file:///etc/passwd", "/relative", "docs/setup.md", "#top"]) expect(linkTo(url)).toBeNull();
  });

  it("follows reference links and images to their definitions, which aren't shown themselves", async () => {
    const answer = await drawn(["See [the docs][docs] and [nowhere][missing].", "", "![a diagram][pic] ![gone][missing]", "", '[docs]: https://example.com/docs "The docs"', "[pic]: https://example.com/d.png"].join("\n"));
    expect([...answer.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href"), a.title])).toEqual([
      ["the docs", "https://example.com/docs", "The docs"],
      ["a diagram", "https://example.com/d.png", ""],
    ]);
    expect(answer.querySelector("img")).toBeNull();
    // One with no definition isn't a reference, in markdown: it's the text as written.
    expect(answer.textContent).toBe("See the docs and [nowhere][missing].a diagram ![gone][missing]");
  });

  it("keeps footnotes, with what they say", async () => {
    const answer = await drawn("The cache is shared.[^1]\n\n[^1]: Both containers read it.");
    expect(answer.querySelector("p > sup")!.textContent).toBe("[1]");
    const note = answer.querySelector(".markdown-footnote")!;
    expect(note.querySelector("sup")!.textContent).toBe("[1]");
    expect(note.textContent).toContain("Both containers read it.");
  });

  it("shows HTML as the text it is, and doesn't load images", async () => {
    const answer = await drawn('<img src="https://tracker.example/pixel.png" onerror="alert(1)">\n\n![a diagram](https://example.com/d.png) <b>bold?</b>');
    expect(answer.querySelector("img, b, script")).toBeNull();
    expect(answer.textContent).toContain('<img src="https://tracker.example/pixel.png" onerror="alert(1)">');
    expect(answer.textContent).toContain("<b>bold?</b>");
    expect(answer.querySelector("a")!.textContent).toBe("a diagram");
    expect(answer.querySelector("a")!.getAttribute("href")).toBe("https://example.com/d.png");
  });
});
