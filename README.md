# Logo Orbit — GNOME Shell extension

Hover the Ubuntu logo on your wallpaper to open an orbit of your Desktop
files and folders.

![The orbit opening when the pointer rests on the logo](docs/open.gif)

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

  ![Dragging an item out of the orbit onto the desktop](docs/drag-drop.gif)

- **Folder peek** — rest the pointer on a folder for 2 s and a side panel
  lists what's inside. Click subfolders to browse into them, or files to open
  them.

  ![Resting on a folder opens a side panel with its contents](docs/peek.gif)

- **Black hole** — leave the orbit open for a minute and it collapses: every
  item spirals into the logo, then the orbit closes. It's only an animation;
  nothing on disk changes.

  ![Items spiralling into the logo as the orbit collapses](docs/black-hole.gif)

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

- GNOME Shell 50 (tested on Ubuntu 26.04, Wayland). Older versions are not
  listed because they haven't been tested.
- The Desktop Icons NG (DING) extension, which Ubuntu ships by default, for
  the desktop-icon features

## Install

### From extensions.gnome.org

Once published, install it from
[extensions.gnome.org](https://extensions.gnome.org/) or the Extension
Manager app.

### From a release ZIP

```sh
gnome-extensions install --force logo-orbit@usama.shell-extension.zip
```

Log out and back in (on Wayland), then enable it:

```sh
gnome-extensions enable logo-orbit@usama
```

### From source

```sh
git clone https://github.com/Usama441/gnome-shell-extension-logo-orbit.git \
  ~/.local/share/gnome-shell/extensions/logo-orbit@usama
glib-compile-schemas ~/.local/share/gnome-shell/extensions/logo-orbit@usama/schemas
```

Then log out and back in and enable it as above.

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

## Troubleshooting

- **The logo doesn't appear.** Check that the extension is enabled and
  active: `gnome-extensions info logo-orbit@usama`. On a wallpaper other
  than Snowy Ubuntu, look in the centre of the main screen.
- **The orbit doesn't open.** It only opens when nothing but the desktop is
  under the pointer — move windows out of the way, and close the overview.
- **Items show on the desktop and in the circle.** The desktop icons cache
  `~/Desktop/.hidden` for a few seconds; wait about 10 s.
- **Desktop icons are missing after uninstalling.** Disable the extension
  before removing it so it can restore `~/Desktop/.hidden`. If you removed
  it first, delete the extra names from `~/Desktop/.hidden` by hand.
- **Errors.** Follow the shell log while you reproduce the problem, and
  include the output in a bug report:

  ```sh
  journalctl --user -f -o cat /usr/bin/gnome-shell | grep -i 'logo orbit'
  ```

## Development

The extension is plain GJS — no build step.

1. Clone the repository into
   `~/.local/share/gnome-shell/extensions/logo-orbit@usama` (or symlink it
   there).
2. Compile the settings schema:
   `glib-compile-schemas schemas`.
3. Test in a nested GNOME Shell so your real session isn't affected
   (needs the `mutter-devkit` helper; on Ubuntu it comes from the
   `mutter-dev-bin` package):

   ```sh
   dbus-run-session gnome-shell --devkit --wayland
   ```

   On Wayland, the running session only loads changed code after you log
   out and back in.
4. Build the upload ZIP:

   ```sh
   mkdir -p dist
   gnome-extensions pack --force --extra-source=logo.svg --extra-source=LICENSE --out-dir=dist .
   ```

   This writes `dist/logo-orbit@usama.shell-extension.zip`.

## Wallpapers

The [`wallpapers`](wallpapers) folder has a few dark backgrounds that suit
the orbit. They are photos from [Unsplash](https://unsplash.com), used under
the [Unsplash License](https://unsplash.com/license), by Adrien Olichon,
Daniel Olah and Eastman Childs.

## Credits

Written by [Usama](https://github.com/Usama441). The Ubuntu logo is a
trademark of Canonical Ltd.

## License

Logo Orbit is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 2 of the License, or (at your option) any later
version. See [LICENSE](LICENSE).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
