import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class LogoOrbitPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({icon_name: 'preferences-system-symbolic'});
        const group = new Adw.PreferencesGroup({
            title: 'Black hole',
            description: 'Keep the orbit open and it collapses into a black hole.',
        });
        page.add(group);

        const enabled = new Adw.SwitchRow({title: 'Enable black hole'});
        settings.bind('black-hole-enabled', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(enabled);

        const delay = new Adw.SpinRow({
            title: 'Start after',
            subtitle: 'Seconds the orbit stays open before it collapses',
            adjustment: new Gtk.Adjustment({lower: 5, upper: 3600, step_increment: 5, page_increment: 60}),
        });
        settings.bind('black-hole-delay', delay, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(delay);

        const duration = new Adw.SpinRow({
            title: 'Animation length',
            subtitle: 'Seconds each item takes to spiral into the hole',
            digits: 1,
            adjustment: new Gtk.Adjustment({lower: 0.3, upper: 20, step_increment: 0.1, page_increment: 1}),
        });
        settings.bind('black-hole-duration', duration, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(duration);

        for (const row of [delay, duration])
            enabled.bind_property('active', row, 'sensitive', GObject.BindingFlags.SYNC_CREATE);

        window.add(page);
    }
}
