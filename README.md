# open-arch

An architecture model (C4) that people and AI agents can both read and change safely.

- **One file:** the whole model lives in a `.openarch` file, JSON with a canonical layout: people, systems, containers, components, shared libraries and classes, keyed by ID, each with its relationships (one way, or both ways), notes, shape and tags (name/value facts like an owner), plus views (diagrams) with their saved box positions. Elements, relationships and views each have a one-line description, shown on the diagram, and markdown notes for longer documentation.
- **Views are computed:** a view picks elements from the shared model, and the boxes and arrows are worked out from it, including relationships implied by nested elements. A class view draws the classes inside one component or shared library as a UML class diagram, with their attributes and methods. A sequence view shows what happens in order instead: numbered steps between elements, each going along a relationship in the model. A state view shows the states something can be in, and the transitions between them. A deployment view shows where the containers run: the servers, clusters and cloud services, nested, with the arrows between the containers worked out from the model. An event view shows what happens in a business process, as event storming does: commands, events and the other notes, in order along a timeline, in swimlanes. A wireframe view sketches an app's screens: the headings, buttons and boxes to type in on each, and which screen a button or link leads to. A whiteboard view is a freehand sketch, to share an idea before it's decided: boxes, text, arrows and lines drawn with a pen, each where it's put and drawn as by hand, none of it part of the model. A flowchart view shows the steps of any process: where it starts and ends, what's done, the decisions on the way, and the arrows from one step to the next, in a swimlane for each actor, team or system if you like, which can be for a person, system, container or other element of the model. An entity view is an entity-relationship diagram (ERD) of the data something keeps: its entities, like a database's tables, each with its attributes and their keys, and the links between them, with how many of each end there can be, in crow's foot notation. A view can also carry sticky notes: text for the people reading that diagram, which isn't part of the model. A note can be on a box or an arrow, or on a flowchart's block, with a line to it.
- **Docs are generated:** markdown pages with Mermaid diagrams (an index, a page per element and per view) are generated from the model for people to read, on GitHub or anywhere else.
- **Changes are checked:** people change the model in the designer and agents change it with `open-arch` commands. Both go through the same validated operations, so a change that would break the model is refused and nothing is saved.

Try the designer in your browser at <https://danyo1399.github.io/open-arch/>, with nothing to install.

See [`examples/shop`](examples/shop): [`shop.openarch`](examples/shop/shop.openarch) and the [docs generated from it](examples/shop/docs/README.md), including a [sequence view](examples/shop/docs/views/place-order.md) of an order being placed, a [class view](examples/shop/docs/views/order-repository-classes.md) of the code that stores orders, a [logging library](examples/shop/docs/elements/logging.md) built into two containers, a [state view](examples/shop/docs/views/order-states.md) of an order's lifecycle, a [deployment view](examples/shop/docs/views/production.md) of where the shop runs, an [event view](examples/shop/docs/views/order-events.md) of an order, from being placed to being shipped, a [wireframe view](examples/shop/docs/views/checkout-screens.md) of the web app's screens, from a product to a placed order, a [whiteboard](examples/shop/docs/views/faster-checkout-ideas.md) of ideas for a faster checkout, a [flowchart](examples/shop/docs/views/checking-out.md) of what the Checkout API does when an order is placed, in lanes for the customer, the API and the payment provider, each linked to its element, with a sticky note on one of its steps, and an [entity view](examples/shop/docs/views/orders-data.md) of what the Orders DB keeps: customers, their orders, what's on each order and its payment. New to architecture diagrams? [`examples/food-delivery`](examples/food-delivery) is a guided tour of the C4 model: views of a made-up food delivery business that zoom in one step at a time, from the whole business down to the code, then wireframes of the screens of two of its apps, with sticky notes explaining what each one shows ([docs](examples/food-delivery/docs/README.md)). The designer opens it with **Take the tour**. The [skill](packages/skill/open-arch/SKILL.md) explains the commands and the [format reference](packages/skill/open-arch/references/format.md) the file.

## Packages

| Package | What it is |
|---|---|
| [`packages/core`](packages/core) (`@open-arch/core`) | Parses, checks, edits (through validated operations) and exports workspaces. No dependencies and no Node.js APIs, so the designer runs it in the browser. |
| [`packages/cli`](packages/cli) (`open-arch`) | The `open-arch` command: `show`, `check`, `export`, an edit command for every operation, `apply` for JSON batches, `init` and `fmt`. |
| [`packages/skill`](packages/skill) (`@open-arch/skill`) | Agent skill that `open-arch init` installs into `.agents/skills/` and `.claude/skills/`: agents read with `show` and change the model only with commands. Without the CLI, they read the docs and say what to change in the designer. |
| [`apps/web`](apps/web) | The designer as a static web app (React, React Flow, ELK). |
| [`apps/desktop`](apps/desktop) | The same designer in Electron, for Windows, macOS and Linux. |
| [`apps/server`](apps/server) (`@open-arch/server`) | The share server, which keeps workspaces shared as links. They're encrypted before they're uploaded, so it can't read them. In Go: one executable for Linux or macOS, or a container. |

## The designer

One UI, two ways to run it.

