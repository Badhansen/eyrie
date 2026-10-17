/**
 * Renders the app icon to the files the packagers read, from assets/icon.svg
 * (128 pt and up) and assets/icon-small.svg (16 and 32 pt):
 *
 *   assets/icon.icns  macOS: the system icon grid, with its shadow
 *   assets/icon.ico   Windows: the body filling the canvas
 *   assets/icon.png   Linux and the window: 512 px, the body filling the canvas
 *
 * Electron draws the SVGs, so it needs nothing the repository does not have:
 *   pnpm --filter @eyrie/desktop icons [-- --preview sheet.png]
 * `--preview` also writes every size side by side on a dark and a light background.
 * Run with Electron, not Node: it is an .mjs file because Electron cannot run TypeScript.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const assets = new URL('../assets/', import.meta.url);
const read = (name) => readFileSync(new URL(name, assets), 'utf8');
const write = (name, data) => {
  writeFileSync(new URL(name, assets), data);
  console.log(`assets/${name}  ${(data.length / 1024).toFixed(1)} KB`);
};

const full = read('icon.svg');
const small = read('icon-small.svg');
/** Windows and Linux have no shared icon grid: drop the shadow and crop to the body, with a small margin. */
const flat = (svg) => svg.replace('viewBox="0 0 1024 1024"', 'viewBox="88 88 848 848"').replace('</svg>', '<style>#shadow{display:none}</style></svg>');
/** The design for a size in points: the small one keeps the trace legible at 16 and 32 pt. */
const forPoints = (points) => (points <= 32 ? small : full);

/** Draws an SVG at `size` pixels in the page and returns the PNG. */
function drawScript(svg, size) {
  const draw = async (svg, size) => {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, size, size);
    return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
  };
  return `(${draw})(${JSON.stringify(svg)}, ${size})`;
}

/** Every size on a dark and a light background, at its own pixel size, for a quick look. */
function sheetScript(pngs) {
  const sheet = async (pngs) => {
    const pad = 32;
    const width = pngs.reduce((w, p) => w + p.size + pad, pad);
    const tallest = Math.max(...pngs.map((p) => p.size));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = 2 * (tallest + 2 * pad);
    const ctx = canvas.getContext('2d');
    for (const [row, background] of ['#1e1f22', '#e9e9eb'].entries()) {
      const top = row * (tallest + 2 * pad);
      ctx.fillStyle = background;
      ctx.fillRect(0, top, width, tallest + 2 * pad);
      let x = pad;
      for (const p of pngs) {
        const img = new Image();
        img.src = `data:image/png;base64,${p.data}`;
        await img.decode();
        ctx.drawImage(img, x, top + pad + (tallest - p.size));
        x += p.size + pad;
      }
    }
    return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
  };
  return `(${sheet})(${JSON.stringify(pngs)})`;
}

/** An .icns file: a header, then each image as a type code, its length and a PNG. */
function icns(entries) {
  const chunks = entries.map(([type, png]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/** An .ico file with PNG images, which Windows reads since Vista. A size of 256 is written as 0. */
function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const directory = images.map(([size, png]) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([head, ...directory, ...images.map(([, png]) => png)]);
}

async function main() {
  app.setPath('userData', join(tmpdir(), 'eyrie-make-icons'));
  app.dock?.hide();
  await app.whenReady();
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<!doctype html><title>Eyrie icons</title>');
  const png = async (svg, size) => Buffer.from(await win.webContents.executeJavaScript(drawScript(svg, size)), 'base64');

  // [type, points, scale]: each macOS slot is drawn from the design for its size in points.
  const slots = [
    ['icp4', 16, 1],
    ['ic11', 16, 2],
    ['icp5', 32, 1],
    ['ic12', 32, 2],
    ['ic07', 128, 1],
    ['ic13', 128, 2],
    ['ic08', 256, 1],
    ['ic14', 256, 2],
    ['ic09', 512, 1],
    ['ic10', 512, 2],
  ];
  const mac = [];
  for (const [type, points, scale] of slots) mac.push([type, await png(forPoints(points), points * scale)]);
  write('icon.icns', icns(mac));

  const windows = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) windows.push([size, await png(flat(forPoints(size)), size)]);
  write('icon.ico', ico(windows));

  write('icon.png', await png(flat(full), 512));

  const at = process.argv.indexOf('--preview');
  if (at !== -1 && process.argv[at + 1]) {
    const sizes = [512, 256, 128, 64, 32, 16];
    const pngs = [];
    for (const size of sizes) pngs.push({ size, data: (await png(forPoints(size), size)).toString('base64') });
    const sheet = Buffer.from(await win.webContents.executeJavaScript(sheetScript(pngs)), 'base64');
    writeFileSync(process.argv[at + 1], sheet);
    console.log(`preview  ${process.argv[at + 1]}`);
  }
  app.quit();
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});
