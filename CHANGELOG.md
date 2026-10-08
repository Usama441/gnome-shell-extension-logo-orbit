# Changelog — Logo Orbit (`logo-orbit@usama`)

All notable changes to this extension are recorded here, newest first.
The version number matches `"version"` in `metadata.json`.

## [17] — 2026-10-08

### Changed
- **Opening and closing are one smooth animation.** Hovering the logo no
  longer spins it first and then pops the whole circle open. Now the logo
  spins while the folders and files swirl out of it one after another,
  inner ring first, and the dark disc grows out of the logo with them.
  Closing is the same in reverse: the items swirl back into the logo,
  outer ring first, while it spins the other way and the disc shrinks
  away, so the logo ends up exactly where it started.
- Items can't be hovered or clicked until they've reached their places.
- Closing is a little quicker than opening (about 0.7 s against 1 s).
- Hovering the logo while dragging a file still opens the orbit at once,
  without the spin, so you can drop straight away.
- Closing while the orbit is a black hole is still a quick shrink into the
  logo, since the items are already scattered.

## [16] — 2026-10-08

### Changed
- **Closing is animated too.** When the pointer leaves, the orbit shrinks back
  into the logo (the reverse of how it opens) and the logo then spins once the
  other way. Before, the orbit just faded out quickly.

## [15] — 2026-10-08

### Changed
- **The black hole closes when it's done.** Once every item has fallen in,
  the dark disc and the event horizon collapse into the logo, the logo stops
  spinning and settles back to its normal size, and the orbit closes. It
  won't reopen until you move the pointer off the logo and back onto it.
  Before, the hole kept spinning for as long as the pointer stayed there.

## [14] — 2026-10-08

### Added
- **Black hole settings.** Open the extension's preferences (Extensions app,
  or `gnome-extensions prefs logo-orbit@usama`) to turn the black hole off,
  choose how many seconds the orbit stays open before it collapses
  (5 s – 1 h, default 60 s), and set how long the fall animation takes
  (0.3 – 20 s per item, default 1.8 s). Changes apply right away.

## [13] — 2026-10-08

### Added
- **The orbit becomes a black hole.** Keep the orbit open for a minute and
  it collapses: the disc goes dark, the logo turns into a glowing event
  horizon and spins, and every folder and file spirals into it, nearest
  rings first. Any open folder panel closes first, and it waits while you
  are dragging something. It's only an animation, so nothing on disk is moved.
  Move the pointer away and everything is back the next time the orbit
  opens.

## [12] — 2026-10-08

### Fixed
- **The folder panel no longer closes on the way to it.** Moving the pointer
  from a folder to its panel often crossed another orbit item, which closed
  the panel at once. Passing over items now keeps it open; only resting on
  another item for 0.6 s closes it.

