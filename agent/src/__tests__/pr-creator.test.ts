import { PRCreator } from '../pr-creator';
import type { GitHubClient } from '../github-client';
import { makeClassified, SAMPLE_FIX } from './fixtures';

jest.mock('@actions/core', () => ({ info: jest.fn(), warning: jest.fn() }));

function makeGithubMock(): jest.Mocked<Pick<GitHubClient, 'getBranchSha' | 'createBranch' | 'commitFiles' | 'createPullRequest'>> {
  return {
    getBranchSha: jest.fn().mockResolvedValue('abc123sha'),
    createBranch: jest.fn().mockResolvedValue(undefined),
    commitFiles: jest.fn().mockResolvedValue(undefined),
    createPullRequest: jest.fn().mockResolvedValue({ number: 42, html_url: 'https://github.com/test/test/pull/42' }),
  };
}

describe('PRCreator', () => {
  let github: ReturnType<typeof makeGithubMock>;
  let creator: PRCreator;

  beforeEach(() => {
    github = makeGithubMock();
    creator = new PRCreator(github as unknown as GitHubClient, 'main');
  });

  describe('createFixPR()', () => {
    it('creates a branch from the base SHA', async () => {
      await creator.createFixPR(makeClassified(3.0), SAMPLE_FIX);

      expect(github.getBranchSha).toHaveBeenCalledWith('main');
      expect(github.createBranch).toHaveBeenCalledWith(
        expect.stringContaining('dep-resolver/alert-1'),
        'abc123sha'
      );
    });

    it('commits the patches to the new branch', async () => {
      await creator.createFixPR(makeClassified(3.0), SAMPLE_FIX);

      expect(github.commitFiles).toHaveBeenCalledWith(
        expect.stringContaining('dep-resolver/alert-1'),
        SAMPLE_FIX.patches,
        expect.stringContaining('lodash')
      );
    });

    it('opens a PR and returns its metadata', async () => {
      const result = await creator.createFixPR(makeClassified(3.0), SAMPLE_FIX);

      expect(github.createPullRequest).toHaveBeenCalledWith(
        expect.objectContaining({ base: 'main', head: expect.stringContaining('dep-resolver/alert-1') })
      );
      expect(result.number).toBe(42);
      expect(result.html_url).toBe('https://github.com/test/test/pull/42');
    });
  });

  describe('branch naming', () => {
    it('sanitizes scoped npm package names (@ and /)', async () => {
      const classified = makeClassified(3.0);
      classified.alert.dependency.package.name = '@scope/package-name';

      await creator.createFixPR(classified, SAMPLE_FIX);

      const branchArg = (github.createBranch.mock.calls[0] as string[])[0];
      // Only check the package-name portion (after the fixed prefix)
      const packagePart = branchArg.replace(/^dep-resolver\/alert-\d+-/, '');
      expect(packagePart).not.toContain('@');
      expect(packagePart).not.toContain('/');
      expect(branchArg).toMatch(/^dep-resolver\/alert-\d+-/);
    });

    it('collapses multiple consecutive hyphens', async () => {
      const classified = makeClassified(3.0);
      classified.alert.dependency.package.name = 'some---package';

      await creator.createFixPR(classified, SAMPLE_FIX);

      const branchArg = (github.createBranch.mock.calls[0] as string[])[0];
      expect(branchArg).not.toContain('---');
    });
  });

  describe('PR title', () => {
    it('uses 🟢 badge for low severity', async () => {
      const result = await creator.createFixPR(makeClassified(2.0), SAMPLE_FIX);
      expect(result.title).toContain('🟢');
    });

    it('uses 🟡 badge for medium severity', async () => {
      const result = await creator.createFixPR(makeClassified(5.0), SAMPLE_FIX);
      expect(result.title).toContain('🟡');
    });

    it('includes the target version', async () => {
      const result = await creator.createFixPR(makeClassified(3.0), SAMPLE_FIX);
      expect(result.title).toContain(SAMPLE_FIX.targetVersion);
    });
  });

  describe('PR labels', () => {
    it('always includes dep-resolver, security, automated', async () => {
      await creator.createFixPR(makeClassified(3.0), SAMPLE_FIX);

      const { labels } = (github.createPullRequest.mock.calls[0] as Array<{ labels: string[] }>)[0];
      expect(labels).toEqual(expect.arrayContaining(['dep-resolver', 'security', 'automated']));
    });

    it('adds low-severity label for low alerts', async () => {
      await creator.createFixPR(makeClassified(2.0), SAMPLE_FIX);

      const { labels } = (github.createPullRequest.mock.calls[0] as Array<{ labels: string[] }>)[0];
      expect(labels).toContain('low-severity');
    });

    it('adds medium-severity label for medium alerts', async () => {
      await creator.createFixPR(makeClassified(5.0), SAMPLE_FIX);

      const { labels } = (github.createPullRequest.mock.calls[0] as Array<{ labels: string[] }>)[0];
      expect(labels).toContain('medium-severity');
    });
  });
});
