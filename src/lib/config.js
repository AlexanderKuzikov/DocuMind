import fs from 'node:fs/promises';
import path from 'node:path';
import JSONC from 'jsonc-parser';
import { resolveFromProject } from './paths.js';

export async function readJsoncFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const errors = [];
  const value = JSONC.parse(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const message = errors.map((error) => `${error.offset}: ${error.error}`).join('; ');
    throw new Error(`Invalid JSONC in ${filePath}: ${message}`);
  }
  return value;
}

export async function loadConfig(configPath = 'config/config.jsonc') {
  const absolute = resolveFromProject(configPath);
  const config = await readJsoncFile(absolute);
  const baseDir = path.dirname(absolute);
  config.__baseDir = baseDir;
  config.__path = absolute;
  return config;
}

export function resolveConfigPath(config, relativePath) {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.resolve(config.__baseDir, relativePath);
}

export function getEnvValue(key) {
  if (!key) return null;
  return process.env[key] || null;
}
