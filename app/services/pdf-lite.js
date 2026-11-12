// A PDF of whole-page pictures (0.21.0), for Kladde's export: one JPEG per A4 page, nothing else. Small enough to
// write by hand, so the export works offline and needs no library from the net (Kladde.html loaded jsPDF from a CDN).
const enc = new TextEncoder();

// pages: [{ jpeg: Uint8Array, px: width in pixels, py: height in pixels }]; the page size in points (A4 by default).
export function jpegPdf(pages, { width = 595.28, height = 841.89, title = '' } = {}) {
  const chunks = [];
  const offsets = [];
  let size = 0;
  const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); size += b.length; };
  const obj = (n, body) => { offsets[n] = size; put(`${n} 0 obj\n`); for (const part of [].concat(body)) put(part); put('\nendobj\n'); };
  const n = pages.length;
  // objects: 1 catalog, 2 pages, 3 info, then per page: page, content, image
  const pageNo = (i) => 4 + i * 3;
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageNo(i)} 0 R`).join(' ')}] >>`);
  const text = (s) => `(${String(s).replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?')})`;
  obj(3, `<< /Producer (Toollib Kladde)${title ? ` /Title ${text(title)}` : ''} >>`);
  pages.forEach((p, i) => {
    const P = pageNo(i);
    const draw = `q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} 0 0 cm /Im0 Do Q`;
    obj(P, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] /Resources << /XObject << /Im0 ${P + 2} 0 R >> >> /Contents ${P + 1} 0 R >>`);
    obj(P + 1, [`<< /Length ${draw.length} >>\nstream\n`, draw, '\nendstream']);
    obj(P + 2, [`<< /Type /XObject /Subtype /Image /Width ${p.px} /Height ${p.py} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream']);
  });
  const xref = size;
  const count = 4 + n * 3;
  put(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) put(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

export async function canvasJpeg(canvas, quality = 0.9) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  if (!blob) throw new Error('jpeg');
  return new Uint8Array(await blob.arrayBuffer());
}
