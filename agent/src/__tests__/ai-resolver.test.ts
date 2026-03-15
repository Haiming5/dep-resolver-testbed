import Anthropic from '@anthropic-ai/sdk';
import { AIResolver } from '../ai-resolver';
import type { GitHubClient } from '../github-client';
import { makeClassified } from './fixtures';

jest.mock('@actions/core', () => ({ info: jest.fn(), warning: jest.fn(), error: jest.fn() }));
jest.mock('@anthropic-ai/sdk');

// Mock fs so the template loader falls back to the embedded DEFAULT_PROMPT_TEMPLATE
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(() => { throw new Error('file not found'); }),
}));

const MockedAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

function makeGithubMock(manifest = '{"dependencies":{"lodash":"^4.17.0"}}'): jest.Mocked<Pick<GitHubClient, 'getFileContent'>> {
  return {
    getFileContent: jest.fn().mockResolvedValue(manifest),
  };
}

function makeAnthropicResponse(jsonBody: object): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: `\`\`\`json\n${JSON.stringify(jsonBody)}\n\`\`\`` }],
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 200 },
  } as Anthropic.Message;
}

describe('AIResolver', () => {
  let mockCreate: jest.Mock;
  let github: ReturnType<typeof makeGithubMock>;
  let resolver: AIResolver;

  beforeEach(() => {
    mockCreate = jest.fn();
    MockedAnthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as unknown as Anthropic);

    github = makeGithubMock();
    resolver = new AIResolver('test-api-key', github as unknown as GitHubClient);
  });

  describe('resolve()', () => {
    it('returns a parsed AIFixResult on a valid Claude response', async () => {
      mockCreate.mockResolvedValue(makeAnthropicResponse({
        summary: 'Upgrade lodash to fix prototype pollution.',
        risk_assessment: 'Low risk.',
        is_breaking_change: false,
        target_version: '4.17.21',
        patches: [{ path: 'package.json', content: '{"lodash":"^4.17.21"}' }],
      }));

      const result = await resolver.resolve(makeClassified(3.5));

      expect(result.targetVersion).toBe('4.17.21');
      expect(result.isBreakingChange).toBe(false);
      expect(result.patches).toHaveLength(1);
      expect(result.patches[0].path).toBe('package.json');
    });

    it('uses a low-severity system prompt for low alerts', async () => {
      mockCreate.mockResolvedValue(makeAnthropicResponse({
        summary: 's', risk_assessment: 'r', is_breaking_change: false,
        target_version: '1.0.0', patches: [],
      }));

      await resolver.resolve(makeClassified(2.0));

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toContain('LOW');
    });

    it('uses a medium-severity system prompt for medium alerts', async () => {
      mockCreate.mockResolvedValue(makeAnthropicResponse({
        summary: 's', risk_assessment: 'r', is_breaking_change: false,
        target_version: '1.0.0', patches: [],
      }));

      await resolver.resolve(makeClassified(5.0));

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toContain('MEDIUM');
    });

    it('reads the manifest file from the repo', async () => {
      mockCreate.mockResolvedValue(makeAnthropicResponse({
        summary: 's', risk_assessment: 'r', is_breaking_change: false,
        target_version: '1.0.0', patches: [],
      }));

      await resolver.resolve(makeClassified(3.0));

      expect(github.getFileContent).toHaveBeenCalledWith('package.json');
    });

    it('proceeds without a lock file when none is found', async () => {
      // First call returns manifest; all subsequent (lock file candidates) throw
      github.getFileContent
        .mockResolvedValueOnce('{"dependencies":{}}')
        .mockRejectedValue(new Error('not found'));

      mockCreate.mockResolvedValue(makeAnthropicResponse({
        summary: 's', risk_assessment: 'r', is_breaking_change: false,
        target_version: '1.0.0', patches: [],
      }));

      await expect(resolver.resolve(makeClassified(3.0))).resolves.toBeDefined();
    });
  });

  describe('parseResponse (via resolve)', () => {
    it('throws when Claude response has no ```json block', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Sorry, I cannot help with that.' }],
      } as unknown as Anthropic.Message);

      await expect(resolver.resolve(makeClassified(3.0))).rejects.toThrow(
        'did not contain a ```json``` block'
      );
    });

    it('throws when the json block contains invalid JSON', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '```json\n{ broken json\n```' }],
      } as unknown as Anthropic.Message);

      await expect(resolver.resolve(makeClassified(3.0))).rejects.toThrow(
        'Failed to parse JSON'
      );
    });

    it('fills in defaults for missing optional fields', async () => {
      mockCreate.mockResolvedValue(makeAnthropicResponse({}));

      const result = await resolver.resolve(makeClassified(3.0));

      expect(result.summary).toBe('No summary provided.');
      expect(result.riskAssessment).toBe('No risk assessment.');
      expect(result.isBreakingChange).toBe(false);
      expect(result.targetVersion).toBe('unknown');
      expect(result.patches).toEqual([]);
    });
  });
});
