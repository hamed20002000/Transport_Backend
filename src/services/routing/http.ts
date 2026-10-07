import { Agent } from 'https';

/**
 * فقط IPv4 (مثل ربات تلگرام): روی این شبکه IPv6 وصل نمی‌شود و Node بعد از
 * ۲۵۰ms تلاش روی هر آدرس، کل اتصال را با ENETUNREACH/ETIMEDOUT رها می‌کند.
 */
export const ipv4Agent = new Agent({ family: 4, keepAlive: true });
