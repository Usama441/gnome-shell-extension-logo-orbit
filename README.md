# Logo Orbit — GNOME Shell extension

Hover the Ubuntu logo on your wallpaper to open an orbit of your Desktop
files and folders.

## Features

- **Orbit of Desktop items** — everything on `~/Desktop` lives in the circle
  (hidden from the desktop icons via `~/Desktop/.hidden`; files are never
  moved). Extra items fill further rings.
- **Smooth open/close** — the logo spins while items swirl out ring by ring,
  and back in on close.
- **Drag & drop** — drag items out of the circle onto the desktop, or drag
  desktop icons / files from Files onto the orbit to add them.
- **Folder peek** — rest on a folder for 2 s to browse its contents in a
  side panel.
- **Black hole** — leave the orbit open and it collapses, pulling every item
  into the logo (animation only; nothing on disk changes). Configurable in
  the preferences.

## Requirements

GNOME Shell 48, 49 or 50.

## Install

```sh
git clone https://github.com/Usama441/gnome-shell-extension-logo-orbit.git \
  ~/.local/share/gnome-shell/extensions/logo-orbit@usama
glib-compile-schemas ~/.local/share/gnome-shell/extensions/logo-orbit@usama/schemas
```

Log out and back in (Wayland) or restart the shell, then:

```sh
gnome-extensions enable logo-orbit@usama
```

## Preferences

```sh
gnome-extensions prefs logo-orbit@usama
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
