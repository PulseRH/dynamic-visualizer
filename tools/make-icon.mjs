// Generates build/icon.ico (256px, PNG-compressed ICO) for the Windows build.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const S = 256;
const raw = Buffer.alloc(S * (1 + S * 4));
const cx = (S - 1) / 2, cy = (S - 1) / 2;
for (let y = 0; y < S; y++) {
  const rowStart = y * (1 + S * 4);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - cx, y - cy);
    const o = rowStart + 1 + x * 4;
    // dark rounded-square body with an accent ring
    const inBody = x > 8 && x < S - 9 && y > 8 && y < S - 9;
    const ring = Math.abs(d - S * 0.30) < S * 0.045;
    raw[o] = inBody ? (ring ? 110 : 24) : 12;
    raw[o + 1] = inBody ? (ring ? 168 : 26) : 13;
    raw[o + 2] = inBody ? (ring ? 255 : 46) : 15;
    raw[o + 3] = 255;
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
// ICO wrapper: 1 directory entry pointing at the embedded PNG
const icon = Buffer.alloc(6 + 16);
icon.writeUInt16LE(0, 0);      // reserved
icon.writeUInt16LE(1, 2);      // type: icon
icon.writeUInt16LE(1, 4);      // count
const entry = icon.subarray(6, 22);
entry[0] = 0; entry[1] = 0;    // 256px is encoded as 0
entry[2] = 0; entry[3] = 0;    // colors
entry[4] = 0; entry[5] = 0;    // planes/bpp unused for PNG
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);   // data offset
writeFileSync(new URL('../build/icon.ico', import.meta.url), Buffer.concat([icon, png]));
console.log('wrote build/icon.ico');
