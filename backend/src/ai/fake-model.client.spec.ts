import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  aiConfig,
  appConfig,
  validateEnvironment,
} from '../config/configuration';
import { AiModule } from './ai.module';
import {
  FAKE_MODEL_ID,
  FAKE_TITLE_MAX_LENGTH,
  FakeModelClient,
} from './fake-model.client';
import { MODEL_CLIENT, type ModelClient } from './model-client';

describe('FakeModelClient', () => {
  let client: FakeModelClient;

  beforeEach(() => {
    client = new FakeModelClient();
  });

  it('generates the same answer from the latest user message', async () => {
    const input = {
      formattedContext: 'FROZEN_DISCUSSION_CONTEXT_LEGACY',
      messages: [
        { role: 'user' as const, content: 'An earlier question' },
        { role: 'assistant' as const, content: 'An earlier answer' },
        { role: 'user' as const, content: '  What   changed?  ' },
      ],
    };

    await expect(client.generateAnswer(input)).resolves.toEqual({
      content: 'Deterministic answer: What changed?',
      model: FAKE_MODEL_ID,
    });
    await expect(client.generateAnswer(input)).resolves.toEqual({
      content: 'Deterministic answer: What changed?',
      model: FAKE_MODEL_ID,
    });
  });

  it('derives a concise, single-line title from the first user message', async () => {
    const firstPrompt =
      '  Explain the implications of this deliberately long project decision for our launch plan  ';
    const result = await client.generateTitle({
      messages: [
        { role: 'user', content: firstPrompt },
        { role: 'assistant', content: 'A response' },
      ],
    });

    expect(result).toEqual({
      content: 'Explain the implications of this deliberately long project…',
      model: FAKE_MODEL_ID,
    });
    expect(result.content.length).toBeLessThanOrEqual(FAKE_TITLE_MAX_LENGTH);
    expect(result.content).not.toMatch(/\s{2,}|\n/);
  });

  it('returns stable fallbacks when no user message is present', async () => {
    await expect(
      client.generateAnswer({
        formattedContext: 'FROZEN_DISCUSSION_CONTEXT_LEGACY',
        messages: [],
      }),
    ).resolves.toEqual({
      content: 'Deterministic answer: No user question was provided.',
      model: FAKE_MODEL_ID,
    });
    await expect(
      client.generateTitle({
        messages: [{ role: 'assistant', content: 'Only an answer' }],
      }),
    ).resolves.toEqual({
      content: 'Untitled discussion',
      model: FAKE_MODEL_ID,
    });
  });

  it('exports the deterministic fake through the ModelClient port', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [appConfig, aiConfig],
          validate: validateEnvironment,
        }),
        AiModule,
      ],
    }).compile();

    const modelClient = module.get<ModelClient>(MODEL_CLIENT);

    expect(modelClient).toBeInstanceOf(FakeModelClient);
  });
});
