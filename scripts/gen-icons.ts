import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = join(root, 'static', 'favicon.svg');
const out = join(root, 'static');

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

function rasterize(size: number, dest: string) {
  execFileSync(magick, [
    '-background',
    'none',
    svg,
    '-resize',
    `${size}x${size}`,
    dest,
  ]);
}

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

console.log('Done.');
