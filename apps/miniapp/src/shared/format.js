import { formatMinor, formatPhoneRu } from '@pdr/shared';
export { formatMinor, formatPhoneRu };
export function formatDateTime(iso, timeZone) {
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
    }).format(new Date(iso));
}
export function formatDate(iso, timeZone) {
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone,
    }).format(new Date(iso));
}
export function formatTime(iso, timeZone) {
    return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}
export function plural(n, forms) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20)
        return forms[2];
    if (last > 1 && last < 5)
        return forms[1];
    if (last === 1)
        return forms[0];
    return forms[2];
}
export function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0)
        return `${m} мин`;
    if (m === 0)
        return `${h} ч`;
    return `${h} ч ${m} мин`;
}
//# sourceMappingURL=format.js.map