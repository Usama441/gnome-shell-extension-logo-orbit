import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getPointerWatcher} from 'resource:///org/gnome/shell/ui/pointerWatcher.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Logo position inside the wallpaper image, as fractions of its size
// (measured from moskalenko-v-Snowy_Ubuntu_*.webp, 3840x2160).
const WALLPAPER_MATCH = 'Snowy_Ubuntu';
const IMAGE_W = 3840, IMAGE_H = 2160;
const LOGO_X = 0.5406, LOGO_Y = 0.5185;
const LOGO_R = 0.0667; // radius as a fraction of the image width

// Used when the logo can't be matched to the wallpaper: centre of the main screen.
const DEFAULT_LOGO_R = 72;

const ITEM_SIZE = 96;
const ICON_SIZE = 48;
const HOVER_DELAY_MS = 120;
// Opening: the logo spins while the items spiral out of it one after another
// (inner rings first) and the disc grows with them. Closing is the reverse.
const OPEN_ITEM_MS = 560;      // each item's own flight
const OPEN_STAGGER_MS = 420;   // the last item starts this much after the first
const CLOSE_ITEM_MS = 400;
const CLOSE_STAGGER_MS = 280;
const SWIRL = Math.PI;         // how far round the logo an item swings on its way
const CLOSE_HOLE_MS = 280;     // closing while it's a black hole: a quick shrink
const RELOAD_DELAY_MS = 300;

// Resting on a folder in the orbit opens a side panel listing what's inside.
const PEEK_DELAY_MS = 2000;
// While the panel is open, crossing other items on the way to it doesn't
// close it; only resting on another item this long does.
const PEEK_SWITCH_MS = 600;
const PEEK_WIDTH = 280;
const PEEK_MAX_HEIGHT = 440;
const PEEK_GAP = 12;
const PEEK_MAX_ITEMS = 500;
const PEEK_ICON_SIZE = 24;
// Keep the orbit open for a while and it turns into a black hole that
// swallows every item (just an animation: nothing on disk is touched).
// The delay and fall length come from the settings (prefs.js).
const FALL_MS = 1800;          // default spiral time; the settings scale the whole fall
const FALL_STAGGER_MS = 350;   // outer rings start falling this much later
const HOLE_SCALE = 1.15;       // the hole's size relative to the logo
const HOLE_CLOSE_MS = 900;     // once everything is swallowed, the hole closes into the logo

const PEEK_ATTRS = 'standard::name,standard::display-name,standard::icon,standard::type,' +
    'standard::is-hidden,standard::is-backup';

// Items in the circle are hidden from the desktop icons (DING) by listing
// them in the Desktop's `.hidden` file. DING doesn't watch dotfiles, so we
// nudge it by creating and deleting a backup-named (`~`, never shown) file.
// GLib caches `.hidden` for 5-10 s, hence the repeated nudges.
const HIDDEN_FILE = '.hidden';
const POKE_NAME = 'logo-orbit-refresh~';
const POKE_RETRY_MS = [6000, 11000];

const easeOutCubic = t => 1 - (1 - t) ** 3;
const easeInCubic = t => t * t * t;
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

export default class LogoOrbitExtension extends Extension {
    enable() {
        this._desktopDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) ??
            GLib.build_filenamev([GLib.get_home_dir(), 'Desktop']);
        this._desktop = Gio.File.new_for_path(this._desktopDir);
        this._visible = false;
        this._dwellId = 0;
        this._reloadId = 0;
        this._pokeIds = [];
        this._peekId = 0;
        this._peek = null;        // the side panel showing a folder's contents
        this._peekItem = null;
        this._peekSide = 1;       // 1: panel right of the orbit, -1: left
        this._peekStack = [];     // folders browsed into inside the panel
        this._peekUi = null;
        this._peekCancel = null;
        this._spinning = false;   // the orbit is opening or closing
        this._orbitAnim = null;
        this._holeId = 0;
        this._blackHole = false;  // the orbit has collapsed into a black hole
        this._holeTimeline = null;
        this._holeClosed = false; // the hole closed the orbit; don't reopen until the pointer leaves
        this._settings = this.getSettings();
        this._settingsId = this._settings.connect('changed', () => {
            if (this._visible && !this._blackHole)
                this._armBlackHole();
        });
        this._center = null;
        this._dragging = false;   // dragging an item out of the circle
        this._extDrag = false;    // a file drag from an app (DING, Files) is in progress
        this._dragUris = null;
        this._dragFetching = false;
        this._items = [];
        this._userHidden = new Set();
        this._geom = null;
        this._logoIcon = Gio.FileIcon.new(this.dir.get_child('logo.svg'));

        this._statePath = GLib.build_filenamev([GLib.get_user_data_dir(), 'logo-orbit', 'state.json']);
        this._state = this._loadState();

        // Our own logo, drawn inside the background group so windows always cover it.
        // (A plain child of window_group ends up above every window once Mutter restacks.)
        this._logo = new St.Icon({gicon: this._logoIcon, style_class: 'logo-orbit-logo'});
        this._logo.set_pivot_point(0.5, 0.5);
        Main.layoutManager._backgroundGroup.add_child(this._logo);

        this._overlay = new St.Widget({
            reactive: true,
            visible: false,
            opacity: 0,
            layout_manager: new Clutter.FixedLayout(),
        });
        Main.layoutManager.uiGroup.insert_child_below(this._overlay, Main.layoutManager.panelBox);

        this._monitor = this._desktop.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitorId = this._monitor.connect('changed', (m, file) => {
            const name = file.get_basename();
            if (name !== POKE_NAME && name !== HIDDEN_FILE)
                this._queueReload();
        });
        this._layoutId = Main.layoutManager.connect('monitors-changed', () => this._relayout());

        // Re-check the logo position whenever the wallpaper or light/dark style changes.
        this._bgSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._bgSettingsId = this._bgSettings.connect('changed', () => this._relayout());
        this._ifaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._ifaceSettingsId = this._ifaceSettings.connect('changed::color-scheme', () => this._relayout());

        // File drags from apps (desktop icons, Files) onto the orbit.
        this._xdndBeginId = Main.xdndHandler.connect('drag-begin', () => {
            this._extDrag = true;
            this._dragUris = null;
            this._dragFetching = false;
        });
        this._xdndEndId = Main.xdndHandler.connect('drag-end', () => this._onExtDragEnd());

