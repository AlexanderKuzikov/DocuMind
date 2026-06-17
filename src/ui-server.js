#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { modify, applyEdits, parseTree } from 'jsonc-parser';
import { projectRoot } from './lib/paths.js';
import { resolveFromProject } from './lib/paths.js';
import { loadConfig, resolveConfigPath } from './lib/config.js';
import { configDoctor, dryRun, renderPrompt, runPipeline } from './orchestrator.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;
const PORT_RANGE_END = 4183;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8'
  });
  res.end(body);
}

function sendText(res, status, contentType, text) {
  res.writeHead(status, { 'content-type': contentType });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonBody(req) {
  const text = await readBody(req);
  if (!text) return {};
  return JSON.parse(text);
}

function safeJoin(baseDir, relativePath) {
  const base = path.resolve(baseDir);
  const cleanRelativePath = String(relativePath).replace(/^[/\\]+/, '');
  const resolved = path.resolve(base, cleanRelativePath);
  if (!resolved.startsWith(`${base}${path.sep}`) && resolved !== base) throw new Error('Path traversal is not allowed');
  return resolved;
}

async function isPortAvailable(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

async function findAvailablePort(host, start, end) {
  for (let port = start; port <= end; port += 1) {
    if (await isPortAvailable(host, port)) return port;
  }
  throw new Error(`No free port found in range ${start}-${end} on ${host}`);
}

async function readTextFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function writeTextFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

async function updateConfigValue(relativePath, jsonPath, value) {
  const filePath = resolveFromProject(relativePath);
  const text = await readTextFile(filePath);
  const tree = parseTree(text);
  if (!tree) throw new Error('config/config.jsonc is not valid JSONC');
  const edits = modify(text, jsonPath, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  });
  await writeTextFile(filePath, applyEdits(text, edits));
  return { ok: true, path: relativePath };
}

async function listJsonFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => path.join(dirPath, entry.name));
}

async function listPromptFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => path.join(dirPath, entry.name));
}

async function scanComponents(config) {
  const componentDir = resolveConfigPath(config, config.components?.dir || './src/components');
  const entries = await fs.readdir(componentDir, { withFileTypes: true });
  const available = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.js'))) {
    const filePath = path.join(componentDir, entry.name);
    const module = await import(`${pathToFileURL(filePath).href}?t=${Date.now()}`);
    available.push({
      id: module.meta?.id,
      component: entry.name,
      filePath,
      label: module.meta?.label || module.meta?.id,
      description: module.meta?.description || '',
      version: module.meta?.version || '',
      input: module.meta?.input || [],
      output: module.meta?.output || [],
      defaultEnabled: module.meta?.defaultEnabled ?? true,
      requiredByDefault: module.meta?.requiredByDefault ?? false,
      hasRun: typeof module.run === 'function'
    });
  }
  return available.filter((item) => item.id);
}

function summarizePipeline(config) {
  const pipeline = Array.isArray(config.pipeline) ? config.pipeline : [];
  return pipeline.map((step, index) => ({
    order: index + 1,
    id: step.id,
    component: step.component,
    enabled: step.enabled !== false,
    required: step.required === true
  }));
}

