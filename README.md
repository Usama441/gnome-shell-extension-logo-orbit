# Logo Orbit — GNOME Shell extension

Hover the Ubuntu logo on your wallpaper to open an orbit of your Desktop
files and folders.

## Features

- **Your Desktop in a circle** — everything in `~/Desktop` lives in the orbit
  instead of cluttering the screen. Folders come first; extra items fill
  further rings, with no limit.
- **Smooth open and close** — the logo spins while items swirl out of it ring
  by ring and the dark disc grows with them. Closing is the same in reverse.
- **Drag & drop**
  - Drag an item out of the orbit onto the desktop to keep it there as a
    normal desktop icon.
  - Drag a desktop icon, or files from Files, onto the open orbit to add them.
    Files from other folders are moved onto the Desktop; name clashes get
    " (2)", " (3)", ...
- **Folder peek** — rest the pointer on a folder for 2 s and a side panel
  lists what's inside. Click subfolders to browse into them, or files to open
  them.
- **Black hole** — leave the orbit open for a minute and it collapses: every
  item spirals into the logo, then the orbit closes. It's only an animation;
  nothing on disk changes.

## Usage

| Action | Result |
| --- | --- |
| Hover the logo | Open the orbit |
| Move the pointer off the disc | Close the orbit |
| Click an item | Open it |
| Click the centre logo | Open `~/Desktop` in Files |
| Rest on a folder for 2 s | Peek inside it |
| Drag an item out | Put it back on the desktop |
| Drag files onto the orbit | Add them to the circle |

On the **Snowy Ubuntu** wallpaper the extension's logo sits exactly over the
printed logo. On any other wallpaper it appears in the centre of the main
screen.

## Requirements

- GNOME Shell 48, 49 or 50
- The Desktop Icons NG (DING) extension, which Ubuntu ships by default, for
  the desktop-icon features

## Install

```sh
git clone https://github.com/Usama441/gnome-shell-extension-logo-orbit.git \
  ~/.local/share/gnome-shell/extensions/logo-orbit@usama
glib-compile-schemas ~/.local/share/gnome-shell/extensions/logo-orbit@usama/schemas
```

Log out and back in (on Wayland), then enable it:

```sh
gnome-extensions enable logo-orbit@usama
```

## Settings

Open the preferences from the Extensions app, or run:

```sh
gnome-extensions prefs logo-orbit@usama
```

| Setting | Default | Range |
| --- | --- | --- |
| Black hole enabled | on | on / off |
| Seconds before the orbit collapses | 60 s | 5 s – 1 h |
| Fall animation per item | 1.8 s | 0.3 – 20 s |

Changes apply right away.

## How it works

- Items in the circle are hidden from the desktop icons by listing them in
  `~/Desktop/.hidden`. Files are never moved. Your own `.hidden` entries are
  kept, and the file is restored when the extension is disabled.
- Which items you dragged out onto the desktop is saved in
  `~/.local/share/logo-orbit/state.json`.
- The logo is drawn just above the wallpaper, so open windows cover it as
  normal.

## Uninstall

```sh
gnome-extensions disable logo-orbit@usama
rm -rf ~/.local/share/gnome-shell/extensions/logo-orbit@usama \
       ~/.local/share/logo-orbit
```

Disabling first restores your `~/Desktop/.hidden`, so all desktop icons
come back.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