### Changed
- **The panel opens on the folder's side.** A folder on the left half of the
  orbit opens its panel to the left, one on the right half to the right
  (falling back to the other side if there's no room on the screen).
- **Browse into subfolders inside the panel.** Clicking a folder in the panel
  now shows its contents in the panel instead of opening Files, with a back
  button to go up. Files still open in their app, and clicking the folder name
  at the top opens the folder shown in Files.

## [11] — 2026-10-08

### Fixed
- **The folder peek panel shows its contents.** The panel kept the small
  height it had while showing "Loading…", so the entries were squeezed into an
  empty strip with only a scrollbar visible. It now grows to fit the list once
  the folder has been read.

## [10] — 2026-10-08

### Added
- **Peek inside folders.** Rest the pointer on a folder in the orbit for
  2 seconds and a panel opens beside the orbit (on whichever side has room)
  listing what's inside: folders first, then files, alphabetically, without
  hidden files. Click an entry to open it, or click the folder name at the top
  to open the folder itself. The list scrolls when it's long and shows at most
  500 entries. The orbit stays open while the pointer is on the panel; moving
  onto another item, leaving both, or dragging an item closes it. Folders are
  read in the background, so a large folder never freezes the shell.

## [9] — 2026-10-08

### Fixed
- **Dragging files into the circle is smooth.**
  - Files dragged in from Files no longer flash up on the desktop for a few
    seconds first. Their names go into `.hidden` before they are moved onto
    the Desktop, so the desktop icons never show them.
  - When the open orbit changes (an item is added or removed), the items
    glide to their new places and new items pop in, instead of the whole
    orbit snapping in one frame.
  - While you are holding a dragged file, hovering the logo opens the orbit
    straight away without the spin.
  - Several dropped files with the same name each get their own " (2)",
    " (3)", ... instead of colliding.

## [8] — 2026-10-08

### Fixed
- **Items dragged out of the circle now appear on the desktop right away**
  instead of only after a refresh. The temporary file used to make the desktop
  icons re-read the folder was written empty, which GJS turns into a failed
  write, so the desktop icons never noticed the change.

## [7] — 2026-10-08

### Added
- **Everything on the Desktop lives in the circle by default.** Desktop items
  that are in the circle are hidden from the desktop icons by listing them in
  `~/Desktop/.hidden` (files are never moved). Your own `.hidden` entries are
  kept, and the list is restored when the extension is disabled. New files that
  land on the Desktop go into the circle automatically. The circle has no item
  limit any more: extra items fill further rings.
- **Drag an item out of the circle onto the desktop** to put it back on the
  screen as a normal desktop icon, at the spot where you dropped it. It stays
  out until you drag it back in. Dropping it inside the orbit or on a window
  cancels the drag.
- **Drag files or folders onto the open orbit to add them.** Drag a desktop
  icon onto the orbit to put it back in the circle. Files dragged from Files
  (or any other folder) are moved onto the Desktop, which adds them to the
  circle; a name clash gets " (2)", " (3)", ... The orbit's rim lights up while
  a drop would be accepted.
- Which items were dragged out is saved in `~/.local/share/logo-orbit/state.json`.

### Changed
- **No more orange in the orbit.** The centre logo no longer gets an orange
  tint on hover, and the disc's orange border and glow were replaced with a
  neutral dark glass look (thin white rim, soft dark shadow). Item hover is a
  soft white highlight.

## [6] — 2026-10-08

### Fixed
- **The logo no longer shows on top of open apps.** It was added to the window
  group next to the wallpaper, but Mutter re-orders that group whenever window
  stacking changes (focus, new window, raise) and left the logo above every
  window. The logo now lives inside the wallpaper's background group, which is
  always kept below all windows, and it is re-raised above the wallpaper when
  the backgrounds are rebuilt (e.g. on monitor changes).

## [5] — 2026-10-08

### Changed
- **The logo background is now transparent.** The orange disc was removed from
  `logo.svg`, so only the white "circle of friends" is drawn. The orange glow
  around the logo was removed as well (no shadow).
- **Hovering the logo spins it once (360°, 0.6 s) and then opens the orbit.**
  The orbit opens only if the pointer is still on the logo when the spin ends.

### Fixed
- **No more jerk when the orbit opens.** The logo in the middle of the orbit no
  longer shrinks and bounces with the ring; only the disc and items grow in.
  The drawn logo and the orbit's centre logo now sit on the exact same pixel,
  so the hand-off between them is seamless.

## [4] — 2026-10-08

### Removed
- **Esc no longer closes the orbit.** The orbit closes only on un-hover, when the
  pointer moves outside the disc (or after clicking an item, or when the
  Activities overview opens). The orbit no longer takes keyboard focus, so
  typing in the focused window is never interrupted. (Reverts the Esc part of
  version 2.)

## [3] — 2026-10-08

### Added
- **The extension now draws its own visible logo** (`logo.svg`): the Ubuntu
  "circle of friends" in white on a round orange disc with a soft orange glow.
  It sits just above the wallpaper, so open windows still cover it as normal.
  - On the Snowy Ubuntu wallpaper it is placed exactly over the printed logo.
  - On any other wallpaper/mode it appears in the centre of the main screen
    (radius 72 px), so the orbit works with every wallpaper.
- The logo is also shown in the middle of the open orbit (click it to open the
  Desktop folder).

### Changed
- The logo and orbit live on the main (primary) screen only. The
  "follow the pointer across monitors" behaviour from version 2 was removed,
  since there is now one drawn logo instead of one printed on every screen.
- Hovering no longer turns off on non-Snowy wallpapers (the drawn logo is
  always there to hover).

## [2] — 2026-10-08

### Changed
- Source moved to `~/Desktop/logo-orbit@usama`. The install location
  `~/.local/share/gnome-shell/extensions/logo-orbit@usama` is now a symlink to it.
- Logging uses `console.error` instead of the deprecated `logError`.

### Fixed
- **Desktop changes no longer stall the shell.** File-change events are debounced
  (300 ms) before the Desktop folder is re-read, so a burst of events (e.g. a large
  download being written) causes one re-read instead of hundreds.
- **Logo position is no longer tied to one setup.**
  - Follows the pointer across monitors, so the orbit works on every screen.
  - Supports the `zoom`, `scaled`, `stretched` and `centered` wallpaper modes.
  - Turns itself off (instead of triggering in the wrong spot) when the wallpaper
    isn't Snowy Ubuntu or the mode is `wallpaper`/`spanned`/`none`.
  - Re-positions live when the wallpaper, wallpaper mode, light/dark style or
    monitor layout changes.
- **Esc closes the orbit.** It takes keyboard focus while open, and gives focus
  back to the previously focused window when closed by Esc or by moving away.
  (It doesn't restore focus after opening an item, so the launched app keeps focus.)
- `disable()` now clears all state (timers, settings handlers, cached items,
  geometry, visibility, keyboard focus).

## [1] — 2026-10-08

### Added
- Initial version: hovering the Ubuntu logo on the Snowy Ubuntu wallpaper shows a
  ring of up to 16 Desktop items (folders first). Clicking an item opens it, and
  clicking the logo opens the Desktop folder.
