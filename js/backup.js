// Backup age and the automatic backup download. The linked file (filelink.js) is the better
// place for the data; this is the fallback when none is linked.
import * as store from './store.js';
import { t } from './i18n.js';
import { toast } from './ui.js';
import { downloadBlob, todayISO } from './util.js';
import * as filelink from './filelink.js';

export const BACKUP_WARN_DAYS = 7;
export function backupAge() {
  const last = store.settings().lastBackup;
  if (!last) return null;
  return (Date.now() - new Date(last).getTime()) / 86400000;
}

// Automatic backup file when the last one is older than the chosen interval. Skipped while a
// file is linked (that is the backup) and for a workspace that only holds the demo.
export function maybeAutoBackup() {
  const S = store.settings();
  const every = { daily: 1, weekly: 7, monthly: 30 }[S.autoBackup || 'weekly'];
  if (!every || filelink.getStatus().state === 'linked') return;
  if (!store.listPortfolios().some(p => p.positions.length && !p.demo)) return;
  const age = backupAge();
  if (age != null && age < every) return;
  downloadBackup();
  toast(t('backup.autoDone'), { ms: 6000 });
}
export function downloadBackup() {
  downloadBlob(store.exportWorkspace(), 'application/json', `nexus-portfolio-lab-backup-${todayISO()}.json`);
  store.setSetting('lastBackup', new Date().toISOString());
}
