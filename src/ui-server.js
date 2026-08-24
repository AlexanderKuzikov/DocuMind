#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { modify, applyEdits, parseTree } from 'jsonc-parser';
import JSONC from 'jsonc-parser';
import { projectRoot } from './lib/paths.js';
import { resolveFromProject } from './lib/paths.js';
import { loadConfig, resolveConfigPath } from './lib/config.js';
import { configDoctor, dryRun, renderPrompt, runPipeline } from './orchestrator.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;
const PORT_RANGE_END = 4183;
let pipelineExecution = Promise.resolve();

async function withPipelineLock(fn) {
  const previous = pipelineExecution;
  let release;
  pipelineExecution = new Promise((resolve) => {
    release = resolve;
  });

  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
  }
}

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

async function backupFile(filePath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.bak-${timestamp}`;
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}

async function restoreFile(filePath, backupPath) {
  await fs.copyFile(backupPath, filePath);
}

function parseJsoncContent(content, filePath) {
  const errors = [];
  const value = JSONC.parse(content, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const message = errors.map((error) => `${error.offset}: ${error.error}`).join('; ');
    throw new Error(`Invalid JSONC in ${filePath}: ${message}`);
  }
  return value;
}

function parseJsonContent(content, filePath) {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

async function previewPromptAfterSave(docTypeName) {
  const freshConfig = await loadConfig('config/config.jsonc');
  return renderPrompt({ silent: true, docType: docTypeName });
}

async function saveConfigContent(filePath, content, options = {}) {
  const backupPath = await backupFile(filePath);
  try {
    if (options.parse === 'json') parseJsonContent(content, filePath);
    if (options.parse === 'jsonc') parseJsoncContent(content, filePath);
    await writeTextFile(filePath, content);
    const doctor = await configDoctor({ silent: true });
    if (!doctor.ok) throw new Error(`Config doctor failed: ${doctor.errors.join('; ')}`);
    if (options.previewPrompt !== false) {
      await previewPromptAfterSave(options.docTypeName || 'passport');
    }
    return { ok: true, backupPath, doctor };
  } catch (error) {
    await restoreFile(filePath, backupPath);
    throw error;
  }
}

async function updateConfigValue(relativePath, jsonPath, value) {
  const filePath = resolveFromProject(relativePath);
  const text = await readTextFile(filePath);
  const tree = parseTree(text);
  if (!tree) throw new Error('config/config.jsonc is not valid JSONC');
  const edits = modify(text, jsonPath, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  });
  const nextText = applyEdits(text, edits);
  await saveConfigContent(filePath, nextText, { parse: 'jsonc', previewPrompt: false });
  return { ok: true, path: relativePath };
}

async function saveJsonFile(relativePath, content) {
  const filePath = resolveFromProject(relativePath);
  const result = await saveConfigContent(filePath, content, { parse: 'json', previewPrompt: false });
  return { ok: true, path: relativePath, backupPath: result.backupPath };
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
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => path.join(dirPath, entry.name));
  // types subdir for per-type prompts
  try {
    const typesDir = path.join(dirPath, 'types');
    const typeEntries = await fs.readdir(typesDir, { withFileTypes: true });
    const typeFiles = typeEntries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => path.join(typesDir, e.name));
    return [...files, ...typeFiles].sort((a, b) => a.localeCompare(b));
  } catch {
    return files;
  }
}

async function listVerifyDocuments(config) {
  const stagingDir = resolveConfigPath(config, config.paths.staging);
  const outputDir = resolveConfigPath(config, config.paths.output);
  const inputDir = resolveConfigPath(config, config.paths.input);
  const items = [];
  // build output map once to avoid N+1
  const outputMap = new Map();
  try {
    const outFiles = await fs.readdir(outputDir, { withFileTypes: true });
    for (const f of outFiles.filter((x) => x.isFile() && x.name.endsWith('.json'))) {
      const p = path.join(outputDir, f.name);
      try {
        const j = JSON.parse(await readTextFile(p));
        if (j.docId) outputMap.set(j.docId, { json: j, path: p });
      } catch {}
    }
  } catch {}
  // scan staging
  try {
    const outEntries = await fs.readdir(stagingDir, { withFileTypes: true });
    for (const entry of outEntries.filter((e) => e.isDirectory())) {
      const manifestPath = path.join(stagingDir, entry.name, 'manifest.json');
      let manifest = null;
      try { manifest = JSON.parse(await readTextFile(manifestPath)); } catch {}
      const docId = entry.name;
      // find output json by docId from map
      const hit = outputMap.get(docId);
      let outputJson = hit?.json || null;
      let outputPath = hit?.path || null;
      try {
        if (!outputJson) {
          const dbg = resolveConfigPath(config, './debug');
          const dbgPath = path.join(dbg, docId, 'output.json');
          outputJson = JSON.parse(await readTextFile(dbgPath));
        }
      } catch {}
      // fallback: read output.json from debug/config
      let debugJson = null;
      try {
        const dbg = resolveConfigPath(config, './debug');
        const dbgPath = path.join(dbg, docId, 'output.json');
        debugJson = JSON.parse(await readTextFile(dbgPath));
      } catch {}
      const finalJson = outputJson || debugJson;
      items.push({
        docId,
        inputFile: manifest?.source?.[0]?.path || manifest?.source?.path || null,
        inputName: manifest?.source?.[0]?.name || (manifest?.source?.path ? path.basename(manifest.source.path) : null),
        assembledPdf: manifest?.assembledPdf?.path || null,
        outputJsonPath: outputPath,
        outputPdfPath: finalJson?.pdfFileName ? path.join(outputDir, finalJson.pdfFileName) : null,
        docType: finalJson?.docType || null,
        docTypeName: finalJson?.docTypeName || null,
        status: finalJson?.status || 'unknown',
        confidence: finalJson?.confidence ?? null,
        fields: finalJson ? Object.fromEntries(Object.entries(finalJson).filter(([k]) => !['docId','docType','docTypeName','status','confidence','createdAt','pdfFileName','jsonFileName','outputNaming'].includes(k))) : null,
        json: finalJson
      });
    }
  } catch {}
  // also include input files without staging (not yet processed)
  try {
    const inEntries = await fs.readdir(inputDir, { withFileTypes: true });
    const stagedInputs = new Set(items.map((i) => i.inputFile && path.basename(i.inputFile)).filter(Boolean));
    for (const e of inEntries.filter((x) => x.isFile() && /\.(pdf|png|jpg|jpeg|webp)$/i.test(x.name))) {
      if (!stagedInputs.has(e.name)) {
        items.push({
          docId: null,
          inputFile: path.join(inputDir, e.name),
          inputName: e.name,
          assembledPdf: null,
          outputJsonPath: null,
          outputPdfPath: null,
          docType: null,
          docTypeName: null,
          status: 'not_processed',
          confidence: null,
          fields: null,
          json: null
        });
      }
    }
  } catch {}
  return items.sort((a, b) => (a.inputName || '').localeCompare(b.inputName || '', 'ru'));
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
      const filePath = resolveFromProject('config/config.jsonc');
      const result = await saveConfigContent(filePath, body.content, { parse: 'jsonc' });
      return sendJson(res, 200, { ok: true, path: 'config/config.jsonc', backupPath: result.backupPath, doctor: result.doctor });
    }

    if (req.method === 'GET' && url.pathname === '/api/field-mappings') {
      return sendJson(res, 200, {
        ok: true,
        path: 'config/field_mappings.json',
        content: await readTextFile(resolveFromProject('config/field_mappings.json'))
      });
    }

    if (req.method === 'PUT' && url.pathname === '/api/field-mappings') {
      const body = await readJsonBody(req);
      const result = await saveJsonFile('config/field_mappings.json', body.content);
      return sendJson(res, 200, result);
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
      const result = await updateConfigValue('config/config.jsonc', ['pipeline'], body.pipeline);
      return sendJson(res, 200, { ok: true, pipeline: body.pipeline, backupPath: result.backupPath, doctor: result.doctor });
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
      const safeName = path.basename(name, '.json');
      const body = await readJsonBody(req);
      const freshConfig = await loadConfig('config/config.jsonc');
      const dir = resolveConfigPath(freshConfig, freshConfig.paths.docTypes);
      const filePath = safeJoin(dir, `${safeName}.json`);
      const result = await saveConfigContent(filePath, body.content, { parse: 'json', docTypeName: safeName });
      return sendJson(res, 200, { ok: true, name: safeName, backupPath: result.backupPath, doctor: result.doctor });
    }

    if (req.method === 'GET' && url.pathname === '/api/prompts') {
      const freshConfig = await loadConfig('config/config.jsonc');
      const dir = resolveConfigPath(freshConfig, freshConfig.paths.prompts);
      const files = await listPromptFiles(dir);
      const items = await Promise.all(files.map(async (file) => ({
        name: path.relative(dir, file).replace(/\\/g, '/'),
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
      const filePath = safeJoin(dir, name);
      const result = await saveConfigContent(filePath, body.content, { parse: 'text' });
      return sendJson(res, 200, { ok: true, name, backupPath: result.backupPath, doctor: result.doctor });
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
      const result = await withPipelineLock(() => runPipeline({ config: 'config/config.jsonc' }));
      return sendJson(res, 200, { ok: true, result });
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

    if (req.method === 'GET' && url.pathname === '/api/verify/list') {
      const freshConfig = await loadConfig('config/config.jsonc');
      const items = await listVerifyDocuments(freshConfig);
      return sendJson(res, 200, { ok: true, items });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/raw/')) {
      const kind = url.pathname.split('/')[3]; // input | output | staging
      const freshConfig = await loadConfig('config/config.jsonc');
      let base;
      if (kind === 'input') base = resolveConfigPath(freshConfig, freshConfig.paths.input);
      else if (kind === 'output') base = resolveConfigPath(freshConfig, freshConfig.paths.output);
      else if (kind === 'staging') base = resolveConfigPath(freshConfig, freshConfig.paths.staging);
      else throw new Error('Unknown raw kind');
      const relative = decodeURIComponent(url.pathname.split('/').slice(4).join('/'));
      if (!relative) throw new Error('Missing file path');
      const file = safeJoin(base, relative);
      try {
        const realBase = await fs.realpath(base).catch(() => base);
        const realFile = await fs.realpath(file).catch(() => file);
        if (!realFile.startsWith(realBase + path.sep) && realFile !== realBase) throw new Error('Path traversal');
      } catch (e) { if (e.message === 'Path traversal') throw e; }
      const data = await fs.readFile(file);
      const ext = path.extname(file).toLowerCase();
      let ct = 'application/octet-stream';
      if (ext === '.pdf') ct = 'application/pdf';
      else if (ext === '.json') ct = 'application/json; charset=utf-8';
      else if (ext === '.jpg' || ext === '.jpeg') ct = 'image/jpeg';
      else if (ext === '.png') ct = 'image/png';
      res.writeHead(200, { 'content-type': ct, 'content-length': data.length });
      return res.end(data);
    }

    return sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error.message
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
        error: error.message
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
