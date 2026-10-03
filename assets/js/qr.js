// QR codes for the join link. The library is loaded on demand, pinned to
// an exact version, with Subresource Integrity so a tampered CDN file is
// refused by the browser.
const SRC = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
const SRI = 'sha256-GK45n4EYK8nekW6cd7GV3yDMWNby1VpisIWimfG/F4A=';

let loading;
function loadLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SRC;
      s.integrity = SRI;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('QR library missing')));
      s.onerror = () => { loading = null; reject(new Error('QR library failed to load')); };
      document.head.append(s);
    });
  }
  return loading;
}

/** Returns an <svg> element for `text` (drawn by us, no innerHTML). */
export async function qrSvg(text, { margin = 2, dark = '#201E1D' } = {}) {
  const qrcode = await loadLib();
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code to join this class');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', size);
  bg.setAttribute('height', size);
  bg.setAttribute('fill', '#fff');
  svg.append(bg);
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', dark);
  svg.append(path);
  return svg;
}

export function joinUrl(code) {
  const url = new URL('app.html', location.href);
  url.hash = `#/join/${code}`;
  return url.href;
}
