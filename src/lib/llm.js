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

/**
 * Convert image to the payload string expected by image_url.url.
 *
 * Encoding modes:
 *   'data-url'        — full data-URL: data:image/webp;base64,AAAA...
 *   'base64-prefixed' — same as data-url
 *   'base64'          — raw base64 only: AAAA...  (some cloud APIs)
 *
 * lmStudioCompat: true — forces mime to 'png' in the data-URL header.
 *   LM Studio has a confirmed bug (lmstudio-bug-tracker#1752) where it
 *   rejects data:image/webp;base64,... but accepts data:image/png;base64,...
 *   even when the actual bytes are webp/jpeg.
 */
async function imageToPayload(image, encoding = 'data-url', lmStudioCompat = false) {
  if (!image) return null;

  if (encoding === 'data-url' || encoding === 'base64-prefixed') {
    if (image.dataUrl) {
      if (lmStudioCompat) {
        return image.dataUrl.replace(/^data:image\/[^;]+;/, 'data:image/png;');
      }
      return image.dataUrl;
    }

    let base64;
    let mime;

    if (image.path) {
      mime = lmStudioCompat ? 'png' : mimeFromPath(image.path);
      const buffer = await fs.readFile(image.path);
      base64 = buffer.toString('base64');
    } else if (image.buffer) {
      mime = lmStudioCompat ? 'png' : (image.format || 'webp');
      base64 = image.buffer.toString('base64');
    } else if (image.base64) {
      mime = lmStudioCompat ? 'png' : (image.path ? mimeFromPath(image.path) : (image.format || 'webp'));
      base64 = image.base64;
    } else {
      return null;
    }

    return `data:image/${mime};base64,${base64}`;
  }

  // 'base64' — raw base64 only, for cloud APIs that wrap it themselves
  if (encoding === 'base64') {
    if (image.base64) return image.base64;
    if (image.path) {
      const buffer = await fs.readFile(image.path);
      return buffer.toString('base64');
    }
    if (image.buffer) {
      return image.buffer.toString('base64');
    }
    return null;
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
      const imagePayload = await imageToPayload(
        image,
        profile.imageEncoding,
        profile.lmStudioCompat === true
      );
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

    const disableThinking = this.config.llm.disableThinking === true;
    const thinkingEnabled = !disableThinking && (this.config.llm.thinking?.enabled === true);

    const body = {
      model: profile.model,
      messages: session.messages,
      temperature: this.config.llm.temperature ?? profile.temperature ?? 0,
      stream: profile.stream ?? this.config.llm.stream ?? false,
      // Qwen3 requires chat_template_kwargs to actually toggle thinking mode.
      // This works for LM Studio, Ollama, and vLLM with Qwen3 models.
      chat_template_kwargs: { enable_thinking: thinkingEnabled }
    };

    if (thinkingEnabled) {
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
