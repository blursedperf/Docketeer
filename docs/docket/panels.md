# Your own Docket panels

The Docket's panels (Units, Outline, Authorities, Cite, Homebase, Layout, and any a plugin adds) can be hidden and
put in another order, and you can add panels of your own, built from **elements**:

| Element | Shows |
|---|---|
| Commands | A row for each command you choose (Caselore's or a plugin's), with its key; Enter runs it |
| File tree | A folder and everything in it (or the whole homebase), as in Homebase › Files: N and F make a note or folder |
| Note list | Notes in a folder, with a tag, recent, pinned, or matching words (as the Docket's search finds them) |
| Built-in section | What another panel shows: Units, the open note's Outline, Authorities, Layout … |

Each element has a heading (its own, or one made from what it shows). A panel can hold any number of them.

## In the Docket

- **Arrange the Docket's panels** (a command; also in Homebase): every panel, with its tab number or *Hidden*. Enter on
  one: show or hide it, move it earlier or later, and for your own panels change what it shows, rename or delete
  it. *New panel…* makes one; *Show every panel in its usual order* undoes the arranging (your panels stay).
- **New Docket panel…**: asks for a name, then shows what it holds, with *Add commands…*, *Add a file tree…*, *Add
  a note list…* and *Add a built-in section…*.
- **Customise this panel…** at the end of each of your panels opens the same list. Enter on an element to change
  it, give it a heading, move it up or down, or remove it.

Everything is chosen from lists, so it all works from the keyboard; typing filters a list. With the mouse, drag
instead: a Docket tab onto another tab, a panel onto another in *Arrange the Docket's panels*, or an element onto
another in a panel's list of what it shows, and it takes that place.

## Starting layouts

Creating a homebase (on the welcome screen, or *Create a new homebase…*) asks which panels it starts with:

- **Legal**: the panels as Caselore comes (Authorities, Outline, Units, Cite, Homebase, Layout).
- **Generic**: three panels, *Files and Folders* (the whole homebase as a tree), Homebase and Layout. The others are
  hidden, not gone: *Arrange the Docket's panels* shows them again. This is written to `.quire/panels.json` in the
  new homebase (a folder that already has one keeps it).
- **Your templates**: *Save this homebase's panels as a template…* (a command, and a row near the end of *Arrange
  the Docket's panels*) keeps this homebase's `.quire/panels.json` under a name, in the app's settings
  (`homebaseTemplates`), so every homebase can use it. Creating a homebase offers each template after Legal and
  Generic; choosing one writes its panels into the new folder (again, not over a panels file already there) and makes
  the folders its file trees and folder note lists show, so they are not empty. Only folders inside the homebase are
  made, never hidden ones. *Remove a homebase template…* deletes one; homebases made from it are not changed.

A hidden panel keeps working where something opens it directly (the header's subject › topic opens Units even when
Units is hidden).

## The file

Panels are kept in `.quire/panels.json` in the homebase, which can also be edited by hand (Caselore reads it when the
homebase opens; anything it does not understand is left out):

```json
{
	"panels": [
		{ "id": "my-week", "title": "My week", "icon": "calendar", "elements": [
			{ "type": "commands", "commands": ["app:new-note", "media:insert-timestamp"] },
			{ "type": "notes", "rule": { "kind": "tag", "tag": "torts" }, "limit": 5 },
			{ "type": "files", "folder": "Torts/Negligence", "title": "Negligence files" },
			{ "type": "section", "panel": "core:outline" }
		] }
	],
	"order": ["core:units", "custom:my-week"],
	"hidden": ["core:cite"]
}
```

- `rule.kind` is `folder` (with `folder`), `tag` (with `tag`), `recent`, `pinned` or `search` (with `query`);
  `limit` is how many notes (20 if not given).
- `order` lists panel ids to put first, in that order; the others follow in their usual order. A custom panel's id is
  `custom:` and its own `id`. The built-in ones are `core:authorities`, `core:outline`, `core:units`, `core:cite`,
  `core:homebase` and `core:layout`.
- To find a command's id, choose the command in the Docket (*Add commands…*): the id is then in the file.
