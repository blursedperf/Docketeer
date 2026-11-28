# Writing plugins

Plugins add commands, views, Docket panels, searches, editor features and more. The four built-in plugins use the
same API as any other, so they are complete examples of what a plugin can do.

## A plugin

A plugin is a folder in `<homebase>/.quire/plugins/<id>/` with:

- `manifest.json`: its id, name, version and the oldest Docketeer it needs (`minAppVersion`);
- `main.js`: an **ES module** whose default export extends `Plugin`;
- `styles.css` (optional).

```ts
import { Notice, Plugin } from '@quire/api';

export default class Hello extends Plugin {
	async onload() {
		this.addCommand({ id: 'hello', name: 'Say hello', callback: () => new Notice('Hello') });
	}
}
```

Bundle it with esbuild (`format: 'esm'`), marking `@quire/api`, `@codemirror/*` and `@lezer/*` as external: Docketeer
supplies its own copies when the plugin runs. Turn it on under **Settings → Plugins**.

## What a plugin can do

- Commands, with default keys, that appear in the Docket.
- Views in tabs, settings tabs, the status bar, menus and notices.
- CodeMirror 6 editor extensions and suggestions as you type.
- **Docket panels**: rows, sections and actions that move and behave like the Docket's own (`registerDocketPanel`).
- **Search providers**: results of its own in the Docket's search, on a prefix of its own, as `~` is (`registerSearchProvider`).
- Read and write notes through the vault, and their links, tags, headings and properties through the metadata cache.
- Palettes, through `registerPalette`.

## The rules

**Offline is absolute.** A plugin cannot reach the network: requests are refused by the app whatever the code tries.
Plugins should also respect locked notes: `app.isLocked(file)` says a note is locked, and the `lock-change` event
says when that changes, so a plugin can avoid keeping a copy of what is in one.

## Learning more

- The built-in plugins are complete examples:
  [AGLC4](https://github.com/blursedperf/Docketeer/tree/master/plugins/aglc4),
  [Task Docket](https://github.com/blursedperf/Docketeer/tree/master/plugins/task-docket),
  [Whole-Tree Search](https://github.com/blursedperf/Docketeer/tree/master/plugins/whole-tree-search) and
  [Pomodoro Flashcards](https://github.com/blursedperf/Docketeer/tree/master/plugins/pomodoro-flashcards).
- The API itself: [`packages/api`](https://github.com/blursedperf/Docketeer/tree/master/packages/api).
