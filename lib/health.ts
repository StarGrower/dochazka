// Kontrola stavu záznamu (etapa 4.2) - proužek v kalendáři, obrazovka
// Nastavení -> Stav záznamu a u vážných problémů místní upozornění
// (nejvýš 1× denně na každý problém).

import * as Battery from 'expo-battery';
import * as Location from 'expo-location';

import DochazkaNative from '../modules/dochazka-native/src/DochazkaNative';
import { getLastBackup, isBackupConfigured } from './backup';
import { countLocationEventsBetween, getInternalValue, getLastLocationEventAt, getSettings, setInternalValue } from './db';
import { localDayBounds } from './dayTimeline';
import { todayIso } from './format';

export type HealthLevel = 'ok' | 'warn' | 'error';
// Kam vede klepnutí: Nastavení iPhonu, nebo obrazovka appky.
export type HealthAction = 'ios-settings' | '/settings/zaloha' | '/settings/poloha' | '/settings/pripominky' | null;

export interface HealthCheck {
  id: string;
  level: HealthLevel;
  title: string;
  detail: string;
  action: HealthAction;
}

export interface HealthReport {
  checks: HealthCheck[];
  lastEventAt: string | null;
  worst: HealthCheck | null; // nejvážnější problém (proužek v kalendáři)
}

const DAY_MS = 24 * 60 * 60 * 1000;

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export async function runHealthChecks(): Promise<HealthReport> {
  const settings = await getSettings();
  const checks: HealthCheck[] = [];
  const add = (c: HealthCheck) => checks.push(c);

  // Poloha
  if (!settings.locationTrackingEnabled) {
    add({ id: 'tracking', level: 'warn', title: 'Záznam polohy je vypnutý', detail: 'Pobyty a přejezdy se nezaznamenávají.', action: '/settings/poloha' });
  } else {
    const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
    const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (bg?.status !== 'granted') {
      add({ id: 'always', level: 'error', title: 'Poloha není „Vždy"', detail: 'Na pozadí se nic nezaznamená. Nastavení → Docházka → Poloha → Vždy.', action: 'ios-settings' });
    } else {
      add({ id: 'always', level: 'ok', title: 'Poloha „Vždy"', detail: 'Oprávnění v pořádku.', action: null });
    }
    if (fg?.ios?.accuracy === 'reduced') {
      add({ id: 'precise', level: 'error', title: 'Přesná poloha je vypnutá', detail: 'Pobyty nepůjdou přiřadit k místům. Nastavení → Docházka → Poloha → Přesná poloha.', action: 'ios-settings' });
    }
  }

  // Úsporný režim a aktualizace na pozadí
  if (await Battery.isLowPowerModeEnabledAsync().catch(() => false)) {
    add({ id: 'lowpower', level: 'warn', title: 'Režim nízké spotřeby', detail: 'iOS může omezit záznam na pozadí.', action: 'ios-settings' });
  }
  const refresh = await DochazkaNative.backgroundRefreshStatus().catch(() => 'unknown' as const);
  if (refresh === 'denied' || refresh === 'restricted') {
    add({ id: 'refresh', level: 'warn', title: 'Aktualizace na pozadí je vypnutá', detail: 'Nastavení → Obecné → Aktualizace na pozadí → Docházka.', action: 'ios-settings' });
  }

  // Podpis appky (bezplatné Apple ID = 7 dní)
  let expiry = '';
  try {
    expiry = DochazkaNative.provisioningExpiry();
  } catch {
    expiry = '';
  }
  if (expiry) {
    const left = Date.parse(expiry) - Date.now();
    add(
      left < 2 * DAY_MS
        ? { id: 'signature', level: 'error', title: 'Podpis appky brzy vyprší', detail: `Platí do ${fmtDate(expiry)} - přeinstaluj přes Sideloadly (appku nemaž).`, action: null }
        : { id: 'signature', level: 'ok', title: 'Podpis appky', detail: `Platí do ${fmtDate(expiry)}.`, action: null }
    );
  }

  // Záloha
  let folder = { configured: false, accessible: false, name: '', error: '' };
  try {
    folder = DochazkaNative.getBackupFolder();
  } catch {
    // nativní modul chybí
  }
  if (!isBackupConfigured()) {
    add({ id: 'backup', level: 'warn', title: 'Záloha není nastavená', detail: 'Při ztrátě telefonu přijdeš o data.', action: '/settings/zaloha' });
  } else if (!folder.accessible) {
    add({ id: 'backup', level: 'error', title: 'Složka pro zálohy není dostupná', detail: folder.error || 'Vyber složku znovu.', action: '/settings/zaloha' });
  } else {
    const last = await getLastBackup();
    if (!last || Date.now() - Date.parse(last.at) > 7 * DAY_MS) {
      add({ id: 'backup', level: 'error', title: 'Záloha neproběhla přes 7 dní', detail: last ? `Poslední ${fmtDate(last.at)}.` : 'Zatím žádná záloha.', action: '/settings/zaloha' });
    } else {
      add({ id: 'backup', level: 'ok', title: 'Záloha', detail: `Poslední ${fmtDate(last.at)} · ${folder.name}`, action: '/settings/zaloha' });
    }
  }

  // Žádná událost polohy v časovém okně dnešního pracovního dne
  const lastEventAt = await getLastLocationEventAt();
  if (settings.locationTrackingEnabled) {
    const now = new Date();
    const dayStart = localDayBounds(todayIso()).startMs;
    const windowStart = dayStart + settings.trackingStartMinutes * 60000;
    const windowEnd = dayStart + settings.trackingEndMinutes * 60000;
    // Až po 3 h pracovní doby (do té doby to může být klidné ráno doma).
    if (settings.trackingDays.includes(now.getDay()) && now.getTime() > windowStart + 3 * 3600000) {
      const count = await countLocationEventsBetween(new Date(windowStart).toISOString(), new Date(Math.min(now.getTime(), windowEnd)).toISOString());
      if (count === 0) {
        add({ id: 'noevents', level: 'warn', title: 'Dnes žádná událost polohy', detail: `Poslední zachycená: ${lastEventAt ? fmtDate(lastEventAt) : 'nikdy'}.`, action: '/settings/poloha' });
      }
    }
  }

  // Upozornění (jen když jsou připomenutí zapnutá)
  if (settings.reminderOnDeparture || settings.reminderOnArriveHome || settings.reminderEvening) {
    const perm = await DochazkaNative.getNotificationPermission().catch(() => 'undetermined' as const);
    if (perm !== 'granted') {
      add({ id: 'notifications', level: 'warn', title: 'Upozornění nejsou povolená', detail: 'Připomenutí zápisu se nezobrazí.', action: 'ios-settings' });
    }
  }

  const order: Record<HealthLevel, number> = { error: 0, warn: 1, ok: 2 };
  checks.sort((a, b) => order[a.level] - order[b.level]);
  const worst = checks.find((c) => c.level !== 'ok') ?? null;
  return { checks, lastEventAt, worst };
}

// Vážné problémy -> místní upozornění, nejvýš 1× denně na problém.
export async function evaluateHealthNotifications(): Promise<void> {
  const { checks } = await runHealthChecks();
  const date = todayIso();
  for (const c of checks.filter((x) => x.level === 'error')) {
    const key = `health.notified.${c.id}`;
    if ((await getInternalValue(key)) === date) continue;
    try {
      DochazkaNative.scheduleNotification(`health|${c.id}|${date}`, `Docházka: ${c.title}`, c.detail, 0, [], JSON.stringify({ kind: 'health' }));
      await setInternalValue(key, date);
    } catch {
      // nativní modul chybí
    }
  }
}
