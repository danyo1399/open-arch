import { describe, expect, it } from "vitest";
import { applyOperations, buildWorkspace, checkWorkspace, computeView, exportDocs, inFrame, OpError, parseDocument, renderMermaid, serializeDocument, type OpenArchDocument, type Operation } from "../src/index.js";
import { apply, rules, shop } from "./helpers.js";

/**
 * The shop, with a logging library built into its web app and its API. The library's code is in
 * one place: an interface and the class that sends logs to an external log platform. The API's
 * controller and the web app log with it.
 */
function logging(): OpenArchDocument {
  const doc = shop();
  doc.elements.logging = { kind: "library", name: "Logging", technology: "npm package", description: "Structured logs for every service." };
  doc.elements.logger = { kind: "class", name: "Logger", parent: "logging", stereotype: "interface", members: ["+info(message: string): void"] };
  doc.elements["json-logger"] = { kind: "class", name: "JsonLogger", parent: "logging", uses: [{ to: "logger", kind: "realization" }, { to: "log-platform", description: "Sends logs to" }] };
  doc.elements["log-platform"] = { kind: "system", name: "Log Platform", external: true };
  doc.elements.api!.libraries = ["logging"];
  doc.elements["web-app"]!.libraries = ["logging"];
  doc.elements.controller!.uses!.push({ to: "logger", description: "Logs with" });
  doc.elements["web-app"]!.uses!.push({ to: "logger", description: "Logs with" });
  doc.views["logging-classes"] = { title: "Logging classes", level: "class", scope: "logging" };
  return doc;
}

const view = (doc: OpenArchDocument, id: string) => {
  const ws = buildWorkspace(doc);
  return computeView(ws, ws.views.get(id)!);
};

const arrows = (doc: OpenArchDocument, id: string) => view(doc, id).edges.map((e) => `${e.from} -> ${e.to}${e.implied ? " (implied)" : ""}`);

