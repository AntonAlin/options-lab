// Holdings over time for the active portfolio. A portfolio fed by a connected file has one
// snapshot per date in the file; any other portfolio has the snapshots the user saved (kept in
// the portfolio, capped so localStorage does not fill up).
import * as store from './store.js';
import { snapshotsFor } from './sourcefile.js';
import { todayISO } from './util.js';

export const MAX_SAVED = 90;

export function snapshots(p = store.active()) {
  if (!p) return [];
  const fromFile = snapshotsFor(p);
  const saved = Array.isArray(p.snapshots) ? p.snapshots : [];
  if (!fromFile) return [...saved].sort((a, b) => a.date.localeCompare(b.date));
  // The file wins on a date both have.
  const dates = new Set(fromFile.map(s => s.date));
  return [...fromFile, ...saved.filter(s => !dates.has(s.date))].sort((a, b) => a.date.localeCompare(b.date));
}
export const fromFile = (p = store.active()) => !!snapshotsFor(p);

// Save today's holdings (or the valuation date's) as a snapshot; the same date is overwritten.
export function saveSnapshot(date = store.active()?.valDate || todayISO()) {
  store.update(p => {
    const list = (Array.isArray(p.snapshots) ? p.snapshots : []).filter(s => s.date !== date);
    list.push({ date, positions: JSON.parse(JSON.stringify(p.positions)), savedAt: new Date().toISOString() });
    list.sort((a, b) => a.date.localeCompare(b.date));
    p.snapshots = list.slice(-MAX_SAVED);
  }, 'snapshot');
  return date;
}
export function deleteSnapshot(date) {
  store.update(p => { p.snapshots = (p.snapshots || []).filter(s => s.date !== date); }, 'snapshot');
}
