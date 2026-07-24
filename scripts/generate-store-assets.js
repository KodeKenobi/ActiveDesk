const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = process.cwd();
const iconPath = path.join(root, 'assets', 'activedesk-icon.png');
const outDir = path.join(root, 'assets', 'store');

if (!fs.existsSync(iconPath)) {
  throw new Error(`Icon not found: ${iconPath}`);
}
fs.mkdirSync(outDir, { recursive: true });

const BRAND_BG = '#0f172a';
const BRAND_ACCENT = '#22d3ee';
const BRAND_ACCENT_2 = '#38bdf8';
const TITLE = 'ActiveDesk';

function escXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function bgSvg(width, height) {
  const w = width;
  const h = height;
  return `
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#111827"/>
      <stop offset="55%" stop-color="${BRAND_BG}"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
    <radialGradient id="g2" cx="0.2" cy="0.15" r="0.9">
      <stop offset="0%" stop-color="${BRAND_ACCENT}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${BRAND_ACCENT}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g3" cx="0.85" cy="0.85" r="0.8">
      <stop offset="0%" stop-color="${BRAND_ACCENT_2}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${BRAND_ACCENT_2}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g1)"/>
  <rect width="100%" height="100%" fill="url(#g2)"/>
  <rect width="100%" height="100%" fill="url(#g3)"/>
  <g opacity="0.18" stroke="#67e8f9" stroke-width="2" fill="none">
    <circle cx="${Math.round(w * 0.13)}" cy="${Math.round(h * 0.2)}" r="${Math.round(Math.min(w, h) * 0.14)}"/>
    <circle cx="${Math.round(w * 0.86)}" cy="${Math.round(h * 0.76)}" r="${Math.round(Math.min(w, h) * 0.1)}"/>
  </g>
</svg>`;
}

function titleSvg(width, height, text) {
  const safe = escXml(text);
  const fontSize = Math.max(42, Math.round(width * 0.07));
  const x = Math.round(width * 0.08);
  const y = Math.round(height * 0.18);
  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <text x="${x}" y="${y}" font-family="Avenir Next, SF Pro Display, Segoe UI, Arial, sans-serif" font-size="${fontSize}" font-weight="800" fill="#f8fafc" letter-spacing="1">${safe}</text>
</svg>`;
}

async function renderAsset({ fileName, width, height, iconScale = 0.42, includeTitle = false }) {
  const bg = Buffer.from(bgSvg(width, height));
  const iconSize = Math.round(Math.min(width, height) * iconScale);

  const icon = await sharp(iconPath)
    .resize(iconSize, iconSize, { fit: 'contain' })
    .png()
    .toBuffer();

  const topBand = includeTitle ? 0.26 : 0;
  const iconTop = includeTitle
    ? Math.round(height * topBand + (height * (1 - topBand) - iconSize) * 0.42)
    : Math.round((height - iconSize) / 2);

  const layers = [
    {
      input: icon,
      left: Math.round((width - iconSize) / 2),
      top: Math.max(0, iconTop)
    }
  ];

  if (includeTitle) {
    layers.push({ input: Buffer.from(titleSvg(width, height, TITLE)), left: 0, top: 0 });
  }

  const outPath = path.join(outDir, fileName);
  await sharp(bg)
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

async function main() {
  const specs = [
    { fileName: 'tile-1x1-300x300.png', width: 300, height: 300, iconScale: 0.66, includeTitle: false },
    { fileName: 'tile-1x1-150x150.png', width: 150, height: 150, iconScale: 0.66, includeTitle: false },
    { fileName: 'tile-1x1-71x71.png', width: 71, height: 71, iconScale: 0.66, includeTitle: false },
    { fileName: 'super-hero-16x9-1920x1080.png', width: 1920, height: 1080, iconScale: 0.42, includeTitle: false },
    { fileName: 'super-hero-16x9-3840x2160.png', width: 3840, height: 2160, iconScale: 0.42, includeTitle: false },
    { fileName: 'xbox-branded-key-art-584x800.png', width: 584, height: 800, iconScale: 0.46, includeTitle: true },
    { fileName: 'xbox-titled-hero-art-1920x1080.png', width: 1920, height: 1080, iconScale: 0.38, includeTitle: true },
    { fileName: 'xbox-featured-promo-square-1080x1080.png', width: 1080, height: 1080, iconScale: 0.5, includeTitle: false }
  ];

  for (const spec of specs) {
    await renderAsset(spec);
    console.log(`Created ${spec.fileName}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