const fails = (doc: OpenArchDocument, ...ops: Operation[]) => {
  try {
    applyOperations(doc, ops);
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
  throw new Error("The operations were applied.");
};

describe("libraries", () => {
  it("are read and written, with each container's libraries in order", () => {
    const doc = logging();
    doc.elements.api!.libraries = ["zip", "logging"];
    doc.elements.zip = { kind: "library", name: "Zip" };
    const text = serializeDocument(doc);
    expect(text).toContain('"libraries": ["logging", "zip"]');
    const parsed = parseDocument(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(rules(logging())).toEqual([]);
    expect(parseDocument(JSON.stringify({ ...doc, elements: { a: { kind: "container", name: "A", parent: "s", libraries: "x" } } })).diagnostics.map((d) => d.rule)).toEqual(["field-type"]);
  });

  it("are checked: no parent, only on containers, only libraries, and used only where they're built in", () => {
    const doc = logging();
    doc.elements.logging!.parent = "api";
    doc.elements.controller!.libraries = ["logging"];
    doc.elements.db!.libraries = ["nothing", "payments"];
    doc.elements.payments!.uses = [{ to: "logger", description: "Logs with" }];
    expect(checkWorkspace(buildWorkspace(doc)).map((d) => `${d.rule} ${d.path}`)).toEqual([
      "library-unknown elements.db.libraries[0]",
      "library-kind elements.db.libraries[1]",
      "libraries-ignored elements.controller.libraries",
      "library-not-included elements.payments.uses[0]",
      "parent-not-allowed elements.logging.parent",
    ]);
  });

  it("let one library's code use another's, and warn only about the containers built with the first and not the second", () => {
    const doc = logging();
    doc.elements["http-client"] = { kind: "library", name: "HTTP client" };
    doc.elements.fetcher = { kind: "class", name: "Fetcher", parent: "http-client", uses: [{ to: "logger", description: "Logs with" }] };
    doc.elements.api!.libraries = ["http-client", "logging"];
    expect(rules(doc)).toEqual([]);
    expect(arrows(doc, "logging-classes")).toContain("fetcher -> logger");
    doc.elements.db!.libraries = ["http-client"];
    const warnings = checkWorkspace(buildWorkspace(doc)).filter((d) => d.rule === "library-not-included");
    expect(warnings.map((d) => [d.path, d.message, d.fix])).toEqual([
      [
        "elements.fetcher.uses[0]",
        '"fetcher" uses "logger", in the library "logging", but "db", built with the library "http-client", isn\'t built with that one, so its diagrams leave this out.',
        "Build db with it: `open-arch update-element db --library http-client --library logging`.",
      ],
    ]);
  });

  it("warn about something that uses one its container isn't built with, and say how to build it in", () => {
    const doc = logging();
    doc.elements.api!.libraries = [];
    const warning = checkWorkspace(buildWorkspace(doc)).find((d) => d.rule === "library-not-included")!;
    expect(warning.message).toBe('"controller" uses "logger", in the library "logging", but its container "api" isn\'t built with that library, so only class views draw it.');
    expect(warning.fix).toBe("Build api with it: `open-arch update-element api --library logging`.");
  });

  it("are drawn inside the frame of a component view of each container built with them", () => {
    const cv = view(logging(), "api-components");
    expect(cv.nodes.filter((n) => inFrame(cv.boundary, n)).map((n) => n.id)).toEqual(["controller", "logging"]);
    expect(arrows(logging(), "api-components")).toEqual([
      "controller -> db",
      "controller -> logging (implied)",
      "controller -> payments",
      "logging -> log-platform (implied)",
      "web-app -> controller",
      "web-app -> log-platform (implied)",
    ]);
  });

  it("draw what their code uses from every container built with them, and nothing for what uses them there", () => {
    expect(arrows(logging(), "shop-containers")).toEqual(expect.arrayContaining(["api -> log-platform (implied)", "web-app -> log-platform (implied)"]));
    expect(arrows(logging(), "shop-containers").filter((a) => a.includes("logging") || a.includes("logger"))).toEqual([]);
    expect(arrows(logging(), "landscape")).toEqual(["customer -> shop (implied)", "shop -> log-platform (implied)", "shop -> payments (implied)"]);
    expect(view(logging(), "landscape").nodes.map((n) => n.id)).not.toContain("logging");
  });

  it("draw nothing from a library built into no container, except in class views", () => {
    const doc = logging();
    delete doc.elements.api!.libraries;
    delete doc.elements["web-app"]!.libraries;
    doc.elements.controller!.uses!.pop();
    doc.elements["web-app"]!.uses!.pop();
    expect(arrows(doc, "shop-containers").filter((a) => a.includes("log-platform"))).toEqual([]);
    expect(arrows(doc, "logging-classes")).toEqual(["json-logger -> log-platform", "json-logger -> logger"]);
  });

  it("have class views of their own, with their classes in the frame and what uses them as itself", () => {
    const cv = view(logging(), "logging-classes");
    expect(cv.boundary?.id).toBe("logging");
    expect(cv.nodes.map((n) => n.id).sort()).toEqual(["controller", "json-logger", "log-platform", "logger", "web-app"]);
    // Sent from two containers, but drawn once.
    expect(arrows(logging(), "logging-classes")).toEqual(["controller -> logger", "json-logger -> log-platform", "json-logger -> logger", "web-app -> controller", "web-app -> logger"]);
  });

  it("are a box beside the scope's component in a class view of a component built with them", () => {
    const doc = apply(logging(), { op: "add-view", id: "controller-classes", level: "class", scope: "controller" }, { op: "add-element", id: "handler", kind: "class", parent: "controller" }, { op: "add-relationship", from: "handler", to: "logger", kind: "dependency" });
    expect(arrows(doc, "controller-classes")).toEqual(expect.arrayContaining(["handler -> logger"]));
    expect(view(doc, "controller-classes").nodes.map((n) => n.id)).toContain("logger");
  });

  it("are added, built in, renamed and removed by operations", () => {
    let doc = apply(shop(), { op: "add-element", id: "logging", kind: "library", name: "Logging" }, { op: "update-element", id: "api", libraries: ["logging", "logging"] });
    expect(doc.elements.api!.libraries).toEqual(["logging"]);
    doc = apply(doc, { op: "rename", id: "logging", to: "logs" });
    expect(doc.elements.api!.libraries).toEqual(["logs"]);
    doc = apply(doc, { op: "remove-element", id: "logs" });
    expect(doc.elements.api).not.toHaveProperty("libraries");
    expect(apply(logging(), { op: "update-element", id: "api", libraries: null }).elements.api).not.toHaveProperty("libraries");
    expect(apply(shop(), { op: "add-element", id: "x", kind: "library" }, { op: "add-element", id: "c", kind: "container", parent: "shop", libraries: ["x"] }).elements.c!.libraries).toEqual(["x"]);
  });

  describe("with components", () => {
    /** A shared SDK with an HTTP part and an auth part, each a component holding a class, built into the API. */
    function sdk(): OpenArchDocument {
      const doc = logging();
      doc.elements.sdk = { kind: "library", name: "SDK" };
      doc.elements["sdk-http"] = { kind: "component", name: "HTTP", parent: "sdk" };
      doc.elements["sdk-auth"] = { kind: "component", name: "Auth", parent: "sdk" };
      doc.elements.fetcher = { kind: "class", name: "Fetcher", parent: "sdk-http", uses: [{ to: "token", kind: "dependency", description: "Signs requests with" }] };
      doc.elements.token = { kind: "class", name: "Token", parent: "sdk-auth", uses: [{ to: "payments", description: "Gets tokens from" }] };
      doc.elements.api!.libraries = ["logging", "sdk"];
      doc.elements.controller!.uses!.push({ to: "fetcher", description: "Fetches with" });
      doc.views["sdk-components"] = { title: "SDK components", level: "component", scope: "sdk" };
      doc.views["http-classes"] = { title: "HTTP classes", level: "class", scope: "sdk-http" };
      return doc;
    }

    it("are allowed, and checked like any other", () => {
      expect(rules(sdk())).toEqual([]);
      expect(apply(sdk(), { op: "add-element", id: "retry", kind: "component", parent: "sdk" }).elements.retry).toEqual({ kind: "component", name: "Retry", parent: "sdk" });
      expect(fails(sdk(), { op: "add-element", id: "retry", kind: "component", parent: "payments" })).toBe('A component\'s parent must be a container or library, but "payments" is a system.');
    });

    it("are drawn as the library's one box in a component view of a container built with it", () => {
      const cv = view(sdk(), "api-components");
      expect(cv.nodes.map((n) => n.id)).toContain("sdk");
      expect(cv.nodes.map((n) => n.id)).not.toContain("sdk-http");
      expect(arrows(sdk(), "api-components")).toEqual(expect.arrayContaining(["controller -> sdk (implied)", "sdk -> payments (implied)"]));
    });

    it("are drawn in the frame of a component view of the library, with what uses them and what they use as themselves", () => {
      const cv = view(sdk(), "sdk-components");
      expect(cv.boundary?.id).toBe("sdk");
      expect(cv.nodes.filter((n) => inFrame(cv.boundary, n)).map((n) => n.id)).toEqual(["sdk-auth", "sdk-http"]);
      expect(arrows(sdk(), "sdk-components")).toEqual(["controller -> payments", "controller -> sdk-http (implied)", "sdk-auth -> payments (implied)", "sdk-http -> sdk-auth (implied)"]);
      expect(renderMermaid(cv)).toMatch(/subgraph sdk_boundary\["SDK \[Library\]"\]\n {4}sdk_auth\[[^\n]*\n {4}sdk_http\[/);
    });

    it("keep the kinds of relationships between classes held directly in the library, on its component view", () => {
      const doc = apply(logging(), { op: "add-view", id: "logging-components", level: "component", scope: "logging" });
      expect(view(doc, "logging-components").edges.find((e) => e.from === "json-logger" && e.to === "logger")).toMatchObject({ kind: "realization", implied: false });
    });

    it("have class views, with the rest of the library drawn as its component view would", () => {
      const doc = sdk();
      doc.elements.fetcher!.uses!.push({ to: "sdk-auth", description: "Asks" });
      const cv = view(doc, "http-classes");
      expect(cv.boundary?.id).toBe("sdk-http");
      expect(cv.nodes.map((n) => n.id).sort()).toEqual(["controller", "fetcher", "sdk-auth", "token"]);
      expect(arrows(doc, "http-classes")).toEqual(["controller -> fetcher", "fetcher -> sdk-auth", "fetcher -> token"]);
    });

    it("hold classes that something outside the library uses only where its container is built with it", () => {
      const doc = sdk();
      doc.elements.api!.libraries = ["logging"];
      expect(rules(doc)).toEqual(["library-not-included"]);
    });
  });

  it("are refused where they don't fit", () => {
    expect(fails(logging(), { op: "add-element", id: "x", kind: "library", parent: "api" })).toMatch(/^A library belongs to no one container, so it can't have a parent\./);
    expect(fails(logging(), { op: "update-element", id: "controller", libraries: ["logging"] })).toBe("Only containers are built with libraries, and this is a component.");
    expect(fails(logging(), { op: "update-element", id: "api", libraries: ["controller"] })).toBe('"controller" is a component, not a library. Add a library with add-element controller --kind library.');
    expect(fails(logging(), { op: "add-element", id: "x", kind: "library", external: true })).toBe("Only people and systems can be external.");
    expect(fails(logging(), { op: "add-view", id: "v", level: "container", scope: "logging" })).toBe('A container view\'s scope must be a system, but "logging" is a library.');
  });

  it("warn when a view's include names one it can't draw", () => {
    const doc = logging();
    doc.views["shop-containers"]!.include = ["*", "logger"];
    expect(checkWorkspace(buildWorkspace(doc)).map((d) => d.rule)).toContain("view-include-library");
  });

  it("show in Mermaid inside the frame, with a dashed outline", () => {
    const text = renderMermaid(view(logging(), "api-components"));
    expect(text).toMatch(/subgraph api_boundary[^\n]*\n {4}controller\[[^\n]*\n {4}logging\["Logging<br\/>\[Library: npm package\]"\]\n {2}end/);
    expect(text).toContain("  classDef library fill:#85bbf0,stroke:#5d82a8,color:#000000,stroke-dasharray:5 5");
    expect(text).toContain("  class logging library");
    expect(renderMermaid(view(logging(), "landscape"))).not.toContain("classDef library");
  });

  it("are documented with the containers built with them, and on each container", () => {
    const files = exportDocs(buildWorkspace(logging()), "shop.openarch");
    const page = (path: string) => files.find((f) => f.path === path)!.content;
    expect(page("elements/logging.md")).toContain("## Built into\n\n- [API](api.md)\n- [Web App](web-app.md)\n");
    expect(page("elements/api.md")).toContain("## Libraries\n\n- [Logging](logging.md) – Structured logs for every service.\n");
    expect(page("README.md")).toContain("- [Logging](elements/logging.md) (library, npm package) – Structured logs for every service.");
  });
});
