import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = join(root, 'static', 'favicon.svg');
const out = join(root, 'static');
const android = join(root, 'android');
const ios = join(root, 'ios');

function findMagick(): string {
  for (const cmd of ['magick', 'convert']) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'ignore' });
      return cmd;
    } catch {
      // try next
    }
  }
  throw new Error(
    'ImageMagick not found. Install with: brew install imagemagick / apt install imagemagick',
  );
}

if (!existsSync(svg)) {
  console.error(`Error: ${svg} not found`);
  process.exit(1);
}

const magick = findMagick();
console.log(`Generating icons from ${svg}...`);

// favicon.svg is full-bleed: its first <rect> is the background the logo sits
// on. iOS icons must be opaque (the App Store rejects alpha) and Android's
// adaptive background layer has to match that same color, so derive it once
// here and reuse it for both.
const svgText = readFileSync(svg, 'utf8');
const bgMatch = svgText.match(/<rect[^>]*\sfill="(#[0-9a-fA-F]{3,8})"/);
if (!bgMatch) {
  console.error('Error: no background <rect fill="..."> found in favicon.svg');
  process.exit(1);
}
const bg = bgMatch[1];

// Transparent-background rasterize (PWA icons, Android adaptive foreground).
function rasterize(size: number, dest: string) {
  execFileSync(magick, [
    '-background',
    'none',
    '-density',
    '3000',
    svg,
    '-resize',
    `${size}x${size}`,
    dest,
  ]);
}

// Opaque rasterize: flatten onto the background and drop the alpha channel so
// the PNG has no transparency (required for iOS app icons).
function rasterizeOpaque(size: number, dest: string) {
  execFileSync(magick, [
    '-background',
    bg,
    '-density',
    '3000',
    svg,
    '-resize',
    `${size}x${size}`,
    '-flatten',
    '-alpha',
    'off',
    dest,
  ]);
}

// Circular variant for launchers that request a round icon
// (Android ic_launcher_round). Mask the square art with a filled circle.
function rasterizeRound(size: number, dest: string) {
  const c = (size - 1) / 2;
  execFileSync(magick, [
    '-background',
    'none',
    '-density',
    '3000',
    svg,
    '-resize',
    `${size}x${size}`,
    '(',
    '-size',
    `${size}x${size}`,
    'xc:none',
    '-fill',
    'white',
    '-draw',
    `circle ${c},${c} ${c},0`,
    ')',
    '-alpha',
    'set',
    '-compose',
    'DstIn',
    '-composite',
    dest,
  ]);
}

// Android adaptive foreground: the launcher masks the outer edge of the canvas
// and may clip it to a circle, so scale the full-bleed art into the center
// safe zone. The transparent margin lets the background layer show through.
function rasterizeForeground(size: number, dest: string) {
  const inner = Math.round(size * 0.72);
  execFileSync(magick, [
    '-background',
    'none',
    '-density',
    '3000',
    svg,
    '-resize',
    `${inner}x${inner}`,
    '-gravity',
    'center',
    '-background',
    'none',
    '-extent',
    `${size}x${size}`,
    dest,
  ]);
}

// --- PWA / web icons ---
const tmp16 = join(out, 'tmp-16.png');
const tmp32 = join(out, 'tmp-32.png');

rasterize(16, tmp16);
rasterize(32, tmp32);
rasterize(64, join(out, 'pwa-64x64.png'));
rasterize(192, join(out, 'pwa-192x192.png'));
rasterize(512, join(out, 'pwa-512x512.png'));
copyFileSync(
  join(out, 'pwa-512x512.png'),
  join(out, 'maskable-icon-512x512.png'),
);
rasterize(180, join(out, 'apple-touch-icon.png'));

execFileSync(magick, [tmp16, tmp32, join(out, 'favicon.ico')]);

unlinkSync(tmp16);
unlinkSync(tmp32);

// --- iOS app icon (Capacitor) ---
// Single 1024 universal icon, matching the generated AppIcon Contents.json.
const iosAppIcon = join(
  ios,
  'App',
  'App',
  'Assets.xcassets',
  'AppIcon.appiconset',
);
if (existsSync(iosAppIcon)) {
  rasterizeOpaque(1024, join(iosAppIcon, 'AppIcon-512@2x.png'));
  console.log('  iOS AppIcon');
} else {
  console.log('  iOS: skipped (no ios/ platform; run `npx cap add ios`)');
}

// --- Android launcher icons (Capacitor) ---
// Legacy square/round icons (pre-API-26) plus the adaptive foreground layer.
const androidRes = join(android, 'app', 'src', 'main', 'res');
if (existsSync(androidRes)) {
  const densities = [
    { dir: 'mdpi', legacy: 48, fg: 108 },
    { dir: 'hdpi', legacy: 72, fg: 162 },
    { dir: 'xhdpi', legacy: 96, fg: 216 },
    { dir: 'xxhdpi', legacy: 144, fg: 324 },
    { dir: 'xxxhdpi', legacy: 192, fg: 432 },
  ];
  for (const { dir, legacy, fg } of densities) {
    const mip = join(androidRes, `mipmap-${dir}`);
    rasterize(legacy, join(mip, 'ic_launcher.png'));
    rasterizeRound(legacy, join(mip, 'ic_launcher_round.png'));
    rasterizeForeground(fg, join(mip, 'ic_launcher_foreground.png'));
  }
  // Adaptive background layer color, referenced as @color/ic_launcher_background
  // by mipmap-anydpi-v26/ic_launcher*.xml. Kept in sync with the SVG background.
  writeFileSync(
    join(androidRes, 'values', 'ic_launcher_background.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<resources>\n' +
      `    <color name="ic_launcher_background">${bg}</color>\n` +
      '</resources>\n',
  );
  console.log('  Android launcher icons');
} else {
  console.log(
    '  Android: skipped (no android/ platform; run `npx cap add android`)',
  );
}

console.log('Done.');
