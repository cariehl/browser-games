// Every data file, loaded from the editor server, edited in memory and saved
// back on request. JSON files are kept parsed (Store.data(path)); maps as
// text (Store.text(path)), parsed by the map editor.

const files = {};
const listeners = [];

export const Store = {
  async load() {
    const response = await fetch('/api/files');
    const all = await response.json();
    for (const key of Object.keys(files)) delete files[key];
    for (const [path, text] of Object.entries(all)) {
      const entry = { text, dirty: false };
      if (path.endsWith('.json')) {
        try {
          entry.data = JSON.parse(text);
        } catch (error) {
          entry.error = error.message;
          entry.data = {};
        }
      }
      files[path] = entry;
    }
    Store.changed();
  },

  paths() {
    return Object.keys(files).sort();
  },

  has(path) {
    return path in files;
  },

  /** The live parsed data of a .json file. Edit it in place, then call touch(). */
  data(path) {
    return files[path] ? files[path].data : null;
  },

  text(path) {
    return files[path] ? files[path].text : '';
  },

  setText(path, text) {
    if (!files[path]) files[path] = { text: '', dirty: false };
    if (files[path].text === text) return;
    files[path].text = text;
    Store.touch(path);
  },

  touch(path) {
    files[path].dirty = true;
    Store.changed();
  },

  isDirty(path) {
    return !!(files[path] && files[path].dirty);
  },

  dirtyPaths() {
    return Object.keys(files).filter((p) => files[p].dirty);
  },

  /** Saves every changed file. Returns the paths saved; throws (after saving what it could) on the first failure. */
  async saveAll() {
    const saved = [];
    for (const path of Store.dirtyPaths()) {
      const entry = files[path];
      const body = path.endsWith('.json') ? JSON.stringify(entry.data) : entry.text;
      const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`, { method: 'PUT', body });
      const result = await response.json();
      if (!response.ok) throw new Error(`${path}: ${result.error}`);
      entry.text = result.text;
      entry.dirty = false;
      saved.push(path);
    }
    Store.changed();
    return saved;
  },

  onChange(fn) {
    listeners.push(fn);
  },

  changed() {
    for (const fn of listeners) fn();
  },
};