        this._reload();
        this._watch = getPointerWatcher().addWatch(50, (x, y) => this._onPointer(x, y));
    }

    disable() {
        this._watch?.remove();
        this._watch = null;
        if (this._dwellId)
            GLib.source_remove(this._dwellId);
        this._dwellId = 0;
        if (this._reloadId)
            GLib.source_remove(this._reloadId);
        this._reloadId = 0;
        this._pokeIds.forEach(id => GLib.source_remove(id));
        this._pokeIds = [];
        this._cancelPeekTimer();
        this._closePeek(false);
        this._cancelBlackHoleTimer();
        this._holeTimeline?.stop();
        this._holeTimeline = null;
        this._orbitAnim?.timeline.stop();
        this._orbitAnim = null;
        this._blackHole = false;
        this._holeClosed = false;
        this._settings.disconnect(this._settingsId);
        this._settings = null;
        Main.xdndHandler.disconnect(this._xdndBeginId);
        Main.xdndHandler.disconnect(this._xdndEndId);
        if (this._dragMonitor)
            DND.removeDragMonitor(this._dragMonitor);
        this._dragMonitor = null;
        this._monitor?.disconnect(this._monitorId);
        this._monitor?.cancel();
        this._monitor = null;
        Main.layoutManager.disconnect(this._layoutId);
        this._bgSettings?.disconnect(this._bgSettingsId);
        this._bgSettings = null;
        this._ifaceSettings?.disconnect(this._ifaceSettingsId);
        this._ifaceSettings = null;

        // Give the circle's items back to the desktop.
        this._writeHidden([...this._userHidden], []);
        this._pokeNow();

        this._overlay?.destroy();
        this._overlay = null;
        this._ring = null;
        this._disc = null;
        this._center = null;
        this._logo?.destroy();
        this._logo = null;
        this._items = [];
        this._geom = null;
        this._visible = false;
        this._spinning = false;
        this._dragging = false;
        this._extDrag = false;
        this._dragUris = null;
    }

    // --- Persistent state: which items were dragged out onto the desktop ---

    _loadState() {
        const state = {out: [], ours: []};
        try {
            const [, bytes] = GLib.file_get_contents(this._statePath);
            Object.assign(state, JSON.parse(new TextDecoder().decode(bytes)));
        } catch {
            // First run, or unreadable: everything starts in the circle.
        }
        state.out = new Set(state.out);
        return state;
    }

    _saveState() {
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(this._statePath), 0o700);
            GLib.file_set_contents(this._statePath, JSON.stringify({
                out: [...this._state.out],
                ours: this._state.ours,
            }));
        } catch (e) {
            console.error('Logo Orbit: cannot save state', e);
        }
    }

    // --- Desktop `.hidden` file (keeps the user's own entries) ---

    _readHidden() {
        try {
            const [, bytes] = this._desktop.get_child(HIDDEN_FILE).load_contents(null);
            return new TextDecoder().decode(bytes).split('\n').filter(l => l.length > 0);
        } catch {
            return [];
        }
    }

    // Write `.hidden` as the user's entries plus the circle's; returns true if it changed.
    _writeHidden(user, circle) {
        const current = this._readHidden();
        const wanted = [...user, ...circle];
        this._state.ours = circle;
        this._saveState();
        if (wanted.join('\n') === current.join('\n'))
            return false;
        const file = this._desktop.get_child(HIDDEN_FILE);
        try {
            if (wanted.length > 0) {
                file.replace_contents(new TextEncoder().encode(`${wanted.join('\n')}\n`),
                    null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            } else if (current.length > 0) {
                file.delete(null);
            }
        } catch (e) {
            console.error('Logo Orbit: cannot update .hidden', e);
        }
        return true;
    }

    // Make the desktop icons re-read the folder now and again once GLib's cache expires.
    _pokeDing() {
        this._pokeNow();
        this._pokeIds.forEach(id => GLib.source_remove(id));
        this._pokeIds = POKE_RETRY_MS.map(ms => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._pokeIds = this._pokeIds.filter(i => i !== id);
                this._pokeNow();
                return GLib.SOURCE_REMOVE;
            });
            return id;
        });
    }

    _pokeNow() {
        const file = this._desktop.get_child(POKE_NAME);
        try {
            // Must be non-empty: GJS passes an empty array as NULL and the write fails.
            file.replace_contents(new Uint8Array([10]), null, false, Gio.FileCreateFlags.NONE, null);
            file.delete(null);
        } catch (e) {
            console.error('Logo Orbit: cannot refresh desktop icons', e);
        }
    }

    // --- Logo geometry ---

    // True when the active wallpaper is the one the logo coordinates were measured from.
    _wallpaperMatches() {
        const dark = this._ifaceSettings.get_string('color-scheme') === 'prefer-dark';
        const uri = this._bgSettings.get_string(dark ? 'picture-uri-dark' : 'picture-uri');
        return uri.includes(WALLPAPER_MATCH);
    }

    // Where to draw the logo on the main screen: exactly over the wallpaper's
    // logo when we can locate it, otherwise the centre of the screen.
    _logoGeometry() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return null;
        return this._wallpaperLogoGeometry(m) ?? {
            cx: m.x + m.width / 2,
            cy: m.y + m.height / 2,
            r: DEFAULT_LOGO_R,
        };
    }

    // The wallpaper logo's position for the current wallpaper mode, or null
    // when it can't be located (other wallpaper, tiled, spanned, ...).
    _wallpaperLogoGeometry(m) {
        if (!this._wallpaperMatches())
            return null;

        let sx, sy;
        switch (this._bgSettings.get_string('picture-options')) {
        case 'zoom':
            sx = sy = Math.max(m.width / IMAGE_W, m.height / IMAGE_H);
            break;
        case 'scaled':
            sx = sy = Math.min(m.width / IMAGE_W, m.height / IMAGE_H);
            break;
        case 'stretched':
            sx = m.width / IMAGE_W;
            sy = m.height / IMAGE_H;
            break;
        case 'centered':
            sx = sy = 1;
            break;
        default:
            return null;
        }

        const offX = (m.width - IMAGE_W * sx) / 2;
        const offY = (m.height - IMAGE_H * sy) / 2;
        return {
            cx: m.x + offX + LOGO_X * IMAGE_W * sx,
            cy: m.y + offY + LOGO_Y * IMAGE_H * sy,
            r: LOGO_R * IMAGE_W * Math.min(sx, sy),
        };
    }

    // --- Desktop items ---

    _listDesktop() {
        const items = [];
        try {
            const en = this._desktop.enumerate_children(
                'standard::name,standard::display-name,standard::icon,standard::type',
                Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = en.next_file(null))) {
                const name = info.get_name();
                if (name.startsWith('.') || name.endsWith('~') || this._userHidden.has(name))
                    continue;
                items.push({
                    name,
                    label: info.get_display_name(),
                    icon: info.get_icon(),
                    isDir: info.get_file_type() === Gio.FileType.DIRECTORY,
                    file: this._desktop.get_child(name),
                });
            }
            en.close(null);
        } catch (e) {
            console.error('Logo Orbit: cannot read Desktop', e);
        }
        // Folders first, then files, alphabetically.
        items.sort((a, b) => (b.isDir - a.isDir) || a.label.localeCompare(b.label));
        return items;
    }

    // Everything on the Desktop is in the circle unless it was dragged out.
    _circleItems() {
        return this._items.filter(i => !this._state.out.has(i.name));
    }

    // Desktop changes arrive in bursts (e.g. while a large file is written),
    // so wait for them to settle before re-reading the folder.
    _queueReload() {
        if (this._reloadId)
            GLib.source_remove(this._reloadId);
        this._reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RELOAD_DELAY_MS, () => {
            this._reloadId = 0;
            this._reload();
            return GLib.SOURCE_REMOVE;
        });
    }

    _reload() {
        const ours = new Set(this._state.ours);
        this._userHidden = new Set(this._readHidden().filter(n => !ours.has(n)));
        this._items = this._listDesktop();

        // Forget dragged-out items that were deleted or renamed.
        const names = new Set(this._items.map(i => i.name));
        this._state.out = new Set([...this._state.out].filter(n => names.has(n)));

        if (this._writeHidden([...this._userHidden], this._circleItems().map(i => i.name)))
            this._pokeDing();
        this._relayout();
    }

    // --- Orbit layout ---

    // Place the logo and rebuild the overlay from the cached item list (no file IO).
    _relayout() {
        // While it's a black hole the orbit is rebuilt once it closes.
        if (!this._overlay || this._dragging || this._blackHole)
            return;
        // Rebuilding mid-animation: jump to its end first.
        this._finishOrbitAnim();
        // Remember where each item was on screen, to glide it from there.
        const before = new Map();
        if (this._visible && this._ring) {
            const [px, py] = this._overlay.get_position();
            for (const child of this._ring.get_children()) {
                if (child._itemName)
                    before.set(child._itemName, [px + child.x, py + child.y]);
            }
        }
        this._overlay.destroy_all_children();
        this._ring = null;
        this._disc = null;
        this._cancelPeekTimer();

        this._geom = this._logoGeometry();
        if (!this._geom) {
            this._logo.hide();
            this._hide();
            return;
        }

        const {cx, cy, r} = this._geom;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const iconSize = Math.round((r * 2) / scale);

        // Fill rings from the inside out, as many items per ring as fit.
        const items = this._circleItems();
        const slot = ITEM_SIZE * 1.05;
        const rings = [];
        let left = items.length, radius = r + ITEM_SIZE * 0.85;
        do {
            const count = Math.min(left, Math.max(1, Math.floor((2 * Math.PI * radius) / slot)));
            rings.push({radius, count});
            left -= count;
            radius += slot;
        } while (left > 0);

        const outer = rings[rings.length - 1].radius + ITEM_SIZE * 0.75;
        const size = Math.round(outer * 2);
        const ox = Math.round(cx - outer), oy = Math.round(cy - outer);
        const centerOff = Math.round(outer - r);

        // Same pixel position as the orbit's centre logo, so the hand-off doesn't shift it.
        this._logo.icon_size = iconSize;
        this._logo.set_position(ox + centerOff, oy + centerOff);
        this._logo.show();
        // Backgrounds are re-created on monitor changes; stay on top of them.
        this._logo.get_parent()?.set_child_above_sibling(this._logo, null);

        this._geom.outer = outer;
        this._overlay.set_position(ox, oy);
        this._overlay.set_size(size, size);

        // The disc and items grow in together; the centre logo stays put on top.
        this._ring = new St.Widget({layout_manager: new Clutter.FixedLayout(), width: size, height: size});
        this._ring.set_pivot_point(0.5, 0.5);
        this._overlay.add_child(this._ring);

        this._disc = new St.Widget({style_class: 'logo-orbit-disc', width: size, height: size});
        this._disc.set_style(`border-radius: ${size / 2}px;`);
        this._ring.add_child(this._disc);

        // The logo stays visible in the middle of the orbit; clicking it opens the Desktop folder.
        const center = new St.Button({
            style_class: 'logo-orbit-center',
            child: new St.Icon({gicon: this._logoIcon, icon_size: iconSize}),
            width: Math.round(r * 2), height: Math.round(r * 2),
            x: centerOff, y: centerOff,
        });
        center.connect('clicked', () => this._open(this._desktop));
        this._center = center;

        // Keep the folder panel next to the (possibly resized) orbit, or close
        // it if its folder left the circle.
        if (this._peek) {
            if (items.some(it => it.name === this._peekItem.name))
                this._placePeek();
            else
                this._closePeek();
        }

        let i = 0;
        rings.forEach(({radius: ring, count}, k) => {
            // Stagger every other ring so items don't line up behind each other.
            const shift = k % 2 ? Math.PI / count : 0;
            for (let j = 0; j < count; j++, i++) {
                const angle = -Math.PI / 2 + shift + (j / count) * 2 * Math.PI;
                const x = Math.round(outer + ring * Math.cos(angle) - ITEM_SIZE / 2);
                const y = Math.round(outer + ring * Math.sin(angle) - ITEM_SIZE / 2);
                const btn = this._makeItem(items[i], x, y);
                this._ring.add_child(btn);
                if (before.size > 0)
                    this._animateIn(btn, x, y, before.get(items[i].name), ox, oy);
            }
        });
        this._overlay.add_child(center);
    }

    // Glide an item from its old screen position, or pop in a new one.
    _animateIn(btn, x, y, from, ox, oy) {
        const mode = Clutter.AnimationMode.EASE_OUT_QUAD;
        if (from) {
            btn.set_position(from[0] - ox, from[1] - oy);
            btn.ease({x, y, duration: 220, mode});
        } else {
            btn.set_pivot_point(0.5, 0.5);
            btn.set_scale(0.3, 0.3);
            btn.opacity = 0;
            btn.ease({scale_x: 1, scale_y: 1, opacity: 255, duration: 260,
                mode: Clutter.AnimationMode.EASE_OUT_BACK});
        }
    }

    _makeItem(item, x, y) {
        const box = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.CENTER});
        box.add_child(new St.Icon({gicon: item.icon, icon_size: ICON_SIZE, x_align: Clutter.ActorAlign.CENTER}));
        const label = new St.Label({text: item.label, x_align: Clutter.ActorAlign.CENTER});
        label.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
        box.add_child(label);

        const btn = new St.Button({
            style_class: 'logo-orbit-item',
            child: box,
            width: ITEM_SIZE, height: ITEM_SIZE,
            x, y,
        });
        btn._itemName = item.name;
        btn._home = [x, y];
        btn.connect('clicked', () => this._open(item.file));
        btn.connect('notify::hover', () => this._onItemHover(btn, item));

        // Drag an item out of the circle onto the desktop.
        btn._delegate = {
            getDragActor: () => {
                this._dragIcon = new St.Icon({gicon: item.icon, icon_size: ICON_SIZE});
                return this._dragIcon;
            },
            getDragActorSource: () => btn,
        };
        const draggable = DND.makeDraggable(btn);
        draggable.connect('drag-begin', () => this._onItemDragBegin(item));
        draggable.connect('drag-end', () => this._onItemDragEnd());
        return btn;
    }

    _open(file) {
        try {
            Gio.AppInfo.launch_default_for_uri(file.get_uri(), global.create_app_launch_context(0, -1));
        } catch (e) {
            console.error('Logo Orbit: cannot open', e);
        }
        this._hide();
    }

    // --- Folder peek: rest on a folder to see what's inside ---

    _cancelPeekTimer() {
        if (this._peekId)
            GLib.source_remove(this._peekId);
        this._peekId = 0;
    }

    // Resting on a folder opens the panel; resting on another item closes it.
    _onItemHover(btn, item) {
        this._cancelPeekTimer();
        if (!btn.hover || this._dragging || this._extDrag || this._blackHole)
            return;
        if (this._peekItem) {
            if (this._peekItem.name === item.name)
                return;
            // Just passing over it (e.g. on the way to the panel) keeps the panel.
            this._peekId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PEEK_SWITCH_MS, () => {
                this._peekId = 0;
                if (btn.hover && this._visible && !this._dragging) {
                    this._closePeek();
                    this._onItemHover(btn, item);
                }
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        if (!item.isDir)
            return;
        this._peekId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PEEK_DELAY_MS, () => {
            this._peekId = 0;
            if (btn.hover && this._visible && !this._dragging)
                this._openPeek(btn, item);
            return GLib.SOURCE_REMOVE;
        });
    }

    _openPeek(btn, item) {
        this._closePeek(false);
        this._peekItem = item;
        // Open on the folder's side of the orbit (right when it's dead centre).
        const [bx] = btn.get_transformed_position();
        this._peekSide = bx + btn.width / 2 < this._geom.cx - 1 ? -1 : 1;

        const peek = new St.BoxLayout({vertical: true, reactive: true, style_class: 'logo-orbit-peek'});

        // Header: back (inside a subfolder), the folder itself (click to open
        // it) and how many items it holds.
        const back = new St.Button({
            style_class: 'logo-orbit-peek-back',
            child: new St.Icon({icon_name: 'go-previous-symbolic', icon_size: 16}),
            y_align: Clutter.ActorAlign.CENTER,
        });
        back.connect('clicked', () => this._peekBack());
        const head = new St.BoxLayout({x_expand: true});
        const icon = new St.Icon({icon_size: PEEK_ICON_SIZE, y_align: Clutter.ActorAlign.CENTER});
        head.add_child(icon);
        const titles = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const title = new St.Label({style_class: 'logo-orbit-peek-title'});
        title.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
        const count = new St.Label({style_class: 'logo-orbit-peek-count'});
        titles.add_child(title);
        titles.add_child(count);
        head.add_child(titles);
        const header = new St.Button({style_class: 'logo-orbit-peek-header', child: head, x_expand: true});
        header.connect('clicked', () => this._open(this._peekStack.at(-1).file));
        const top = new St.BoxLayout({x_expand: true});
        top.add_child(back);
        top.add_child(header);
        peek.add_child(top);
        peek.add_child(new St.Widget({style_class: 'logo-orbit-peek-sep', x_expand: true}));

        const list = new St.BoxLayout({vertical: true, x_expand: true});
        const scroll = new St.ScrollView({
            child: list,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        peek.add_child(scroll);

        this._peek = peek;
        this._peekUi = {back, icon, title, count, list, scroll};
        this._peekStack = [{file: item.file, label: item.label, icon: item.icon}];
        Main.layoutManager.uiGroup.insert_child_above(peek, this._overlay);
        this._showPeekFolder();

        peek.opacity = 0;
        peek.translation_x = -this._peekSide * 16;
        peek.ease({opacity: 255, translation_x: 0, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    // Browse into a subfolder inside the panel.
    _peekEnter(folder) {
        this._peekStack.push(folder);
        this._showPeekFolder();
    }

    _peekBack() {
        if (this._peekStack.length < 2)
            return;
        this._peekStack.pop();
        this._showPeekFolder();
    }

    // Show the folder on top of the browse stack, reading it in the background.
    _showPeekFolder() {
        const folder = this._peekStack.at(-1);
        const {back, icon, title, count, list, scroll} = this._peekUi;
        this._peekCancel?.cancel();
        back.visible = this._peekStack.length > 1;
        icon.gicon = folder.icon;
        title.text = folder.label;
        count.text = 'Loading…';
        list.destroy_all_children();
        scroll.vadjustment.value = 0;
        this._placePeek();
        this._readFolder(folder.file, (infos, error) => this._fillPeek(folder, infos, error));
    }

    // Read a folder's entries without blocking the shell; `done(infos, error)`
    // is not called if the panel is closed first.
    _readFolder(dir, done) {
        const cancel = new Gio.Cancellable();
        this._peekCancel = cancel;
        const fail = e => {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                done(null, e);
        };
        dir.enumerate_children_async(PEEK_ATTRS, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancel, (d, res) => {
            let en;
            try {
                en = d.enumerate_children_finish(res);
            } catch (e) {
                fail(e);
                return;
            }
            const infos = [];
            const next = () => en.next_files_async(100, GLib.PRIORITY_DEFAULT, cancel, (e, r) => {
                let batch;
                try {
                    batch = e.next_files_finish(r);
                } catch (err) {
                    fail(err);
                    return;
                }
                infos.push(...batch);
                if (batch.length > 0 && infos.length < PEEK_MAX_ITEMS) {
                    next();
                    return;
                }
                en.close_async(GLib.PRIORITY_DEFAULT, null, null);
                if (!cancel.is_cancelled())
                    done(infos, null);
            });
            next();
        });
    }

    _fillPeek(folder, infos, error) {
        if (!this._peek || this._peekStack.at(-1) !== folder)
            return;
        const {list, count} = this._peekUi;
        if (error) {
            count.text = '';
            list.add_child(new St.Label({text: 'Can\'t open this folder', style_class: 'logo-orbit-peek-note'}));
            this._placePeek();
            return;
        }

        const truncated = infos.length >= PEEK_MAX_ITEMS;
        const entries = infos
            .filter(i => !i.get_is_hidden() && !i.get_is_backup() && !i.get_name().startsWith('.'))
            .slice(0, PEEK_MAX_ITEMS)
            .map(i => ({
                name: i.get_name(),
                label: i.get_display_name(),
                icon: i.get_icon(),
                isDir: i.get_file_type() === Gio.FileType.DIRECTORY,
            }));
        // Folders first, then files, alphabetically.
        entries.sort((a, b) => (b.isDir - a.isDir) || a.label.localeCompare(b.label));

        count.text = entries.length === 1 ? '1 item' : `${entries.length}${truncated ? '+' : ''} items`;
        if (entries.length === 0)
            list.add_child(new St.Label({text: 'This folder is empty', style_class: 'logo-orbit-peek-note'}));

        for (const entry of entries) {
            const row = new St.BoxLayout({x_expand: true});
            row.add_child(new St.Icon({gicon: entry.icon, icon_size: PEEK_ICON_SIZE, y_align: Clutter.ActorAlign.CENTER}));
            const label = new St.Label({text: entry.label, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            label.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
            row.add_child(label);
            const btn = new St.Button({style_class: 'logo-orbit-peek-row', child: row, x_expand: true});
            const file = folder.file.get_child(entry.name);
            // Folders open inside the panel; files open in their app.
            btn.connect('clicked', () => {
                if (entry.isDir)
                    this._peekEnter({file, label: entry.label, icon: entry.icon});
                else
                    this._open(file);
            });
            list.add_child(btn);
        }
        if (truncated) {
            list.add_child(new St.Label({
                text: `Showing the first ${PEEK_MAX_ITEMS}. Click the folder name to see everything.`,
                style_class: 'logo-orbit-peek-note',
            }));
        }
        this._placePeek();
    }

    // Beside the orbit on the folder's side (the other side if there's no
    // room), centred on the logo.
    _placePeek() {
        const peek = this._peek, g = this._geom;
        const m = Main.layoutManager.primaryMonitor;
        if (!peek || !g || !m)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const w = PEEK_WIDTH * scale, gap = PEEK_GAP * scale, margin = 16 * scale;
        const maxH = Math.min(PEEK_MAX_HEIGHT * scale, m.height - 2 * margin);
        // Drop the height fixed by the previous placement, or the preferred
        // height below would just report it back and the panel never grows.
        peek.set_height(-1);
        const h = Math.min(peek.get_preferred_height(w)[1], maxH);

        const right = g.cx + g.outer + gap, left = g.cx - g.outer - gap - w;
        const fitsRight = right + w <= m.x + m.width - margin, fitsLeft = left >= m.x + margin;
        let x = this._peekSide < 0 ? left : right;
        if (this._peekSide < 0 && !fitsLeft && fitsRight)
            x = right;
        else if (this._peekSide > 0 && !fitsRight && fitsLeft)
            x = left;
        x = Math.min(Math.max(m.x + margin, x), m.x + m.width - margin - w);
        const y = Math.min(Math.max(g.cy - h / 2, m.y + margin), m.y + m.height - margin - h);
        peek.set_size(w, h);
        peek.set_position(Math.round(x), Math.round(y));
    }

    _closePeek(animate = true) {
        this._peekCancel?.cancel();
        this._peekCancel = null;
        this._peekItem = null;
        this._peekStack = [];
        this._peekUi = null;
        const peek = this._peek;
        this._peek = null;
        if (!peek)
            return;
        peek.reactive = false;
        peek.remove_all_transitions();
        if (!animate) {
            peek.destroy();
            return;
        }
        peek.ease({
            opacity: 0,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => peek.destroy(),
        });
    }

    // On the panel, or crossing the gap between it and the orbit.
    _insidePeek(x, y) {
        const peek = this._peek, g = this._geom;
        if (!peek || !g)
            return false;
        const left = Math.min(peek.x, g.cx), right = Math.max(peek.x + peek.width, g.cx);
        return x >= left && x < right && y >= peek.y && y < peek.y + peek.height;
    }

    // --- Black hole: hold the orbit open for a while ---

    _cancelBlackHoleTimer() {
        if (this._holeId)
            GLib.source_remove(this._holeId);
        this._holeId = 0;
    }

    _armBlackHole(ms = this._settings.get_int('black-hole-delay') * 1000) {
        this._cancelBlackHoleTimer();
        if (!this._settings.get_boolean('black-hole-enabled'))
            return;
        this._holeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._holeId = 0;
            if (!this._visible || this._blackHole)
                return GLib.SOURCE_REMOVE;
            // Don't pull the rug out from under a drag; try again shortly.
            if (this._dragging || this._extDrag)
                this._armBlackHole(1000);
            else
                this._startBlackHole();
            return GLib.SOURCE_REMOVE;
        });
    }

    // The disc goes dark, the logo becomes the event horizon and every item
    // spirals into it, nearest rings first.
    _startBlackHole() {
        const g = this._geom;
        if (!this._ring || !this._center || !g)
            return;
        this._blackHole = true;
        this._cancelPeekTimer();
        this._closePeek();

        const {r, outer} = g;
        const size = this._disc.width;
        const voidDisc = new St.Widget({style_class: 'logo-orbit-void', width: size, height: size, opacity: 0});
        voidDisc.set_style(`border-radius: ${size / 2}px;`);
        this._ring.insert_child_above(voidDisc, this._disc);
        voidDisc.ease({opacity: 255, duration: 1500, mode: Clutter.AnimationMode.EASE_IN_QUAD});

        const d = Math.round(r * 2 * HOLE_SCALE);
        const hole = new St.Widget({
            style_class: 'logo-orbit-hole',
            width: d, height: d,
            x: Math.round(outer - d / 2), y: Math.round(outer - d / 2),
            opacity: 0,
        });
        hole.set_style(`border-radius: ${d / 2}px;`);
        hole.set_pivot_point(0.5, 0.5);
        hole.set_scale(0.2, 0.2);
        this._overlay.insert_child_below(hole, this._center);
        hole.ease({
            scale_x: 1, scale_y: 1, opacity: 255,
            duration: 1200,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => hole.ease({
                scale_x: 1.08, scale_y: 1.08,
                duration: 900,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                repeatCount: -1,
                autoReverse: true,
            }),
        });

        // The logo shrinks into the hole and spins until the hole closes.
        const center = this._center;
        center.set_pivot_point(0.5, 0.5);
        center.ease({scale_x: 0.55, scale_y: 0.55, opacity: 170, duration: 1500,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD});
        const icon = center.child;
        icon.set_pivot_point(0.5, 0.5);
        icon.ease({rotation_angle_z: 360, duration: 1600, mode: Clutter.AnimationMode.LINEAR, repeatCount: -1});

        // The whole fall (spiral, stagger and jitter) scales with the chosen length.
        const fallMs = this._settings.get_double('black-hole-duration') * 1000;
        const speed = fallMs / FALL_MS;
        const slot = ITEM_SIZE * 1.05;
        const falls = this._ring.get_children().filter(c => c._itemName).map(btn => {
            btn.remove_all_transitions();
            btn.reactive = false;
            btn.set_pivot_point(0.5, 0.5);
            const dx = btn.x + ITEM_SIZE / 2 - outer, dy = btn.y + ITEM_SIZE / 2 - outer;
            const r0 = Math.hypot(dx, dy);
            return {
                btn, r0,
                a0: Math.atan2(dy, dx),
                delay: (Math.max(0, (r0 - r) / slot) * FALL_STAGGER_MS + Math.random() * 500) * speed,
            };
        });
        const close = () => this._closeBlackHole(hole, center);
        if (falls.length === 0) {
            const timeline = new Clutter.Timeline({actor: this._ring, duration: 1500});
            timeline.connect('completed', () => {
                if (this._holeTimeline === timeline) {
                    this._holeTimeline = null;
                    close();
                }
            });
            this._holeTimeline = timeline;
            timeline.start();
            return;
        }

        // Accelerating inward spiral: tighter, faster and smaller as it falls.
        const frame = ms => {
            for (const f of falls) {
                const t = Math.min(Math.max((ms - f.delay) / fallMs, 0), 1);
                const k = t * t;
                const rad = f.r0 * (1 - k), a = f.a0 + 3 * Math.PI * k;
                f.btn.set_position(Math.round(outer + rad * Math.cos(a) - ITEM_SIZE / 2),
                    Math.round(outer + rad * Math.sin(a) - ITEM_SIZE / 2));
                f.btn.set_scale(1 - 0.9 * k, 1 - 0.9 * k);
                f.btn.rotation_angle_z = 540 * k;
                f.btn.opacity = Math.round(255 * (1 - k * k));
            }
        };
        const total = Math.round(Math.max(...falls.map(f => f.delay)) + fallMs);
        const timeline = new Clutter.Timeline({actor: this._ring, duration: total});
        timeline.connect('new-frame', (tl, ms) => frame(ms));
        timeline.connect('completed', () => {
            frame(total);
            falls.forEach(f => f.btn.hide());
            if (this._holeTimeline === timeline) {
                this._holeTimeline = null;
                close();
            }
        });
        this._holeTimeline = timeline;
        timeline.start();
    }

    // Everything is swallowed: the dark disc and the hole collapse into the
    // logo, which stops spinning and settles back, then the orbit closes.
    _closeBlackHole(hole, center) {
        if (!this._blackHole || !this._visible)
            return;
        const ring = this._ring;
        const mode = Clutter.AnimationMode.EASE_IN_BACK;
        const k = this._geom.r / this._geom.outer;
        ring.ease({scale_x: k, scale_y: k, opacity: 0, duration: HOLE_CLOSE_MS, mode});
        hole.remove_all_transitions();
        hole.ease({scale_x: 0, scale_y: 0, opacity: 0, duration: HOLE_CLOSE_MS, mode});

        // Finish the current turn and slow to a stop.
        const icon = center.child;
        const angle = icon.rotation_angle_z;
        icon.remove_all_transitions();
        icon.rotation_angle_z = angle;
        icon.ease({rotation_angle_z: 720, duration: HOLE_CLOSE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        center.ease({
            scale_x: 1, scale_y: 1, opacity: 255,
            duration: HOLE_CLOSE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onComplete: () => {
                if (!this._blackHole || !this._visible || this._center !== center)
                    return;
                // The centre logo now matches the wallpaper logo exactly, so drop the orbit.
                this._visible = false;
                this._cancelPeekTimer();
                this._cancelBlackHoleTimer();
                this._holeClosed = true;
                this._overlayGone();
                this._endBlackHole();
            },
        });
    }

    // Bring everything back out (the orbit is rebuilt from the item list).
    _endBlackHole() {
        this._holeTimeline?.stop();
        this._holeTimeline = null;
        this._blackHole = false;
        this._relayout();
    }

    // --- Dragging items out of the circle ---

    _onItemDragBegin(item) {
        this._dragging = true;
        this._cancelPeekTimer();
        this._closePeek();
        this._dragMonitor = {
            dragDrop: event => {
                if (event.dropActor !== this._dragIcon)
                    return DND.DragDropResult.CONTINUE;
                const [x, y] = event.clutterEvent.get_coords();
                // Dropped on the empty desktop: hand the item over to the desktop
                // icons. Anywhere else (inside the orbit, over a window) it snaps back.
                if (!this._insideOrbit(x, y) && this._desktopUnderPointer(x, y, true)) {
                    event.dropActor.hide();
                    this._sendOut(item, x, y);
                }
                return DND.DragDropResult.CONTINUE;
            },
        };
        DND.addDragMonitor(this._dragMonitor);
    }

    _onItemDragEnd() {
        if (this._dragMonitor)
            DND.removeDragMonitor(this._dragMonitor);
        this._dragMonitor = null;
        this._dragIcon = null;
        this._dragging = false;
        this._reload();
        const [x, y] = global.get_pointer();
        if (!this._insideOrbit(x, y))
            this._hide();
    }

    _sendOut(item, x, y) {
        // Ask the desktop icons to place it where it was dropped.
        const info = new Gio.FileInfo();
        info.set_attribute_string('metadata::nautilus-icon-position', '');
        info.set_attribute_string('metadata::nautilus-drop-position', `${Math.round(x)},${Math.round(y)}`);
        try {
            item.file.set_attributes_from_info(info, Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            console.error('Logo Orbit: cannot set drop position', e);
        }
        // Rebuild once the drag has finished, not while its source is still in use.
        this._state.out.add(item.name);
    }

    // --- Dragging files from apps into the circle ---

    // Read the dragged file list while the drag is still going (the source
    // app can't be asked once it has ended).
    _fetchDragUris() {
        this._dragFetching = true;
        const selection = global.display.get_selection();
        const type = Meta.SelectionType.SELECTION_DND;
        if (!selection.get_mimetypes(type).includes('text/uri-list'))
            return;
        const stream = Gio.MemoryOutputStream.new_resizable();
        selection.transfer_async(type, 'text/uri-list', -1, stream, null, (sel, res) => {
            try {
                sel.transfer_finish(res);
                stream.close(null);
                const text = new TextDecoder().decode(stream.steal_as_bytes().toArray());
                const uris = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
                if (this._extDrag && uris.length > 0) {
                    this._dragUris = uris;
                    this._disc?.add_style_class_name('logo-orbit-drop');
                }
            } catch (e) {
                console.error('Logo Orbit: cannot read dragged files', e);
            }
        });
    }

    _onExtDragEnd() {
        const uris = this._dragUris;
        this._extDrag = false;
        this._dragUris = null;
        this._dragFetching = false;
        this._disc?.remove_style_class_name('logo-orbit-drop');
        if (!uris || !this._visible)
            return;
        const [x, y] = global.get_pointer();
        if (this._insideOrbit(x, y))
            this._addToCircle(uris);
    }

    // Desktop items just move back into the circle; files from elsewhere are
    // moved onto the Desktop (as dropping them on the desktop would), which
    // puts them in the circle.
    _addToCircle(uris) {
        let pending = 0;
        const done = () => {
            if (--pending <= 0)
                this._reload();
        };
        const moves = [];
        for (const uri of uris) {
            const src = Gio.File.new_for_uri(uri);
            if (src.get_parent()?.equal(this._desktop)) {
                this._state.out.delete(src.get_basename());
                continue;
            }
            if (!src.is_native())
                continue;
            const taken = moves.map(m => m.dest.get_basename());
            moves.push({src, dest: this._freeName(src.get_basename(), taken)});
        }
        // List the new names in `.hidden` before the files arrive, so the
        // desktop icons never show them (it caches `.hidden` for seconds).
        if (moves.length > 0) {
            const circle = [...this._circleItems().map(i => i.name), ...moves.map(m => m.dest.get_basename())];
            this._writeHidden([...this._userHidden], circle);
        }
        for (const {src, dest} of moves) {
            pending++;
            src.move_async(dest, Gio.FileCopyFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, null, null, (s, res) => {
                try {
                    s.move_finish(res);
                } catch (e) {
                    Main.notifyError('Logo Orbit', `Couldn't move "${s.get_basename()}" to the Desktop: ${e.message}`);
                }
                done();
            });
        }
        if (pending === 0)
            this._reload();
    }

    // A Desktop child named like `name`, adding " (2)", " (3)", ... if it's taken.
    // `taken` lists names already claimed by other files in the same drop.
    _freeName(name, taken = []) {
        const dot = name.lastIndexOf('.');
        const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
        let file = this._desktop.get_child(name);
        for (let n = 2; file.query_exists(null) || taken.includes(file.get_basename()); n++)
            file = this._desktop.get_child(`${base} (${n})${ext}`);
        return file;
    }

    // --- Hover handling ---

    // True when nothing but the wallpaper / desktop icons is under the pointer.
    _desktopUnderPointer(x, y, duringDrag = false) {
        if (Main.overview.visible || (!duringDrag && Main.modalCount > 0))
            return false;
        const ws = global.workspace_manager.get_active_workspace();
        const actors = global.get_window_actors();
        for (let i = actors.length - 1; i >= 0; i--) {
            const win = actors[i].meta_window;
            if (!win || win.minimized || !actors[i].visible)
                continue;
            if (win.get_window_type() === Meta.WindowType.DESKTOP)
                continue;
            const appId = win.get_gtk_application_id() ?? '';
            const wmClass = (win.get_wm_class() ?? '').toLowerCase();
            if (appId === 'com.rastersoft.ding' || wmClass.includes('ding'))
                continue;
            if (!win.is_on_all_workspaces() && win.get_workspace() !== ws)
                continue;
            const f = win.get_frame_rect();
            if (x >= f.x && x < f.x + f.width && y >= f.y && y < f.y + f.height)
                return false;
        }
        return true;
    }

    _insideOrbit(x, y) {
        const g = this._geom;
        return !!g && Math.hypot(x - g.cx, y - g.cy) <= g.outer;
    }

    _overLogo(x, y) {
        const g = this._geom;
        return g && Math.hypot(x - g.cx, y - g.cy) <= g.r && this._desktopUnderPointer(x, y);
    }

    _onPointer(x, y) {
        if (this._spinning || this._dragging)
            return;
        if (this._visible) {
            if (!(this._insideOrbit(x, y) || this._insidePeek(x, y)) || Main.overview.visible)
                this._hide();
            else if (this._extDrag && !this._dragFetching)
                this._fetchDragUris();
            return;
        }

        // After the black hole closed the orbit, wait for the pointer to leave the logo.
        if (this._holeClosed) {
            if (this._overLogo(x, y))
                return;
            this._holeClosed = false;
        }

        if (this._overLogo(x, y)) {
            if (!this._dwellId) {
                this._dwellId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOVER_DELAY_MS, () => {
                    this._dwellId = 0;
                    const [px, py] = global.get_pointer();
                    if (!this._overLogo(px, py))
                        return GLib.SOURCE_REMOVE;
                    // Holding a file: open straight away, no spin.
                    this._show(!this._extDrag);
                    return GLib.SOURCE_REMOVE;
                });
            }
        } else if (this._dwellId) {
            GLib.source_remove(this._dwellId);
            this._dwellId = 0;
        }
    }

    _show(animate = false) {
        this._finishOrbitAnim();
        if (this._blackHole)
            this._endBlackHole();
        this._visible = true;
        this._armBlackHole();
        const o = this._overlay;
        o.remove_all_transitions();
        o.show();
        // The orbit's centre logo takes over from the wallpaper one.
        this._logo.opacity = 0;
        if (animate) {
            o.opacity = 255;
            this._spinning = true;
            this._animateOrbit(true, () => {
                this._spinning = false;
            });
            return;
        }
        o.ease({opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._ring.remove_all_transitions();
        this._ring.opacity = 255;
        this._ring.set_scale(0.4, 0.4);
        this._ring.ease({
            scale_x: 1, scale_y: 1,
            duration: 260,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
    }

    _hide() {
        if (!this._visible)
            return;
        this._finishOrbitAnim();
        this._visible = false;
        this._cancelPeekTimer();
        this._closePeek();
        this._cancelBlackHoleTimer();
        this._disc?.remove_style_class_name('logo-orbit-drop');
        // No hovering reopens it until it has closed.
        this._spinning = true;
        if (!this._blackHole) {
            this._animateOrbit(false, () => {
                this._overlayGone();
                this._spinning = false;
            });
            return;
        }

        // Mid black hole the items are scattered; just shrink it all into the logo.
        const k = this._geom ? this._geom.r / this._geom.outer : 0.4;
        this._ring?.remove_all_transitions();
        this._ring?.ease({
            scale_x: k, scale_y: k, opacity: 0,
            duration: CLOSE_HOLE_MS,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
        });
        const o = this._overlay;
        o.remove_all_transitions();
        o.ease({
            opacity: 0,
            duration: CLOSE_HOLE_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => {
                this._spinning = false;
                if (this._visible)
                    return;
                this._overlayGone();
                if (this._blackHole)
                    this._endBlackHole();
            },
        });
    }

    // The orbit is closed: hide it and hand back to the wallpaper logo, with
    // everything back in place for the next opening.
    _overlayGone() {
        const o = this._overlay;
        o.remove_all_transitions();
        o.opacity = 0;
        o.hide();
        this._logo.opacity = 255;
        this._ring?.set_scale(1, 1);
        if (this._ring)
            this._ring.opacity = 255;
        this._disc?.set_scale(1, 1);
        if (this._disc)
            this._disc.opacity = 255;
        if (this._center)
            this._center.child.rotation_angle_z = 0;
        for (const btn of this._ring?.get_children() ?? []) {
            if (!btn._home)
                continue;
            btn.set_position(...btn._home);
            btn.set_scale(1, 1);
            btn.opacity = 255;
            btn.rotation_angle_z = 0;
            btn.reactive = true;
        }
    }

    // Open or close the orbit: the centre logo spins one turn while every item
    // swirls out of it to its place (or back into it), one after another, and
    // the disc grows out of the logo (or shrinks back into it) with them.
    _animateOrbit(opening, done) {
        const g = this._geom, ring = this._ring, disc = this._disc, center = this._center;
        if (!g || !ring || !disc || !center) {
            done();
            return;
        }
        const {outer} = g;
        const k = g.r / outer;
        const itemMs = opening ? OPEN_ITEM_MS : CLOSE_ITEM_MS;
        const spread = opening ? OPEN_STAGGER_MS : CLOSE_STAGGER_MS;

        ring.remove_all_transitions();
        ring.set_scale(1, 1);
        ring.opacity = 255;
        disc.remove_all_transitions();
        disc.set_pivot_point(0.5, 0.5);
        const icon = center.child;
        icon.remove_all_transitions();
        icon.set_pivot_point(0.5, 0.5);

        // Inner rings come out first and go back in last.
        const btns = ring.get_children().filter(c => c._home);
        const items = btns.map((btn, i) => {
            btn.remove_all_transitions();
            btn.reactive = false;
            btn.set_pivot_point(0.5, 0.5);
            btn.rotation_angle_z = 0;
            const dx = btn._home[0] + ITEM_SIZE / 2 - outer, dy = btn._home[1] + ITEM_SIZE / 2 - outer;
            const order = btns.length > 1 ? i / (btns.length - 1) : 0;
            return {
                btn,
                r0: Math.hypot(dx, dy),
                a0: Math.atan2(dy, dx),
                delay: (opening ? order : 1 - order) * spread,
            };
        });

        const total = spread + itemMs;
        const frame = ms => {
            const p = Math.min(ms / total, 1);
            const d = opening ? easeOutCubic(p) : 1 - easeInCubic(p);
            disc.set_scale(k + (1 - k) * d, k + (1 - k) * d);
            disc.opacity = Math.round(255 * d);
            icon.rotation_angle_z = (opening ? 360 : -360) * easeInOutCubic(p);
            for (const it of items) {
                const t = Math.min(Math.max((ms - it.delay) / itemMs, 0), 1);
                const e = opening ? easeOutCubic(t) : 1 - easeInCubic(t);
                const rad = it.r0 * e, a = it.a0 - (1 - e) * SWIRL;
                it.btn.set_position(Math.round(outer + rad * Math.cos(a) - ITEM_SIZE / 2),
                    Math.round(outer + rad * Math.sin(a) - ITEM_SIZE / 2));
                const s = 0.25 + 0.75 * (opening ? easeOutBack(t) : e);
                it.btn.set_scale(s, s);
                it.btn.opacity = Math.round(255 * Math.min(1, e / 0.35));
            }
        };
        const finish = () => {
            frame(total);
            icon.rotation_angle_z = 0;
            if (opening)
                items.forEach(it => (it.btn.reactive = true));
            done();
        };

        const timeline = new Clutter.Timeline({actor: this._overlay, duration: total});
        timeline.connect('new-frame', (tl, ms) => frame(ms));
        timeline.connect('completed', () => {
            if (this._orbitAnim?.timeline === timeline)
                this._finishOrbitAnim();
        });
        this._orbitAnim = {timeline, finish};
        frame(0);
        timeline.start();
    }

    // Jump a running open/close animation to its end.
    _finishOrbitAnim() {
        const anim = this._orbitAnim;
        if (!anim)
            return;
        this._orbitAnim = null;
        anim.timeline.stop();
        anim.finish();
    }
}
