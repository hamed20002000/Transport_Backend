/** What a browser's User-Agent says about the device, for people: «Android · Chrome», «iPhone · Safari», … */
export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const system =
    /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  // order matters: Edge, Samsung and Opera also say Chrome; Chrome also says Safari
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome|CriOS/.test(ua) ? 'Chrome'
    : /Safari/.test(ua) ? 'Safari'
    : null;
  return [system, browser].filter(Boolean).join(' · ') || 'دستگاه ناشناس';
}
