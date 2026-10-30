// Helper baca/tulis file JSON di folder data.
import fs from 'node:fs';
import path from 'node:path';

const dir = () => process.env.DATA_DIR || path.resolve('data');

export function load(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir(), name), 'utf8'));
  } catch {
    return fallback;
  }
}

export function save(name, data) {
  fs.mkdirSync(dir(), { recursive: true });
  const file = path.join(dir(), name);
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(file + '.tmp', file);
}
