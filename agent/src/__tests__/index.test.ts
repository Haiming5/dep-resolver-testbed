/**
 * Tests for processAlert() — the core routing logic in index.ts.
 *
 * We mock all collaborators at the class boundary so this only tests
 * the routing decisions (high → notifier, low/medium → AI+PR, dry-run flag).
 */

// Use factory mocks so Jest never loads the real files (avoids ESM issues with @octokit/rest)
jest.mock('../github-client', () => ({ GitHubClient: jest.fn() }));
jest.mock('../ai-resolver', () => ({ AIResolver: jest.fn() }));
jest.mock('../pr-creator', () => ({ PRCreator: jest.fn() }));
jest.mock('../notifier', () => ({ Notifier: jest.fn() }));
jest.mock('../classifier', () => ({ AlertClassifier: jest.fn() }));

import { processAlert } from '../index';
import type { AIResolver } from '../ai-resolver';
import type { PRCreator } from '../pr-creator';
import type { Notifier } from '../notifier';
import { makeClassified, SAMPLE_FIX } from './fixtures';

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  startGroup: jest.fn(),
  endGroup: jest.fn(),
  setOutput: jest.fn(),
}));

function makeCollaborators() {
  const aiResolver: jest.Mocked<Pick<AIResolver, 'resolve'>> = {
    resolve: jest.fn().mockResolvedValue(SAMPLE_FIX),
  };
  const prCreator: jest.Mocked<Pick<PRCreator, 'createFixPR'>> = {
    createFixPR: jest.fn().mockResolvedValue({
      number: 42,
      html_url: 'https://github.com/test/test/pull/42',
      branch: 'dep-resolver/alert-1-lodash',
      title: '🟢 fix(deps): upgrade lodash to 4.17.21',
    }),
  };
  const notifier: jest.Mocked<Pick<Notifier, 'notify'>> = {
    notify: jest.fn().mockResolvedValue(undefined),
  };
  return { aiResolver, prCreator, notifier };
}

describe('processAlert()', () => {
  describe('severity routing', () => {
    it('routes high severity to notifier (not AI or PR)', async () => {
      const { aiResolver, prCreator, notifier } = makeCollaborators();

      await processAlert(
        makeClassified(9.0),
        aiResolver as unknown as AIResolver,
        prCreator as unknown as PRCreator,
        notifier as unknown as Notifier,
        false
      );

      expect(notifier.notify).toHaveBeenCalledTimes(1);
      expect(aiResolver.resolve).not.toHaveBeenCalled();
      expect(prCreator.createFixPR).not.toHaveBeenCalled();
    });

    it('routes low severity through AI resolver and PR creator', async () => {
      const { aiResolver, prCreator, notifier } = makeCollaborators();

      await processAlert(
        makeClassified(2.0),
        aiResolver as unknown as AIResolver,
        prCreator as unknown as PRCreator,
        notifier as unknown as Notifier,
        false
      );

      expect(aiResolver.resolve).toHaveBeenCalledTimes(1);
      expect(prCreator.createFixPR).toHaveBeenCalledTimes(1);
      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('routes medium severity through AI resolver and PR creator', async () => {
      const { aiResolver, prCreator, notifier } = makeCollaborators();

      await processAlert(
        makeClassified(5.0),
        aiResolver as unknown as AIResolver,
        prCreator as unknown as PRCreator,
        notifier as unknown as Notifier,
        false
      );

      expect(aiResolver.resolve).toHaveBeenCalledTimes(1);
      expect(prCreator.createFixPR).toHaveBeenCalledTimes(1);
      expect(notifier.notify).not.toHaveBeenCalled();
    });
  });

  describe('dry-run mode', () => {
    it('skips PR creation for low/medium when dry-run=true', async () => {
      const { aiResolver, prCreator, notifier } = makeCollaborators();

      await processAlert(
        makeClassified(3.0),
        aiResolver as unknown as AIResolver,
        prCreator as unknown as PRCreator,
        notifier as unknown as Notifier,
        true // dry-run
      );

      expect(aiResolver.resolve).toHaveBeenCalledTimes(1); // still resolves to compute fix
      expect(prCreator.createFixPR).not.toHaveBeenCalled(); // but does NOT create the PR
    });

    it('skips notifications for high severity when dry-run=true', async () => {
      const { aiResolver, prCreator, notifier } = makeCollaborators();

      await processAlert(
        makeClassified(9.0),
        aiResolver as unknown as AIResolver,
        prCreator as unknown as PRCreator,
        notifier as unknown as Notifier,
        true // dry-run
      );

      expect(notifier.notify).not.toHaveBeenCalled();
    });
  });

  describe('error propagation', () => {
    it('rethrows errors from the AI resolver', async () => {
      const { aiResolver, prCreator, notifier } = makeCollaborators();
      aiResolver.resolve.mockRejectedValue(new Error('Claude timeout'));

      await expect(
        processAlert(
          makeClassified(3.0),
          aiResolver as unknown as AIResolver,
          prCreator as unknown as PRCreator,
          notifier as unknown as Notifier,
          false
        )
      ).rejects.toThrow('Claude timeout');
    });
  });
});
