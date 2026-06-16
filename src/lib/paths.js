import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function resolveFromProject(...parts) {
  return path.resolve(projectRoot, ...parts);
}

export function normalizeSlashes(value) {
  return value.split(path.sep).join('/');
}

export function toPosixPath(value) {
  return value.split(path.sep).join('/');
}
