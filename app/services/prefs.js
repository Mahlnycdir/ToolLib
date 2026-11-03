// Settings that stay on this device. Every key gets the prefix "toollib." so Kobra's keys stay apart.
const PREFIX = 'toollib.';

export function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function savePref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // private mode or storage full: the setting just won't survive a reload
  }
}

export function removePref(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // nothing stored
  }
}
