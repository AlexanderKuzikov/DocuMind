import { shouldSendImage } from '../lib/llm.js';

export const meta = {
  id: 'llm-universal-pass',
  version: '0.1.0',
  input: ['image', 'universalPrompt'],
  output: ['firstPassResult']
};

export async function run(context) {
  let session = context.artifacts.llmSession;
  const createdSession = !session;
  if (createdSession) session = await context.llm.createSession();

  try {
    const result = await context.llm.call(session, {
      image: shouldSendImage(context.config, 'universal') ? context.artifacts.image : null,
      prompt: context.artifacts.universalPrompt
    });

    if (!result.parsed) {
      return {
        ok: false,
        error: {
          code: 'LLM_JSON_INVALID',
          message: 'Universal pass returned non-JSON output.',
          stage: meta.id,
          recoverable: true,
          probableCauses: ['model added markdown', 'model added prose', 'response was truncated'],
          suggestions: ['repeat request', 'enable fallback profile', 'inspect debug/universal.response.json']
        }
      };
    }

    return {
      ok: true,
      artifacts: {
        firstPassResult: result.parsed,
        llmUniversalRaw: result.raw,
        llmUniversalText: result.text
      }
    };
  } finally {
    if (createdSession) {
      await context.llm.closeSession(session);
    }
  }
}