async function handleApi(req, res, config) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const segments = url.pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(res, 200, {
        ok: true,
        path: 'config/config.jsonc',
        content: await readTextFile(resolveFromProject('config/config.jsonc'))
      });
    }

    if (req.method === 'PUT' && url.pathname === '/api/config') {
      const body = await readJsonBody(req);
      await writeTextFile(resolveFromProject('config/config.jsonc'), body.content);
      return sendJson(res, 200, { ok: true, path: 'config/config.jsonc' });
    }

    if (req.method === 'GET' && url.pathname === '/api/components') {
      const freshConfig = await loadConfig('config/config.jsonc');
      const available = await scanComponents(freshConfig);
      return sendJson(res, 200, {
        ok: true,
        available,
        pipeline: summarizePipeline(freshConfig)
      });
    }

    if (req.method === 'PUT' && url.pathname === '/api/pipeline') {
      const body = await readJsonBody(req);
      await updateConfigValue('config/config.jsonc', ['pipeline'], body.pipeline);
      return sendJson(res, 200, { ok: true, pipeline: body.pipeline });
    }

    if (req.method === 'GET' && url.pathname === '/api/doc-types') {
      const freshConfig = await loadConfig('config/config.jsonc');
      const dir = resolveConfigPath(freshConfig, freshConfig.paths.docTypes);
      const files = await listJsonFiles(dir);
      const items = await Promise.all(files.map(async (file) => ({
        name: path.basename(file, '.json'),
        path: file,
        content: await readTextFile(file)
      })));
      return sendJson(res, 200, { ok: true, items });
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/api/doc-types/')) {
      const name = decodeURIComponent(url.pathname.replace('/api/doc-types/', ''));
      const body = await readJsonBody(req);
      const freshConfig = await loadConfig('config/config.jsonc');
      const dir = resolveConfigPath(freshConfig, freshConfig.paths.docTypes);
      await writeTextFile(path.join(dir, `${name}.json`), body.content);
      return sendJson(res, 200, { ok: true, name });
    }

    if (req.method === 'GET' && url.pathname === '/api/prompts') {
      const freshConfig = await loadConfig('config/config.jsonc');
      const dir = resolveConfigPath(freshConfig, freshConfig.paths.prompts);
      const files = await listPromptFiles(dir);
      const items = await Promise.all(files.map(async (file) => ({
        name: path.basename(file),
        path: file,
        content: await readTextFile(file)
      })));
      return sendJson(res, 200, { ok: true, items });
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/api/prompts/')) {
      const name = decodeURIComponent(url.pathname.replace('/api/prompts/', ''));
      const body = await readJsonBody(req);
      const freshConfig = await loadConfig('config/config.jsonc');
      const dir = resolveConfigPath(freshConfig, freshConfig.paths.prompts);
      await writeTextFile(safeJoin(dir, name), body.content);
      return sendJson(res, 200, { ok: true, name });
    }

    if (req.method === 'POST' && url.pathname === '/api/actions/config-doctor') {
      return sendJson(res, 200, { ok: true, result: await configDoctor({ silent: true }) });
    }

    if (req.method === 'POST' && url.pathname === '/api/actions/dry-run') {
      return sendJson(res, 200, { ok: true, result: await dryRun({ silent: true }) });
    }

    if (req.method === 'POST' && url.pathname === '/api/actions/render-prompt') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { ok: true, result: await renderPrompt({ silent: true, docType: body.docType }) });
    }

    if (req.method === 'POST' && url.pathname === '/api/actions/extract') {
      return sendJson(res, 200, { ok: true, result: await runPipeline({ config: 'config/config.jsonc' }) });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/files/')) {
      const type = url.pathname.split('/')[3];
      if (!['output', 'debug'].includes(type)) throw new Error('Only output/debug files are allowed');
      const freshConfig = await loadConfig('config/config.jsonc');
      const base = resolveConfigPath(freshConfig, type === 'output' ? freshConfig.paths.output : freshConfig.paths.debug);
      const relative = decodeURIComponent(url.pathname.split('/').slice(4).join('/'));
      if (!relative) {
        const entries = await fs.readdir(base, { withFileTypes: true });
        return sendJson(res, 200, {
          ok: true,
          files: entries.map((entry) => ({
            name: entry.name,
            path: path.join(type, entry.name),
            directory: entry.isDirectory()
          }))
        });
      }
      const file = safeJoin(base, relative);
      return sendText(res, 200, 'application/json; charset=utf-8', await readTextFile(file));
    }

    return sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error.message,
      stack: error.stack
    });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const filePath = url.pathname === '/'
    ? resolveFromProject('ui/index.html')
    : safeJoin(resolveFromProject('ui'), url.pathname);

  let contentType = 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) contentType = 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) contentType = 'text/css; charset=utf-8';

  try {
    sendText(res, 200, contentType, await readTextFile(filePath));
  } catch {
    sendText(res, 404, 'text/plain; charset=utf-8', 'Not found');
  }
}

async function main() {
  const host = process.env.DOCUMIND_UI_HOST || DEFAULT_HOST;
  const startPort = Number(process.env.DOCUMIND_UI_PORT || DEFAULT_PORT);
  const port = await findAvailablePort(host, startPort, PORT_RANGE_END);

  const server = http.createServer(async (req, res) => {
    try {
      const config = await loadConfig('config/config.jsonc');
      if (req.url.startsWith('/api/')) return handleApi(req, res, config);
      return serveStatic(req, res);
    } catch (error) {
      return sendJson(res, 500, {
        ok: false,
        error: error.message,
        stack: error.stack
      });
    }
  });

  server.listen(port, host, () => {
    console.log(`DocuMind UI: http://${host}:${port}`);
    console.log(`Bound to localhost only. Port ${startPort}${port === startPort ? '' : ` was busy; using ${port}`}.`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
