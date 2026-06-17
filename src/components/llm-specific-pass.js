import { shouldSendImage } from '../lib/llm.js';

export const meta = {
  id: 'llm-specific-pass',
  version: '0.1.0',
  input: ['specificPrompt'],
  output: ['rawExtracted']
};

export async function run(context) {
  let session = context.artifacts.llmSession;
  const createdSession = !session;
  if (createdSession) session = await context.llm.createSession();

  try {
    const result = await context.llm.call(session, {
      image: shouldSendImage(context.config, 'specific') ? context.artifacts.image : null,
      prompt: context.artifacts.specificPrompt
    });

    if (!result.parsed) {
      return {
        ok: false,
        error: {
          code: 'LLM_JSON_INVALID',
          message: 'Specific pass returned non-JSON output.',
          stage: meta.id,
          recoverable: true,
          probableCauses: ['model added markdown', 'model added prose', 'response was truncated'],
          suggestions: ['repeat request', 'enable fallback profile', 'inspect debug/specific.response.json']
        }
      };
    }

    return {
      ok: true,
      artifacts: {
        rawExtracted: result.parsed,
        llmSpecificRaw: result.raw,
        llmSpecificText: result.text
      }
    };
  } finally {
    if (createdSession) {
      await context.llm.closeSession(session);
    }
  }
}