| | Web app | Desktop app |
|---|---|---|
| Where workspaces live | In the browser's storage (IndexedDB), as many as you like, saved as you work. **Import file…** and **Export file…** copy .openarch files in and out; nothing stays linked to a file. In Chrome and Edge, **Open folder…** edits a .openarch file in a folder on this computer instead, saved as you work | In a .openarch file, saved as you work |
| Docs | **Export zip** downloads the .openarch file and its docs as a .zip, and in Chrome and Edge **Export to folder…** writes them into a folder. In a folder, every save rewrites the docs folder the workspace names. Neither writes the agent skill or an AGENTS.md | Every save rewrites the docs folder the workspace names. The first save after opening the file also brings the agent skill up to date, and AGENTS.md's open-arch section is kept up to date, at the top of the Git repository the file is in. Outside a repository, or in your home folder, it writes neither |
| Notices outside edits | Edits to the same workspace in another tab, and deleting it there: it stays open, and **Save** keeps it again. In a folder, it checks the file every few seconds, so an agent's, an editor's or Git's changes show up | Watches the file, so an agent's or editor's changes show up |
| Try without a file | The bundled examples (the tour and the shop); **Save** keeps a copy in the browser | The bundled examples |
| Share a link | **Share** makes a link that opens a copy; clicking it opens the workspace | The same, and links open in the web designer; **Open link…** opens one |
| Ask AI | Asks a model you choose, straight from the page, through any server that speaks OpenAI's chat API | Sends a request to a local [OpenCode 2](https://opencode.ai) agent |
| Install | Installable as an app (Chrome, Edge, Safari's **Add to Dock** or **Add to Home Screen**) that opens offline | An installer per OS |

The workspaces kept in the web app's browser storage are only in that browser, on that device, and clearing the site's data deletes them, so export a copy of anything you want to keep. A workspace opened from a folder stays in its file, in the folder: see [Working in a folder](#working-in-a-folder). The URL names the open workspace, so reloading the page reopens it. Import and export go through a `FileProvider` ([`apps/web/src/providers.ts`](apps/web/src/providers.ts)): files on this device are the only one so far, and cloud storage such as Dropbox or iCloud Drive can be added as another.

**Export zip**, in the top bar, downloads the open workspace as a .zip with one folder in it. It's there for every workspace that isn't saved to a file: one kept in the browser, an example, a shared link, or one whose folder's file was deleted or moved. The folder holds the .openarch file and its docs.

The web app doesn't write the agent skill or an `AGENTS.md`, in a zip or in a folder: only the .openarch file and its docs. The skill and the section are for changing the model with the `open-arch` CLI, which usually isn't installed beside a workspace made in the web app. Agents there can read the generated docs as they are. To give a project's agents the skill and the section, run `open-arch init` for its file where the CLI is installed, or open the file in the desktop app.

Where the zip puts things:

- For a workspace from a folder, the zip's folder is named after that folder. The file is at its place in it, and the docs are where a save put them.
- Otherwise the zip's folder is named after the file, which is at its top. The docs are in the docs folder the workspace names.
- When the workspace names no docs folder, or one the zip has no place for, the docs go beside the file, with no folder of their own.

**Export to folder…**, in the top bar, in Chrome and Edge, copies any workspace, one opened from a folder too, into a folder you choose, such as a Git repository. The copy becomes a workspace there, as if you'd made it with **Open folder…**: the workspace you exported stays where it is.

- The .openarch file goes at the folder's top. If the folder has something of that name already, nothing is exported.
- It's saved there as a folder's first save is: its docs are written as later saves there keep them, and pages generated from another workspace beside it are left alone.
- A workspace that names no docs folder has its copy keep them beside the file (`.`). One whose docs folder would be outside the folder you chose isn't exported: choose a docs folder inside it, or none, in the workspace's details first.
- The folder is then listed under Folders on the start page, to open and keep working on it there. The message says what was written, and anything left alone.

The web build is plain static files (`apps/web/dist`) with relative paths, so it can be hosted anywhere. The [Pages workflow](.github/workflows/pages.yml) publishes it to GitHub Pages, at <https://danyo1399.github.io/open-arch/>, each time `main` changes. Served over HTTPS (or from localhost), it has a service worker that caches the build, so it can be installed and opened offline; opening it online always loads the latest build. Where the browser can install it, the start page offers to: **Install** opens the browser's own dialog in Chrome, Edge and other Chromium browsers, and on an iPhone or iPad, or in Safari on a Mac, it says where the browser's command is. **Not now** hides the offer in that browser for good. The app icons in `apps/web/public` are rendered from `apps/web/icons` by `sh icons/render.sh`.

### Working in a folder

In Chrome and Edge, the web app can work on a .openarch file in a folder on your computer, such as a Git repository, as the desktop app does. **Open folder…**, on the start page, asks for the folder, and the browser asks whether the page may change the files in it. The designer looks for .openarch files in the folder and two levels of folders below it, as the CLI does, skipping hidden folders and `node_modules`. One opens straight away; with several, you pick one; with none, it offers to create a workspace where `open-arch init` would: `architecture.openarch` with its docs beside it, in the folder if it's empty, or else in a folder of its own, `architecture/`.

Every change is saved to the file, and the docs folder the workspace names is rewritten. So they're there to commit and push with Git. As with the CLI, only pages open-arch generated from this file, or from one no longer beside it (say before a rename), are overwritten or removed, and stale ones are only looked for at the docs folder's top and in its `views/` and `elements/`. So two workspaces whose files are in the same folder can keep their docs there too, beside their files. Workspaces in different folders need docs folders of their own. The docs folder has to be inside the folder you opened: open the folder that holds both. It's relative to the file, so one that repeats the folder the file is in, such as `docs/architecture` for a file in `docs/architecture`, would put the docs in `docs/architecture/docs/architecture`. Saves don't write them there: **Problems** says so, and **Keep docs beside the file**, in the workspace's details, fixes it. The desktop app does the same, and the CLI says so too, with `open-arch update-workspace --docs .` as the fix. Only folders in the project count: here, those in the folder you opened, so open the repository's top, not a folder below it, to be warned; in the desktop app and the CLI, those in the file's Git repository, or outside one, every folder in the file's path. To have an agent such as Claude look at a view, **Copy path**, in the view's **Export** menu, copies the path of its page in the docs, to paste into the chat (see [Exporting one view](#exporting-one-view)).

The designer checks the .openarch file every few seconds while its tab is showing, so a `git pull`, an editor or an agent's change shows up. If the file changed outside since the designer read it, an edit isn't saved over it: the file reloads, and you make the edit again. The browser can't lock the file, though. A change that lands in the moment between that check and the save is still overwritten. If the file is deleted or moved, it stays open, but only in that tab.

Saves write only the file and its docs. An agent skill or `AGENTS.md` already in the folder, say from `open-arch init`, is left as it is.

The start page lists the folders you opened, to open again, each by its workspace's name, with the folder's name and the file's path in it, such as `docs/architecture.openarch`. The designer names the open file the same way: in its top bar, where it's cut short with …, or left out, when the window has little room for it, in the workspace's details, and on a narrow window in the top bar's menu. A browser doesn't tell a page where on your computer a folder is, so that's as much of the path as it can show: open the folder above, such as the repository, to see more of it. A folder you opened before the list kept names goes by its folder's name until you open it again. **Forget** takes one off the list; the folder stays as it is. The browser may ask again for permission when you reopen one. Firefox and Safari can't change files in a folder, so they don't offer it.

### Moving round the diagram

With a mouse, drag across the diagram's background to select the boxes and sticky notes inside, or Ctrl-click them (⌘-click on a Mac) to add one or take it out. Drag any of them to move them all together; Undo takes the move back in one step. The scroll wheel pans, as do Space and drag and the middle button, and Ctrl-scroll (⌘-scroll on a Mac) or a pinch zooms. On a touch screen, drag to pan and pinch to zoom. Right-click any of their boxes for a menu for them all, which copies them, hides them from the view or deletes them; their details have Copy and Delete too.

Delete, or Backspace, deletes the boxes selected from the model, with everything inside each and the sticky notes selected with them, once you confirm it: or choose **Only hide them from this view**, which leaves the notes. Notes selected on their own go without asking. Either way, Undo brings it all back in one step.

Ctrl+C (⌘C on a Mac) copies the boxes and sticky notes selected, or the one box or note selected: each box with everything inside it, the relationships between the boxes copied, and the notes, with what each is on when that's copied too. Ctrl+V pastes them on any view of boxes, in this workspace or another: on the view they came from, a little below and to the right of them, and further each time, and on another view in the middle of the window. **Paste** in the background's right-click menu puts them where you clicked, though the browser may ask first whether the page can read the clipboard. The copies are new elements in the model, with the same names and new IDs, such as `orders-api-2`, laid out as the boxes were, and selected. Each goes in what it was in, unless the view is of something it can go in, such as the system on a container view, which it goes in instead. Nothing is pasted on a view that can't draw what was copied, such as a container on a landscape: the designer says so. A library is the exception, as one added there is: it goes in the model, for containers to be built with. Undo takes the paste back in one step.

As you drag boxes and sticky notes, they line up with the ones around them, edge to edge or middle to middle, and a line shows where they line up. The two buttons under the zoom buttons choose what they snap to: **Line up with other boxes**, on until you turn it off, and **Snap to the grid**, which puts them on the dots behind the diagram when they don't line up with anything. A whiteboard shape snaps as you resize it, too: the edge you drag lines up with the edges of the shapes around it, or goes to the grid. Start dragging, then hold Alt (⌥ on a Mac), to put one exactly where you let go, or make it exactly the size you drag it to. These are your settings, kept in the browser or the desktop app, not in the file. On a view laid out automatically, such as a deployment or event view, only sticky notes snap.

**Auto layout**, in the toolbar over the diagram, lays the whole diagram out again, so it's easy to read. On a phone it's in the top bar's More menu. It places every box, state, block or entity again, as a new view is laid out: in rows that follow the arrows down from the top, or on an entity view across from the left, with the boxes inside the frame together. Every row is as far from the next as the arrows' labels need where they're most crowded, as where several arrows leave one box, so a diagram with a busy box is taller all the way down. An entity view's columns are as far apart as its widest label needs. Then it fits the diagram to the window. Sticky notes go back beside what they're on, or else into a column beside the diagram. Undo puts everything back in one step. It's on views of boxes, state views, flowcharts and entity views: the other kinds of view are always laid out automatically, and a whiteboard stays as you draw it.

Drag from the dot under a box to another box to add a relationship. To move one, select its arrow and drag the dot at either end to another box: the relationship keeps its description, technology, tags and notes. An arrow that stands for several relationships moves them all. When two elements call each other, select the relationship and tick **Goes both ways**: its arrow gets a head at each end, and stands for every relationship between the two boxes.

### Right-click menus

On every kind of view, right-click something on the diagram for a menu of what you can do with it: a box, a block, a state, an entity or one of its attributes, a card, a screen, a widget, a node, a step, a shape, an arrow, a lane or a sticky note. That selects it too, so its details show. Each kind of view's section says what its menus have. A sticky note's menu edits its text or its notes, changes its colour, moves it back where the designer puts it, or deletes it. Right-click the background for **Add** and **Export**, **Paste** on a view of boxes, and **Auto layout** on a view that has it: what you add from there goes where you clicked, unless the view places it itself. The Menu key opens the menu of what has the focus. Everything in these menus is in the toolbar or the details too, for a touch screen.

Except the model's menus, for an element or a relationship (see [A view of an element](#a-view-of-an-element)), a menu opens once what you changed just before is saved, as text typed in the details is when you click away from it, so it's for the diagram as that leaves it. If what you clicked is gone by then, or an Undo, a Redo or a change made to the file elsewhere landed on the way, no menu opens: right-click again. An open menu closes when one of those lands under it.

### Undo and History

**Undo** and **Redo**, in the top bar, take back the last change and make it again: Ctrl+Z, and Ctrl+Shift+Z or Ctrl+Y (⌘ for Ctrl on a Mac).

**History**, the clock button beside them, lists the changes made since the workspace was opened, newest first, with when each was made. On a phone, it's in the top bar's menu. Pick a change to go back to the workspace as it was just after it, or **Before these changes** to take them all back. That's one save, however many changes it goes back over. The changes gone back over stay in the list, marked **Undone**: pick one to make it again, with the ones before it. They go once you make a new change. Undo and Redo carry on from wherever you are in the list.

The list is kept in memory, only while the workspace is open. It isn't saved in the .openarch file or in the browser's storage, and it's in no export or shared link, so nobody you pass the workspace to sees what you tried and took back. It holds the last hundred changes, and starts again when the workspace is closed, or reloaded because its file changed outside the designer.

### Notes

An element, a relationship, a view or a sticky note can have notes: longer documentation, in markdown, which the generated docs show. Select it and write them under **Notes** in its details. For more than a few lines, **Expand** opens them in an editor as big as the window. **Done**, Esc or Ctrl+Enter (⌘Enter on a Mac) saves them, and Undo takes them back. **Cancel** leaves them as they were. If the notes can't be saved, say because what they're on was deleted elsewhere while you wrote, the editor stays open with what you wrote, to copy.

A box or sticky note with notes has a chip on its top right corner, and so does the frame round a view's boxes when what it's round has notes. So does an arrow's label when a relationship it draws has notes, or the middle of the arrow when it has no label, and a sequence step's label when a relationship it goes along has notes. Click the chip to open the notes in the editor. An arrow or step with several relationships with notes shows its details instead, which open each one's notes. The chips aren't in pictures of the diagram.

The editor shows the notes **Formatted**, as they read: headings, lists, links, tables and code are drawn as they are, and you edit them that way. The buttons above make text bold, italic, struck out, code or a link, and a line a heading, a list item, a quote or a code block. Markdown typed there works too: `## ` starts a heading, `- ` a list, and `**bold**` makes bold text. **Markdown** shows the notes as the markdown they're saved as, to edit that instead. Notes are always saved as markdown. Ones you don't change are saved as they were, and ones you change in the formatted view are written the way it writes markdown, which can differ from how they were written: a table's rulers, say. Pictures show as their name, as loading one would fetch it from wherever it is; the docs show them. Links aren't followed from the editor, and **Link** takes a web, email, phone or FTP address, or a path like `docs/setup.md`.

### Sticky notes

**+ Add** and **Sticky note** add a note to the diagram, for the people reading it: what to notice, or why it's drawn this way. Double-click a note to change its text. On a landscape, context, container, component or class view, a note can be on a box, the frame or an arrow: right-click it and choose **Add sticky note**, or use **Add sticky note** in its details. A dotted line joins the note to what it's on. To put a note that's already there on something, drag from the dot under the note to a box, the frame or an arrow, as you'd draw an arrow from a box: the note stays where it is. Or pick it under **On** in the note's details, which can take it off too.

On a flowchart view, a note can be on a block. Right-click the block and choose **Add sticky note**, or use **Add sticky note** in its details. To put a note that's already there on a block, drag from the dot under the note to the block, or pick the block under **On** in the note's details. The dotted line goes to the block's outline. Renaming the block keeps its notes on it, and deleting it leaves them on the diagram, on nothing.

A note stays where you put it, and its line follows the box as it moves. One you haven't moved stays beside what it's on, until you drag from its dot, which leaves it where it is. Notes belong to the view, not the model, but what a note is on is in the model: renaming it keeps the note on it, and deleting it takes the note off. A note on something the view no longer shows, such as a hidden box, has no line, and the problems list says so. A note can have [notes](#notes) of its own too, for more than it should say on the diagram. The docs show the notes under the diagram, each starting with what it's on, with its notes after its text.

### A view of an element

On a landscape, context, container, component or class view, a box's menu, and an arrow's, are the model's: they find where it's used, show it or hide it in this view, add a sticky note on it, make a view of it, copy it, remove a relationship or delete the element. Right-click the frame for the menu of the element it's round. The same menus are on an element's heading on a sequence view, and on an arrow between two containers on a deployment view. These menus are the model's: they open at once, without waiting for what you changed just before to be saved, and stay open through an Undo, a Redo or a change made to the file elsewhere.

To zoom in on a box, right-click it, or its name in the Model list, and choose **New view**, then the kind of view: a container view of a system, a component view of a container, a class view of a component, and so on. The view is made and opened, named after the element, such as "Orders API components". Change its title in its details. On a touch screen, use **New view** in the element's details.

A state, wireframe, flowchart or entity view can be linked to another element at any time. Select its background, and in its details pick the element under **The states of**, **The screens of**, **The process of** or **The data of**, or **Nothing in particular**. Its states, screens, blocks or entities stay as they are; only the element it's of changes, and so do the docs pages that link to it. The title stays too, so change it if it named the old element. A view of boxes draws what's inside its scope, so for another system or container, make a new view.

### What a view shows

A new view shows everything in its scope, and elements added to the model later turn up in it on their own. To keep one view to the boxes you chose, select its background and set **New elements** to **Show only when added here**. It keeps the boxes it has now, and nothing new appears in it unless you add it on that diagram or choose **Show in this view**. Set it back to **Show here automatically** for a view that should always show everything, such as an overview. Either way, **Hide from this view** takes a box out of just that view.

### Sequence views

A sequence view shows what happens, in order: a lifeline for each element in it, and each step as a numbered arrow from one to another. Make one with **+ New view** and the **Sequence** level, and give it a title. Drag from one lifeline to another to add a step where you drop it, or use **+ Add step** to pick any element and one it uses. A step has to go along a relationship in the model, from the element or something inside it, or one that goes both ways. When there isn't one, dropping the step offers to add it, one way or both ways, or to make a relationship the other way go both ways. Or the step can be a reply back along that relationship, drawn dashed. **+ Add step** can add the relationship too. Select a step to describe it, move it up or down, or delete it. A call without a description shows its relationship's.

Right-click a step, on its arrow or its text, for its menu (see [Right-click menus](#right-click-menus)). It moves either end to another element the model has a relationship for the step to go along, makes a call a reply or a reply a call where the model has a relationship for that, moves the step up or down, or deletes it. A sticky note's menu changes its colour, edits its notes or deletes it. Right-click anywhere else for **Add**, which opens **+ Add step**'s form or adds a note, and **Export**. An element's heading has the menu its box has on the views of boxes.

### Class views

A class view draws the code inside one component, C4's fourth level, as a UML class diagram. Make one with **+ New view** and the **Class** level, and pick the component. **+ Add** adds a class to it. Each class box shows its stereotype, such as «interface», its name, its attributes, and then its methods: in its details, type its **Members** one per line, in UML's notation (`+id: OrderId`, `+total(): Money`). A line with brackets is a method.

Drag from the dot under a class to another to relate them, then pick the relationship's **Kind**: an association (uses, the default), a dependency (a dashed open arrow), inheritance (a hollow triangle), realization of an interface (a dashed hollow triangle), composition (a filled diamond at the whole) or aggregation (a hollow diamond). Each kind is its own arrow. So it is on a component view of a library, which draws the classes the library holds directly as themselves. Other views draw a class as the component it's in, and its relationships as ordinary arrows.

### Shared libraries

A library is code built into several containers, such as a logging library. Add one with **+ Add** and **Shared library** on a container view, then tick the containers built with it under **Built into** in its details. A container view draws no libraries, so the new one is in the Model list. Or start from a container: **+ New library** under **Libraries** in its details, where its libraries are ticked, or **+ Add** and **Library built into …** on its component view. Each of those containers' component views draws the library inside its frame, with a dashed outline. Its code is kept in one place. A small library holds classes; a bigger one, like an SDK, can hold components, each with its own classes. Make a component view of the library to draw its components, and a class view of the library or of one of its components to draw their classes. What the library's code uses is drawn from every container built with it.

### State views

A state view shows the states something can be in, and how it moves between them: an order that's placed, paid, shipped and delivered, say. Make one with **+ New view** and the **State** level, and pick what the states are of, such as a class, or nothing in particular. **+ Add** adds a state; drag from the dot under a state to another to add a transition. To move a transition, select it and drag the dot at either end to another state, or to the state at its other end for a transition back to itself. Select a state to rename it, describe it, or mark it as where the view starts (drawn with a dot pointing into it) or where it can end (an arrow out to a bullseye), and to add a transition back to itself. Select a transition to give it an event, a guard and an action, labelled as UML writes them: `event [guard] / action`. States and transitions belong to the view, not the model.

Right-click a state or a transition for its menu (see [Right-click menus](#right-click-menus)). A state's menu adds a transition from it, to another state or back to itself, says whether it starts there or can end there, lays it out again or deletes it. A transition's menu moves either end to another state, moves the transition up or down the list of transitions, or deletes it.

### Deployment views

A deployment view shows where the containers run, usually in one environment, such as Production: the cloud regions, clusters, servers and database services, each a node, nested inside one another. Make one with **+ New view** and the **Deployment** level, and give it a title. **+ Add** adds a deployment node, or an infrastructure node, inside the node selected. Select a node to name it, give it a technology, say how many copies of it run (drawn as a stack, with ×3 by its name), move it inside another, and choose the containers and systems that run in it under **Runs**. The same container can run in several nodes, like a copy in each of two regions. Infrastructure, like a load balancer, DNS or a firewall, runs nothing and holds no nodes. A node that holds nothing, as infrastructure doesn't, is drawn as a box in its **Shape**.

The arrows between the containers come from the model's relationships, as on other views. Where a container runs in several nodes, each copy is joined to the copies of what it uses that run nearest it: a web app in each region uses the database in its own region. Drag from the dot under one container to another to add a relationship to the model. Drag from or to a node to add a connection instead, such as a load balancer forwarding requests to the web app. Select a container to see where it runs, or to stop it running there; Delete does that too. Nodes and connections belong to the view, not the model. The diagram is laid out automatically, so only sticky notes move.

Right-click a node, a container or system running in one, or a connection for its menu (see [Right-click menus](#right-click-menus)). A node's menu adds a node inside it, runs a container or system in it, adds a connection from it, gives it a shape, moves it inside another node or out to the top, makes it infrastructure or a deployment node again, or deletes it. The menu of a container or system running in a node stops it running there or adds a connection from it to a node, then has **Find usages**, **New view** and **Delete from model…**, as its box does on the views of boxes. A connection's menu moves either end, moves the connection up or down the list of connections, or deletes it. An arrow between two containers is the model's, and has the menu it has on the views of boxes. These menus, and the details, only offer what can be done. A connection can't join a node and something inside it, so a node isn't offered a connection to what it holds or runs, or a move that would leave one of the view's connections joining a node and something inside it. In a file that's wrong already, as one written by hand can be, the details leave out or turn off what can't be done, and say why. Infrastructure that runs something or holds a node can't be renamed or given a shape until it's made a deployment node, or what's in it is taken out. While a node is told to run something that's no container or system, nothing else it runs can change. With one such thing, the details can stop it running that. With more, take them out of its runs in the file. And what a node runs can't change when that would leave the view with an error it doesn't have, as taking a connection with it can, when the connections after it are numbered again. Added from the background's menu, a node goes at the top, inside no other, and a sticky note where you clicked.

### Event views

An event view shows what happens in a business process, in order, as an event storming or event modelling session draws it: an order is placed, the payment is taken, the order is shipped. Make one with **+ New view** and the **Event** level, and give it a title. **+ Add** adds a card: an event, a command, or another of event storming's notes, each in its usual colour. An event is something that happened ("Order placed", orange) and a command a decision to do something ("Place order", blue). The others are an actor, who gives a command (yellow), a policy, which reacts to an event (lilac), a read model, which someone looks at to decide (green), an external system (pink), an aggregate, which a command changes (pale yellow), and a hotspot, a question to come back to (red).

The cards run left to right, in order: time goes from left to right. **+ Add** also adds a lane, a row for the cards of one actor, team or system, like Customer or Warehouse. A new card goes after the selected card, in its lane, or in the selected lane. Drag a card along the timeline to move it earlier or later, or into another lane. Cards in no lane sit in a row above the lanes. Drag from the dot beside a card to another to draw an arrow: the second card comes from the first, as an event comes from a command. Select a card to name it, describe it, and change its kind, its lane or the cards it comes from; a lane to rename it or move it up or down; or an arrow to delete it. Deleting a lane keeps its cards. Lanes, cards and arrows belong to the view, not the model. The diagram is laid out automatically, so only sticky notes keep a position.

Right-click a card, an arrow or a lane for its menu (see [Right-click menus](#right-click-menus)). A card's menu adds a card after it, or an arrow to or from another card, changes its kind, moves it to another lane, or earlier or later, or deletes it. An arrow's menu deletes it. A lane's menu adds to the lane, moves it up or down, or deletes it. Added from the background's menu or a lane's, a card goes at the place along the timeline where you clicked, in the lane of that row, as one dragged there does. A lane added from a lane's menu goes after that lane. A sticky note goes where you clicked, clear of the cards.

### Wireframe views

A wireframe view sketches the screens of an app or a website, as UX wireframes do: rough boxes for what's on each screen, and arrows from a button or link to the screen it opens. Make one with **+ New view** and the **Wireframe** level, and pick the system or container whose screens they are, such as the web app, or nothing in particular. Its docs page and the element's both link to each other.

**+ Add** adds a screen, after the one selected, or a widget: a heading, text, a button, a link, a text field, a checkbox, a drop-down, an image, a list, a table, tabs or a divider. A new widget goes after the selected one, on the selected screen, or at the end of the last. Widgets go top to bottom. A **panel** holds widgets in a box, with a title, and a **row** holds them side by side; select one and use **+ Add** to put a widget in it. A list's items, a table's rows and tabs go on lines of their own in a widget's text, and a table's cells are split by `|`.

Drag a widget to move it up or down its screen, into a row or a panel, or onto another screen, and drag a screen to move it along. Drag from the dot beside a widget to another screen, or anything on it, to show that the widget leads there: an arrow goes to that screen, through the gap beside it, or under the screens to one further away. Select a screen to name it, describe it, or draw it for a desktop, a tablet or a phone; or a widget to change its text, its kind, the screen it leads to, or where it is. Deleting a screen deletes what's on it, and deleting a row or panel what's in it. Screens and widgets belong to the view, not the model. The diagram is laid out automatically, so only sticky notes keep a position.

Right-click a screen or a widget for its menu (see [Right-click menus](#right-click-menus)). A screen's menu adds to the screen, draws it for another device, moves it left or right, or deletes it. A widget's menu adds a widget after it, or inside it when it's a row or a panel, changes its kind, says which screen it leads to, moves it to another screen, into a row or a panel or out onto its screen, or among the widgets beside it, or deletes it. An arrow's menu is the menu of the widget it comes from. Added from a screen's menu, a widget goes at the place down the screen where you clicked, and a screen after that one. Added from the background's menu, a screen goes at the place among the screens where you clicked, and a widget at the end of the last screen, as there's no screen where you clicked.

### Whiteboard views

A whiteboard is a freehand sketch, to share an idea before it's decided: boxes, text, arrows and lines drawn with a pen, each where you put it and drawn as by hand, in handwriting. Make one with **+ New view** and the **Whiteboard** level, and give it a title. What's on it belongs to the view, not the model.

Pick a tool from the bar along the bottom of the board, or press its key:

| Tool | Key | What a drag does |
|---|---|---|
| Select and move | V | Selects and moves, as on other views |
| Rectangle, ellipse, diamond | R, O, D | Draws one from corner to corner. A click draws one the usual size |
| Arrow, line | A, L | Draws one from where you press to where you let go. An end on a shape stays on it as it moves |
| Pen | P | Draws a line freehand. The pen stays picked, for the next line |
| Text | T | A click types text there. With the selection tool, double-clicking the board does too |

Escape picks the selection tool again. **+ Add** adds a rectangle, an ellipse, a diamond, text or a sticky note in the middle of the board.

With the selection tool, drag a shape to move it, and drag a corner or an edge of a selected shape to resize it. Shapes line up and snap to the grid as you move or resize them, as boxes do on other views. Double-click a shape, or press Enter, to write in it, and double-click an arrow to write on it: Ctrl+Enter (⌘Enter on a Mac) or a click away saves it, and Esc leaves it as it was. Text left with nothing in it is deleted, and a shape with nothing written in it can't be made text alone. Drag from the dot under a shape to another shape to draw an arrow between them, or anywhere else for one that points there. Select an arrow and drag either end onto a shape, or off it. Drag across the board to select what's inside, arrows too when both their ends are, and move them together.

An arrow's end on a shape faces its other end, and moves round the shape's edge as they move. To keep it on one side, as a decision's yes leaves a diamond from its right tip and its no from its bottom one, let the end go on one of the dots that show at the shape's sides as you draw or drag it: the middle of each edge, and a diamond's or an ellipse's tips. It then stays there wherever the shapes move. The arrow's details show the side each end is on, and change it.

Select a shape to change its text, its kind, its colour and fill, how big its text is and whether its outline is dashed, or to bring it to the front or send it to the back. Select an arrow to change its text, its heads (one way, both ways, or none, for a line), its colour and whether it's dashed. Delete deletes what's selected, and a shape takes the arrows to and from it with it.

Right-click a shape, an arrow or one of an arrow's ends for its menu (see [Right-click menus](#right-click-menus)), with any tool picked: only the left button draws, and a Ctrl-click on a Mac is a right-click. No menu opens while you're drawing, so with a drawing tool picked, a long press on a touch screen draws. A shape's menu writes in it, changes its kind, colour, fill, text size or outline, brings it to the front or sends it to the back, or deletes it. An arrow's menu writes on it, changes its heads, colour or line, keeps either end on one side of its shape or lets it face the other end, or deletes it. Right-click one of several selected together and they stay selected, with a menu that deletes them all. From the background's menu, a shape goes with its middle where you clicked, and text and a sticky note beside it.

The docs draw a whiteboard in Mermaid as near as it can: its boxes and text, in their colours, and the arrows between them, though Mermaid lays them out itself. It can't draw the pen's lines, or arrows with an end at a point or on a pen's line, so the page says when it leaves those out. **Export** saves a picture of the whiteboard as it's drawn.

### Flowchart views

A flowchart shows the steps of a process: where it starts and ends, what's done, the decisions on the way, and the arrows from one step to the next. Make one with **+ New view** and the **Flowchart** level, and pick the element whose process it is, such as a container, or nothing in particular. Its docs page and the element's link to each other.

**+ Add** adds a block, each drawn in the usual flowchart shape:

| Block | Drawn as | For |
|---|---|---|
| Process | A box | A step: something that's done, like "Pack the order" |
| Start, End | A pill | Where the process starts, and where it ends |
| Decision | A diamond | A question with more than one way on, like "In stock?" |
| Input or output | A slanted box | Something that comes in or goes out, like "Read the card details" |
| Subprocess | A box with a second line down each side | A process drawn in full somewhere else |
| Document | A page with a wavy bottom edge | A document or report that's made or read |
| Database | A cylinder | Data that's kept |

With a block selected, the new one goes under it, with a flow from it, so you can add the steps one after another. After an end, it has no flow from it, as the process stops there. Drag from the dot under a block to another to add a flow. To move a flow, select it and drag the dot at either end to another block: it keeps its text. Select a flow to give it text: on the ways out of a decision, the answer each is for, like Yes or No. Arrows meet a decision only at the four tips of its diamond.

The blocks are laid out automatically, from the first one down. Drag one to move it: then they all stay where they are, and **Lay out again**, in a block's details, lets the designer place that one again. **Auto layout**, in the toolbar, places them all again. To move several, with a mouse, drag across the background, in a lane too, to select the blocks and sticky notes inside, or Ctrl-click (⌘-click on a Mac) or Shift-click them to add one or take it out. Drag any of them to move them all together, each into the lane it's let go of over; Undo takes the move back in one step. So a drag across the background doesn't pan a flowchart with a mouse: the scroll wheel pans, as do Space and drag and the middle button, as on [other views](#moving-round-the-diagram). On a touch screen, dragging the background still pans. Their details list them, and **Delete them**, or Delete, deletes them all. Select a block to change its text, its kind or its description, to add a flow from it, or to add a [sticky note](#sticky-notes) on it; or a flow to change its ends, its text or its number. Deleting a block deletes the flows to and from it. The problems list warns about a flowchart without a start, a decision with fewer than two ways out, a way out of a decision that doesn't say which answer it's for, a flow out of an end or into a start, and one from a block back to itself, which isn't drawn. Blocks and flows belong to the view, not the model.

To show who does each step, give the flowchart lanes: columns, left to right, one for each actor, team or system, like Customer and Shop staff. **+ Add** adds a lane, after the one selected. Drag a block into a lane to put it there, or pick its **Lane** in its details, which lays it out again in that lane; a new block goes in the lane of the block or lane selected, or else in the lane it lands in. Each lane is as wide as its blocks need, and a name too long for its lane goes onto as many lines as it needs. A flowchart with lanes and blocks in none has a column for those blocks too, at the left. Select a lane to rename it, describe it, or move it left or right. Pick what it's **For** in its details to make it a lane for an element of the model, like the customer or a container: the lane shows the element's kind under its name, a new lane takes the element's name, the element's page in the docs lists the flowchart, and **Find usages** on the element finds the lane. Deleting a lane keeps its blocks, in no lane, and lays them out again.

Right-click a block, a flow or a lane for its menu (see [Right-click menus](#right-click-menus)). A block's menu adds a block after it, a flow from it or a sticky note on it, changes its kind, moves it to another lane, lays it out again or deletes it. A flow's menu moves either end to another block, moves the flow up or down the list of flows, or deletes it. A lane's menu adds to the lane, shows the details of the element it's for, moves it left or right, or deletes it. A sticky note's menu moves a note that's on a block back next to it. Added from the background's menu or a lane's, a block or a sticky note goes where you clicked, and the block goes in the lane there, with no flow to it.

The docs draw a flowchart in Mermaid, top to bottom, each block in its shape and in a frame for its lane, though Mermaid lays them out itself, and a document is a box: Mermaid as GitHub draws it has no shape for one. Mermaid has no swimlanes either, so the frames aren't always side by side.

### Entity views

An entity view is an entity-relationship diagram (ERD): the data something keeps, like a database's tables. Make one with **+ New view** and the **Entity** level, and pick the system, container, component or library whose data it is, such as a database, or nothing in particular. Its docs page and the element's link to each other.

Each entity is drawn as a table: its name and description at the top, and a row for each attribute, with its keys (PK for the primary key, FK for a foreign key, UK for unique), its name and its type. **+ Add** adds an entity, selected so you can type its name. With an entity or one of its attributes selected, **+ Add** adds an attribute to it, after the one selected; or type a name under **Add an attribute** in the entity's details and press Enter, then the next. Click an attribute's row to change its name, type, keys and description, or to move it up or down.

Drag from the dot under an entity to another to add a link between them. To move a link, select it and drag the dot at either end to another entity, or to the entity at its other end for a link to itself. It keeps how many of each end there can be, and its text. A link says how many of each end there can be, drawn in crow's foot notation at that end:

| How many | Drawn as |
|---|---|
| Exactly one | Two bars |
| Zero or one | A bar and a circle |
| One or more | A crow's foot and a bar |
| Zero or more | A crow's foot and a circle |

A new link is one to zero or more, like one customer to their orders. Select it to change how many of each end there can be, its ends, its text, like "places", or its number. A link can go from an entity to itself, like an employee and their manager: add one with **Add a link to** in the entity's details, and it's drawn as a loop above it.

Right-click an entity, an attribute's row or a link for its menu (see [Right-click menus](#right-click-menus)). An entity's menu adds an attribute to it or a link from it, to another entity or to itself, lays it out again or deletes it. An attribute's menu adds an attribute after it, makes it a key or no longer one, moves it up or down, or deletes it. A link's menu moves either end to another entity, says how many of each end there can be, moves the link up or down the list of links, or deletes it.

Entities without a position are laid out automatically, from left to right. Drag one to move it: then they all stay where they are, and **Lay out again**, in an entity's details, lets the designer place that one again. **Auto layout**, in the toolbar, places them all again. Deleting an entity deletes its attributes and the links to and from it. Entities, attributes and links belong to the view, not the model.

The docs draw an entity view as a Mermaid entity-relationship diagram, though Mermaid lays it out itself, with a table of each entity's attributes and one of the links. Mermaid draws an attribute's type and name as one word each, so a space in one is drawn as `_`; the tables say them as they are.

### Exporting one view

**Export**, on the diagram's toolbar, takes the open view somewhere else, in a file named after the view's ID. On a phone, it's under **Export this view** in the top bar's menu.

- **Copy path** puts the path of the view's page in the docs on the clipboard, to paste into a chat with an agent, such as Claude, so it reads the view. It's there when saves write the docs: for a workspace [in a folder](#working-in-a-folder), and in the desktop app, once the workspace names a docs folder. In a folder, it's the path in the folder you opened, such as `architecture/views/containers.md`, as that's all a browser knows of where the folder is: start the agent in that folder. In the desktop app, it's the full path. It also brings the docs up to date with the workspace, without saving the file, so the page is there, as the view is now, even if nothing has saved it here yet. If the file changed outside since the designer read it, the docs aren't written from the old copy: the file reloads, and the message says to try again. It also says if the docs can't be written, if a file open-arch didn't write is in the page's place, or if a change that landed first, such as an agent's, moved the page: copy the path again then.
- **Copy as Mermaid** puts the diagram's Mermaid text on the clipboard, to paste into a `mermaid` code block in markdown or into a Mermaid editor.
- **Save as Markdown…** saves a markdown file with the view's title, its description and the diagram in Mermaid. Unlike the pages in the generated docs, it links to no other page, so it reads the same wherever you put it.
- **Copy as PNG** puts a picture of the diagram on the clipboard, drawn as **Save as PNG…** draws it, to paste straight into a document, a slide or a chat. It's there in browsers that can copy a picture, and in the desktop app.
- **Save as PNG…**, **Save as SVG…** and **Save as PDF…** save a picture of the diagram as the designer draws it: all of it, not just the part on the screen, without the selection, and in light colours on white even in dark mode, to suit a document or a slide. The PNG and the PDF are drawn at twice the screen's resolution, so they stay sharp in print. The SVG draws the boxes as web page content inside the SVG, which browsers show but some drawing programs can't edit. The PDF is one page the size of the diagram, holding the PNG picture, so its text can't be selected.

### Sharing a link

**Share**, in the top bar, makes a link to the open workspace, for anyone to open. On a phone, it's **Share a link…** in the top bar's menu. An example is only in its tab until it's saved, so save it first. Whoever clicks the link sees the workspace in the designer, in their browser, with nothing to install. Their edits stay in that tab until they choose **Save**, which keeps a copy in their browser. In the desktop app, **Save as…** saves it as a file. To open a link in the desktop app, or in the installed web app, paste it into **Open link…** on the start page.

The workspace is compressed and encrypted on your device before it's uploaded, with a new random key. The key is in the link, after the `#`, which browsers never send to a server, so the share server only has a file it can't read. Nobody signs in: anyone with the link can open the workspace.

Only you can change what you shared, from the browser or the computer you shared it from, which keeps the link with a token from the server. Changes you make aren't in the link until you choose **Update link**, which replaces the version you shared before: the server deletes it. Links you already sent open the latest version, and the address in the browser becomes its link. **Stop sharing** deletes the copy on the server, and the links stop working. Do that before deleting the workspace: deleting it leaves its link working.

Sharing needs a [share server](#the-share-server). The designer only offers it when it was built with one.

### The Views and Model lists

The Model list has every element in alphabetical order, with the contents of each system and container below it, in alphabetical order too. The menu beside **+ New view** sorts the Views list by name, or by level from landscape down to class, with sequence, state, deployment, event, wireframe, whiteboard, flowchart and entity views last. To keep a view at the top of the list, select the pin by its name; select it again to unpin the view. The designer opens the first view in the list. The order and the pins are yours: they're kept in the browser's storage on this computer, in the desktop app too, not in the .openarch file.

### The side panels

The Views & model panel is left of the diagram, and the Details panel right of it, or under it on a screen up to 900 pixels wide. To give the diagram more room, collapse a panel with the arrow button on its edge. It becomes a strip that says what's in it, such as how many elements there are or what's selected; click the strip to expand it again. Picking an element in the Model list, a problem with an element, or the workspace's name expands the Details panel, to show it, as does adding a box with **+ Add**, whose name you then type there.

In the Details panel, the **From** and **To** of a flow, a transition, a link, a step or a connection list what they can be in alphabetical order, with a search box at the top: type part of a name to find it, then click it, or use the arrow keys and Enter. Esc closes the list as it was.

Drag a panel's edge to make it wider or narrower, or taller or shorter under the diagram. A panel stops growing before the diagram gets too small. Or press Tab to get to the edge, and use the arrow keys; Home and End make the panel its smallest or largest. Double-click the edge to give the panel its usual size again.

Which panels are collapsed, and their sizes, are yours: they're kept in the browser's storage on this computer, in the desktop app too, not in the .openarch file. The designer opens every workspace with the panels as you left them. On a phone, each panel fills the screen in turn, picked with the tabs along the bottom, so they don't collapse or resize.

### Ask AI (web)

**Ask AI**, in the top bar, or in its menu on a phone, opens a panel to ask a model about the open workspace, or to change it: "Which containers use the Orders DB?", or "Add a Redis cache that the Checkout API uses". It carries on one conversation, so a request can follow from the one before. **New chat** starts another, and closing the workspace ends it: it isn't kept anywhere. **Save** on a workspace that's only in this tab, such as an example, ends it too, as it opens the copy it keeps. While a request is running, Save waits: stop the request, or let it finish, first.

Each request tells the model which view you have open, and its level, and what you've selected: elements, a relationship, sticky notes, or a view's own things, such as a step, a node, an entity or a whiteboard's shapes. They're named by their IDs, never by their names or titles, so text in a workspace someone else made can't pass for what you asked. Past 50 things, it says how many more there are. So "Describe this" or "Rename these" works on what you picked. The panel shows the same above the box. The desktop app's Ask AI tells its agent the same.

Answers are drawn from their markdown: headings, lists, tables, task lists, code, quotes, footnotes and links. A link opens in your browser, and only to the kinds of address notes link to, such as a web or mail address. HTML in an answer shows as text, and images aren't loaded: each is a link to it.

The arrow at the panel's top right hides it. A request carries on while it's hidden: a spinner on the **Ask AI** button, or on **More** on a phone, says it's still working, and a dot says when it's finished, so you can open the panel to read the answer.

The page talks to the model's server itself. Nothing goes through a server of open-arch's. The first time, it asks for three settings:

- **Server address**: where the server's API is, such as `https://api.openai.com/v1`. Any server that speaks OpenAI's chat completions API will do: OpenAI, OpenRouter and most other providers, or a model on your own computer, served by Ollama or LM Studio.
- **API key**: the key for that server. Leave it empty for a server that needs none.
- **Model**: the model to ask, as the server names it. It has to be one that can call tools.

The settings are yours, not the workspace's. They're kept in this browser's local storage until you press **Forget** in the panel's **Settings**, and nowhere else: never in the .openarch file, an export, a zip or a shared link. Anyone who uses this browser as you can read the key there, so don't keep one in a browser you share.

What goes to the server is what you ask, the workspace's file name, which view is open and what's selected, and what the model reads to answer. With the tick for a folder's files on, the folder's name goes too. It reads the workspace with the same text `open-arch show` prints, and can search it and list its problems.

It changes the workspace only through the operations the designer and the CLI use, so every change is checked: one that would break the model is refused, nothing changes, and the model is told why, to put it right. A change is made as soon as the model asks for it, and is one step in [History](#undo-and-history). **Undo AI change** puts the workspace back as it was just before the model's first change in the request, so what you changed yourself before that is kept. It's offered until you ask again or start a new chat, while the workspace is as the request's last change left it. Once you change something yourself, after the model's changes or between two of them, it isn't offered: use Undo or History. **Stop** ends a request; what it had changed by then stays.

For a workspace [in a folder](#working-in-a-folder), tick **Let the AI read the files in …** to let the model find, read and search the folder's files too: to answer from the code, or to model what's in a repository. It only reads: it can't change a file or run a command. These are left out, so the model can't find, read or search them: hidden files and folders, such as `.env` and `.git`; `node_modules`; and files named as keys and secrets usually are, which are `id_rsa` and the other SSH keys, `credentials.json`, `secrets.yaml` and the like, and any file ending `.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.keystore`, `.kdbx`, `.env`, `.tfvars` or `.tfstate`. That's by name only: a secret in a file with another name is read like any other, so keep the tick off for a folder with secrets in it. It doesn't read a file bigger than 1 MB, or one that isn't text. What it reads is sent to the model's server. The tick is kept in this browser, for that folder only.

If the server can't be reached, check these:

- The server has to allow requests from a web page (CORS). Most providers do. A server on your computer needs the designer's address among its allowed origins: for Ollama, set `OLLAMA_ORIGINS`.
- A page served over HTTPS can't call an `http://` address, except one on this computer (`localhost`).

A request stops after 30 steps, in case a model never finishes: ask it to carry on.

### Ask AI (desktop)

**Ask AI** sends a request, with the open view and the selection, to OpenCode's local background service, starting it if needed (`opencode serve --service`). Each request gets its own OpenCode session in the file's folder, with the project's `open-arch` skill if `open-arch init` installed it, or else the app's copy.

The agent changes the model only by running the CLI bundled with the app, which checks every change. It asks before running any other command or editing any other file, and it can't edit the .openarch file directly. Approve or deny its requests in the panel. The panel can be hidden while a request runs, as in the web app. If the agent asks for something while it's hidden, a red dot on **Ask AI** says it's waiting for you. **Undo AI change** puts the file back as it was before the request.

OpenCode's default model is used. To use another, start the app with `OPEN_ARCH_AGENT_MODEL=<provider>/<model>`.

## The share server

[`apps/server`](apps/server) keeps the workspaces shared as links. It never has their keys, so it can't read them.

A link looks like `https://<designer>/?share=<ID>&v=<hash>#key=<key>`. The ID names the shared workspace: 128 random bits, far too many to guess. The hash names one version of it: the first 128 bits of the SHA-256 of its encrypted file. So a new version has a new URL, and the version's file is served with `Cache-Control: public, max-age=31536000, immutable`, for browsers and proxies to cache for good. A new version replaces the one before: the server deletes its file, and a request for it is redirected (`302`, never cached) to the latest version's. Opening a link first asks which version is the latest, a small answer that's checked each time (`no-cache`, with an ETag), so a browser that cached an earlier version opens the latest too. Offline, the link's own version opens, if the browser cached it.

| Request | Does |
|---|---|
| `POST /v1/workspaces` | Uploads a new workspace. Answers with its `id`, the `hash` of the version, and the `token` that changes it |
| `PUT /v1/workspaces/<id>` | Uploads a new version, with `Authorization: Bearer <token>`. The version before is deleted |
| `DELETE /v1/workspaces/<id>` | Stops sharing it, with the token. Its files are deleted |
| `GET /v1/workspaces/<id>` | Its latest version's `hash` |
| `GET /v1/workspaces/<id>/<hash>` | The latest version's encrypted file. For an earlier version, a redirect to it |

An uploaded file is one byte for the format (`1`), AES-GCM's 12-byte IV, then the ciphertext of `{"name", "text"}`, the file name and the `.openarch` text, as JSON compressed with DEFLATE. The key is 256 random bits. The server only checks the format byte and the size: at most 1 MB.

To find and stop abuse, the server keeps a record of every upload, even of versions it has since deleted: the workspace, the version's hash and size, the time, and what the request said about who sent it. That's the IP address, the user agent, the `Origin` and `Referer` headers, and, behind Cloudflare's proxy, the country and Cloudflare's request ID. It keeps only a hash of each token. One IP address can upload 60 files an hour. It can also ask for 60 workspaces that aren't there in an hour, by any method: past that, it can't look up any workspace until the hour is up, so nobody can try IDs until they find one. These limits count an IPv6 address by its /64 network, as one address: someone with IPv6 is usually given a whole /64, and could otherwise use as many addresses as they like.

The server is written in Go, and builds to one static executable with nothing to install where it runs, not even a C library: its SQLite is pure Go. It keeps its records in SQLite, in `<data>/shares.db`, and each version's encrypted file in `<data>/files/`. It brings the database's tables ([`migrations/`](apps/server/migrations)) up to date as it opens it.

Build the designer with the server's address in `VITE_SHARE_SERVER`. The Pages and CI workflows take it from the repository's `SHARE_SERVER` variable (**Settings**, **Secrets and variables**, **Actions**, **Variables**), and the Cloudflare build of the designer from its build variables. Links made in the desktop app open in the web designer at `VITE_SHARE_APP_URL`, <https://danyo1399.github.io/open-arch/> unless it's set.

The designer is served over HTTPS, and browsers only let it talk to a server over HTTPS too. So put a reverse proxy that does HTTPS in front, such as Caddy, nginx, Cloudflare's, or a hosting platform's own, and tell the server to believe the address the proxy passes on (`TRUST_PROXY`, below). Caddy, for example, gets a certificate for the domain by itself:

```bash
caddy reverse-proxy --from share.example.com --to localhost:8787
```

### Settings

Each is a flag or an environment variable; the flag wins. `open-arch-share help` lists them, with the commands.

| Flag | Variable | Does |
|---|---|---|
| `--port` | `PORT` | The port to listen on: 8787 unless it's set |
| `--host` | `HOST` | The address to listen on: all of them unless it's set |
| `--data` | `DATA_DIR` | The folder for records and files: `./data` unless it's set (`/data` in the container) |
| `--memory` | `DATA_DIR=:memory:` | Keeps everything in memory instead, and forgets it when the server stops |
| `--trust-proxy` | `TRUST_PROXY` | Whose word to take for a request's IP address. `none`, the default: the connection's. `forwarded`: the last address in `X-Forwarded-For`, which a reverse proxy adds. `cloudflare`: `CF-Connecting-IP`, and the country from `CF-IPCountry`, behind Cloudflare's proxy. Only set it when that proxy is really in front: otherwise anyone can choose the address they're recorded with. Behind a proxy, do set it: otherwise every request comes from the proxy's address, and the per-address limits count everyone together. A header that doesn't hold an IP address is ignored, for the connection's address. The address may have its port, and an IPv6 one may be in brackets without one |
| `--max-bytes` | `MAX_BYTES` | The largest encrypted workspace: 1000000 bytes unless it's set. At least 1 |
| `--uploads-per-hour` | `UPLOADS_PER_HOUR` | How many files one IP address can upload in an hour: 60 unless it's set. At least 1 |
| `--failed-lookups-per-hour` | `FAILED_LOOKUPS_PER_HOUR` | How many requests for workspaces that aren't there one IP address can make in an hour, before it can't look up any for the rest of it: 60 unless it's set. At least 1. It's counted in memory, so a restart starts it again |
| `--quiet` | `LOG=off` | Doesn't print a line for each request |

### As an executable

There's an executable for Linux and one for macOS, each on x64 and arm64 (Apple Silicon), of about 11 MB. The Linux ones run on any Linux, Alpine and other musl ones too. Each [release](#releases) has them all, and the [CI workflow](#ci) builds them too, as artifacts of its run. To build them yourself, with Go 1.26+ on any system, into `apps/server/release/`:

```bash
pnpm --filter @open-arch/server executable
```

That writes `open-arch-share-linux-x64`, `open-arch-share-linux-arm64`, `open-arch-share-macos-x64` and `open-arch-share-macos-arm64`. On Linux or a Mac, it then runs the one for the machine to check it works. Run it with a data folder:

```bash
./open-arch-share-linux-x64 --data /var/lib/open-arch-share --port 8787
```

Stop it with Ctrl+C or SIGTERM: it finishes the requests under way first.

The macOS executables aren't signed with an Apple developer ID, so macOS won't open one a browser downloaded, which marks it as from the internet. Build it yourself, download it with `curl`, which doesn't mark it, or clear the mark once you trust it:

```bash
xattr -d com.apple.quarantine open-arch-share-macos-arm64
```

To run it as a service on Linux, [`apps/server/linux/open-arch-share.service`](apps/server/linux/open-arch-share.service) is a systemd unit. It runs as its own user, keeps its data in `/var/lib/open-arch-share`, and listens only on the machine, for a reverse proxy that does HTTPS in front:

```bash
sudo cp open-arch-share-linux-x64 /usr/local/bin/open-arch-share
sudo useradd --system --no-create-home --shell /usr/sbin/nologin open-arch-share
sudo cp apps/server/linux/open-arch-share.service /etc/systemd/system/
sudo systemctl enable --now open-arch-share
```

`journalctl -u open-arch-share` shows its log. To update it, replace the file and `sudo systemctl restart open-arch-share`.

On a Mac, [`apps/server/macos/open-arch-share.plist`](apps/server/macos/open-arch-share.plist) is a launchd job for your user. It starts when you log in, keeps its data in `~/Library/Application Support/open-arch-share`, and listens only on the Mac, for a reverse proxy in front too. launchd doesn't expand `~`, so `sed` puts your home folder in as it's installed:

```bash
sudo mkdir -p /usr/local/bin
sudo cp open-arch-share-macos-arm64 /usr/local/bin/open-arch-share
sed "s|__HOME__|$HOME|g" apps/server/macos/open-arch-share.plist > ~/Library/LaunchAgents/io.github.danyo1399.open-arch-share.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/io.github.danyo1399.open-arch-share.plist
```

Its log is `~/Library/Logs/open-arch-share.log`. To stop it, `launchctl bootout gui/$(id -u)/io.github.danyo1399.open-arch-share`. To update it, replace the file and `launchctl kickstart -k gui/$(id -u)/io.github.danyo1399.open-arch-share`.

### In a container

Each [release](#releases) publishes an image of the server, with the executable and nothing else, about 17 MB, for x64 and arm64. Run it with a volume for `/data`, so what's shared outlives the container:

```bash
docker run -d --name open-arch-share -p 8787:8787 -v open-arch-share:/data ghcr.io/danyo1399/open-arch-share
```

To build the image yourself, from [`apps/server/Dockerfile`](apps/server/Dockerfile), for this machine or with `--platform linux/arm64` for another:

```bash
docker build -t open-arch-share apps/server
docker run -d --name open-arch-share -p 8787:8787 -v open-arch-share:/data open-arch-share
```

Or with Compose, from [`apps/server/compose.yaml`](apps/server/compose.yaml):

```bash
docker compose -f apps/server/compose.yaml up -d
```

Settings are environment variables (`-e TRUST_PROXY=forwarded`). The image runs as an unprivileged user, checks its own health, and stops cleanly when the container is stopped. A hosting platform that runs containers runs it too, as long as it keeps `/data` on a disk that lasts: one without, such as a serverless container, forgets what's shared when it restarts.

### Taking down abuse

Find a workspace by its ID (the `share` in its link), or by who uploaded it, then block it. Its files are kept, but no longer served. To stop an address uploading, block it too, or block a whole IPv6 network by its /64, like `2001:db8:1:2::/64`. They work while the server runs, on the same data folder: add `--data <folder>` if it isn't `./data`.

```bash
open-arch-share uploads --workspace <id>
open-arch-share uploads --ip <address or IPv6 /64>
open-arch-share block <id> --reason "<why>"
open-arch-share block-ip <address or IPv6 /64> --reason "<why>"
```

`unblock` and `unblock-ip` undo them. Unblocking an address in a blocked IPv6 /64 says the network is still blocked, and how to unblock it. As the systemd service, run them as its user: `sudo -u open-arch-share open-arch-share block <id> --data /var/lib/open-arch-share --reason "<why>"`. As the launchd job on a Mac, give its folder: `--data ~/Library/Application\ Support/open-arch-share`. In a container, `docker exec open-arch-share open-arch-share …`, or with Compose, `docker compose -f apps/server/compose.yaml exec share open-arch-share …`.

A browser that cached a version's file can still open it offline. Online, opening a link asks the server first, so it won't open.

### Trying it locally

Run the share server from its source, with everything in memory, on <http://localhost:8787>:

```bash
pnpm --filter @open-arch/server dev
```

Then run the designer against it:

```bash
VITE_SHARE_SERVER=http://localhost:8787 pnpm --filter @open-arch/web dev
```

`pnpm --filter @open-arch/server start` keeps what's shared in `apps/server/data` instead, and `pnpm --filter @open-arch/server test` runs its tests.

## Using it in a project

```bash
open-arch init
```

This creates `architecture.openarch` and generates its docs beside it: `README.md`, `elements/` and `views/`. In an empty folder, made for the architecture, it creates them there. Anywhere else, such as the top of a Git repository, it puts them in a folder of their own, `architecture/`, apart from your own files. A file you name, as in `open-arch init design/shop.openarch`, has its docs beside it if its folder is empty or is `docs/architecture` already, and otherwise in `docs/architecture` beside it. `--docs <folder>` puts the docs in another folder. It also installs the agent skill at the repository's top, and adds a section to `AGENTS.md` telling agents to use it. Then open the file in the desktop app, or ask an agent to model the system. In Chrome or Edge, the web app can open the folder and edit the file there too, with **Open folder…**. Other browsers can't change the file itself: import it there, then export it back over the file when you're done.

## Development

Needs Node.js 22+, pnpm, and Go 1.26+ for the share server. The designer's tests run its sharing against the share server, so `pnpm test` builds it too.

```bash
pnpm install
```

```bash
pnpm test
```

Run the web designer with live reload on http://localhost:5173:

```bash
pnpm --filter @open-arch/web dev
```

Build the static web app into `apps/web/dist`:

```bash
pnpm --filter @open-arch/web build
```

Run the desktop app (builds the web app first):

```bash
pnpm --filter @open-arch/desktop start
```

Run the desktop app against the web dev server, so UI changes reload live (start the web dev server first):

```bash
pnpm --filter @open-arch/desktop dev
```

Run either way, or with Electron on `apps/desktop`, the app keeps the file it last opened, and Electron's other data, in the checkout's own `apps/desktop/user-data/`. So it never reopens a file that a copy in another worktree, or the installed app, last opened.

Check the desktop app end to end against a temporary copy of the example; screenshots go to `apps/desktop/smoke/`. With no display on Linux, it runs the app under `xvfb-run`:

```bash
pnpm --filter @open-arch/desktop smoke
```

Package installers for the current platform into `apps/desktop/release/`:

```bash
pnpm --filter @open-arch/desktop dist
```

Run every check a change must pass before it's merged, the same ones as CI (see [AGENTS.md](AGENTS.md#checks)):

```bash
pnpm verify
```

Have a branch reviewed by Claude, checked, and merged into `main`, from its worktree (see [AGENTS.md](AGENTS.md#review-and-merge)):

```bash
pnpm land --task "<what the branch is for>"
```

Build and use the CLI:

```bash
pnpm build
```

```bash
pnpm open-arch show --file examples/shop/shop.openarch
```

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs when you start it from the Actions tab (**CI**, then **Run workflow**), and as the first part of a [release](#releases). It doesn't run on pushes or pull requests: `pnpm verify` runs the same checks before merging. They test the desktop app only on your own system, so start a run on `main` by hand to check macOS and Windows.

It has three jobs:

- **lint** (Ubuntu): typecheck, tests, the share server's Go tests, the CLI build, then `open-arch check`, `fmt --check` and `export --check` on the example.
- **desktop** (macOS, Windows and Linux): the smoke test (under `xvfb-run` on Linux), then unsigned installers built with `dist`. The smoke screenshots and the installers (`.dmg`/`.zip`, `.exe`, `.AppImage`/`.deb`) are uploaded as artifacts of the run.
- **share server** (Linux on x64 and arm64, and macOS on arm64): runs the share server's Go tests, builds [its executables](#as-an-executable), runs the one for each machine, and uploads them as `.tar.gz` artifacts of the run. There's no Intel Mac, so the macOS x64 executable is only checked to be one.

## Releases

[`.github/workflows/release.yml`](.github/workflows/release.yml) publishes a release on GitHub, with the desktop app's installers and the share server's executables. Start it from the Actions tab: **Release**, then **Run workflow**. Pick the branch, normally `main`, and give the version, such as `1.2.0`. A version like `1.2.0-rc.1` is marked as a pre-release, and its image isn't tagged `latest`.

It runs [CI](#ci) first, building everything as that version, and stops if any check fails. Then it makes the release, with a tag `v<version>` on the commit it ran on:

- the desktop app: a `.dmg` and a `.zip` for macOS on Apple Silicon, an installer for Windows, an `.AppImage` for Linux, and a `.deb` for Debian and Ubuntu, all unsigned
- the share server: a `.tar.gz` for each of Linux and macOS, on x64 and arm64
- `SHA256SUMS`, to check a download against, and notes that say what each file is for

And it publishes the share server's Docker image on GitHub's container registry, for x64 and arm64: `ghcr.io/<owner>/open-arch-share:<version>`, and `:latest` for a release that isn't a pre-release.

These are the files CI built in that run, not new builds: each installer is built on the machine that smoke-tested the app, and each executable on one that ran it, except the macOS x64 one. The image holds the Linux executables.

A new package on GitHub's container registry starts out private, and a workflow can't change that. After the first release, make it public once: on the repository owner's **Packages** tab, open **open-arch-share**, then **Package settings**, **Change visibility**, **Public**. Until then, each release warns that only you can pull it. The version must be new: it stops straight away if there's already a tag for it.
