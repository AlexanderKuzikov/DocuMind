import fs from 'node:fs/promises';
import { getEnvValue } from './config.js';
import { parseJsonLenient } from './json.js';

async function imageToDataUrl(image) {
  if (!image) return null;
  if (image.dataUrl) return image.dataUrl;
  if (image.path) {
    const ext = image.path.toLowerCase().endsWith('.png') ? 'png' : 'webp';
    const buffer = await fs.readFile(image.path);
    return `data:image/${ext};base64,${buffer.toString('base64')}`;
  }
  if (image.buffer) {
    const ext = image.format || 'webp';
    return `data:image/${ext};base64,${image.buffer.toString('base64')}`;
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

    const content = [];
    if (image) {
      const dataUrl = await imageToDataUrl(image);
      if (dataUrl) {
        content.push({ type: 'image_url', image_url: { url: dataUrl } });
      }
    }
    content.push({ type: 'text', text: prompt });

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), profile.timeout || this.config.llm.timeout || 180000);

    let response;
    try {
      response = await fetch(`${profile.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM request failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json = await response.json();
    const contentText = json.choices?.[0]?.message?.content;
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
  return passName === 'universal';
}
