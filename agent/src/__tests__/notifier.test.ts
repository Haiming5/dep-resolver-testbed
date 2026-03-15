import { Notifier } from '../notifier';
import type { GitHubClient } from '../github-client';
import { makeClassified } from './fixtures';

jest.mock('@actions/core', () => ({ info: jest.fn(), warning: jest.fn() }));

function makeGithubMock(): jest.Mocked<Pick<GitHubClient, 'createIssue'>> {
  return {
    createIssue: jest.fn().mockResolvedValue({ number: 10, html_url: 'https://github.com/test/test/issues/10' }),
  };
}

describe('Notifier', () => {
  let github: ReturnType<typeof makeGithubMock>;

  beforeEach(() => {
    github = makeGithubMock();
    global.fetch = jest.fn();
  });

  describe('github-issue channel', () => {
    it('creates a GitHub issue with the alert details', async () => {
      const notifier = new Notifier(github as unknown as GitHubClient, ['github-issue']);
      await notifier.notify(makeClassified(8.0));

      expect(github.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('lodash'),
          labels: expect.arrayContaining(['high-severity', 'needs-triage']),
        })
      );
    });

    it('includes the CVSS score in the issue title', async () => {
      const notifier = new Notifier(github as unknown as GitHubClient, ['github-issue']);
      await notifier.notify(makeClassified(9.1));

      const { title } = github.createIssue.mock.calls[0][0] as { title: string };
      expect(title).toContain('9.1');
    });
  });

  describe('slack channel', () => {
    it('throws when no webhook URL is configured', async () => {
      const notifier = new Notifier(github as unknown as GitHubClient, ['slack']);
      // Promise.allSettled catches the error — verify it's logged as a warning
      const core = require('@actions/core');
      await notifier.notify(makeClassified(8.0));
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Slack webhook URL is not configured'));
    });

    it('posts a Block Kit message to the webhook URL', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

      const notifier = new Notifier(
        github as unknown as GitHubClient,
        ['slack'],
        'https://hooks.slack.com/test'
      );
      await notifier.notify(makeClassified(8.0));

      expect(global.fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('warns when the Slack webhook returns a non-ok status', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 400 });
      const core = require('@actions/core');

      const notifier = new Notifier(
        github as unknown as GitHubClient,
        ['slack'],
        'https://hooks.slack.com/test'
      );
      await notifier.notify(makeClassified(8.0));

      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('slack'));
    });
  });

  describe('console channel', () => {
    it('does not throw', async () => {
      const notifier = new Notifier(github as unknown as GitHubClient, ['console']);
      await expect(notifier.notify(makeClassified(8.0))).resolves.toBeUndefined();
    });
  });

  describe('multi-channel resilience', () => {
    it('sends to all channels even when one fails', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('network error'));

      const notifier = new Notifier(
        github as unknown as GitHubClient,
        ['github-issue', 'slack'],
        'https://hooks.slack.com/test'
      );
      // Should not throw — Promise.allSettled absorbs failures
      await expect(notifier.notify(makeClassified(8.0))).resolves.toBeUndefined();
      // github-issue still called despite slack failing
      expect(github.createIssue).toHaveBeenCalled();
    });
  });
});
