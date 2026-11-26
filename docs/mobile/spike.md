# Phase 0 spike: does editing feel right on iPhone and iPad?

The question from [PLAN.md](PLAN.md), Phase 0: does CodeMirror 6 live preview feel right on an iPhone keyboard and
an iPad with a Magic Keyboard? This is the Phase 0 shell: the desktop layout, the example homebase held in memory
(edits are not saved), no compact layout yet.

## Simulators (2026-11-26)

iOS 27.2 simulators, iPhone 17 and iPad Pro 11-inch (M5), Debug build: the app boots into the example homebase
on both, with no console errors and no refused navigations.

| iPhone 17 | iPad Pro 11-inch |
|---|---|
| ![iPhone simulator](spike/iphone-simulator.png) | ![iPad simulator](spike/ipad-simulator.png) |

## iPhone (2026-11-27)

Tried by the owner on an iPhone 15 Pro Max, from Xcode.

- **Editing feels great.** No problems reported with typing or live preview.
- **Opening is very fast**: the example homebase is there at once.
- **The Docket is too wide for the iPhone.** Expected: the phone gets the Docket as a sheet in Phase 3.
- **Tabs take too much room.** The owner suggests putting open tabs behind a "show open tabs" button on the
  phone. Added to Phase 3 (compact layout).

Not reported on yet: selection handles and the edit menu, autocorrect, dictation, undo (shake or three-finger
swipe), `[[` suggestions by touch.

## iPad

Not tried yet. To check: a Magic Keyboard, whether ⌘D reaches the page and opens the Docket, and whether ⌘2, ⌘\
and the other defaults reach the app or are taken by iPadOS.

## Verdict

Pending the iPad. On the iPhone, editing is right as it is; the work is in the layout (Phase 3).
