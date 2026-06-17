import fs from 'node:fs/promises';
import path from 'node:path';
import { getEnvValue } from './config.js';
import { parseJsonLenient } from './json.js';

const MIME_MAP = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
  '.gif': 'gif',
  '.bmp': 'bmp',
};

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || 'webp';
}

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

async function imageToPayload(image, encoding = 'data-url') {
  if (!image) return null;

  if (encoding === 'base64' || encoding === 'base64-prefixed') {
    if (image.base64) return encoding === 'base64-prefixed' ? `base64,${image.base64}` : image.base64;
    if (image.path) {
      const buffer = await fs.readFile(image.path);
      const base64 = buffer.toString('base64');
      return encoding === 'base64-prefixed' ? `base64,${base64}` : base64;
    }
    if (image.buffer) {
      const base64 = image.buffer.toString('base64');
      return encoding === 'base64-prefixed' ? `base64,${base64}` : base64;
    }
    return null;
  }

  // data-url encoding
  if (image.dataUrl) return image.dataUrl;
  if (image.path) {
    const mime = mimeFromPath(image.path);
    const buffer = await fs.readFile(image.path);
    return `data:image/${mime};base64,${buffer.toString('base64')}`;
  }
  if (image.buffer) {
    const mime = image.format || 'webp';
    return `data:image/${mime};base64,${image.buffer.toString('base64')}`;
  }
  return null;
}

export class LlmClient {
  constructor(config) {
    this.config = config;
  }

  getActiveProfile() {
    const profileName = this.config.llm.activeProfile;
    const profile = this.config.llm.profiles[profileName];
    if (!profile) {
      throw new Error(`Unknown LLM profile: ${profileName}`);
    }
    return { name: profileName, ...profile };
  }

  async createSession() {
    return {
      profile: this.getActiveProfile(),
      messages: []
    };
  }

  async call(session, { image, prompt }) {
    const profile = session.profile;
    const apiKey = getEnvValue(profile.apiKeyEnv);
    if (profile.apiKeyEnv && !apiKey) {
      throw new Error(`Missing API key env variable: ${profile.apiKeyEnv}`);
    }

    // text first, image second — required by some local LLM servers (LM Studio, Qwen)
    const content = [];
    content.push({ type: 'text', text: prompt });
    if (image) {
      const imagePayload = await imageToPayload(image, profile.imageEncoding);
      if (imagePayload) {
        content.push({ type: 'image_url', image_url: { url: imagePayload } });
      }
    }

    session.messages.push({ role: 'user', content });

    const headers = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const body = {
      model: profile.model,
      messages: session.messages,
      temperature: this.config.llm.temperature ?? profile.temperature ?? 0,
      stream: profile.stream ?? this.config.llm.stream ?? false
    };

    if (this.config.llm.thinking?.enabled) {
      body.thinking = {
        type: 'enabled',
        budget_tokens: this.config.llm.thinking.budgetTokens ?? 4096
      };
    }

    const timeoutMs = profile.timeout || this.config.llm.timeout || 180000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(`${profile.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }

    if (!response.ok) {
      clearTimeout(timeout);
      const text = await response.text().catch(() => '');
      throw new Error(`LLM request failed: ${response.status} ${response.statusText} ${text}`);
    }

    let json;
    try {
      json = await response.json();
    } finally {
      clearTimeout(timeout);
    }

    const rawContent = json.choices?.[0]?.message?.content;
    const contentText = normalizeContent(rawContent);
    if (!contentText) {
      throw new Error('LLM response has no message content');
    }

    return {
      raw: json,
      text: contentText,
      parsed: parseJsonLenient(contentText)
    };
  }

  async closeSession() {
    // Stateless-compatible. Session state is held only for this request chain.
  }
}

export function shouldSendImage(config, passName) {
  const policy = config.llm.imagePolicy || 'session';
  if (policy === 'each-pass') return true;
  if (policy === 'first-pass-only') return passName === 'universal';
  if (policy === 'session') return passName === 'universal';
  console.warn(`[llm] Unknown imagePolicy: "${policy}", falling back to session behavior`);
  return passName === 'universal';
}
