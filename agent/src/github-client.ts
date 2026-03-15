/**
 * Shared GitHub API client wrapper using Octokit.
 *
 * Provides typed helpers for the specific GitHub REST endpoints we need:
 *   - Dependabot alerts
 *   - Repository content (read files)
 *   - Git references, trees, commits (create branches & commits)
 *   - Pull requests
 *   - Issues (for notification)
 */

import { Octokit } from "@octokit/rest";
import type { DependabotAlert } from "./types";

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token: string, owner: string, repo: string) {
    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
  }

  // -----------------------------------------------------------------------
  // Dependabot alerts
  // -----------------------------------------------------------------------

  async getAlert(alertNumber: number): Promise<DependabotAlert> {
    const { data } = await this.octokit.request(
      "GET /repos/{owner}/{repo}/dependabot/alerts/{alert_number}",
      {
        owner: this.owner,
        repo: this.repo,
        alert_number: alertNumber,
      }
    );
    return data as unknown as DependabotAlert;
  }

  async listOpenAlerts(): Promise<DependabotAlert[]> {
    const { data } = await this.octokit.request(
      "GET /repos/{owner}/{repo}/dependabot/alerts",
      {
        owner: this.owner,
        repo: this.repo,
        state: "open",
        per_page: 100,
      }
    );
    return data as unknown as DependabotAlert[];
  }

  // -----------------------------------------------------------------------
  // Repository content
  // -----------------------------------------------------------------------

  async getFileContent(path: string, ref?: string): Promise<string> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref,
      });

      if ("content" in data && data.content) {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }

      throw new Error(`Path "${path}" is not a file or has no content.`);
    } catch (err: any) {
      if (err.status === 404) {
        throw new Error(`File not found: ${path}`);
      }
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Git operations: create branch → commit files → open PR
  // -----------------------------------------------------------------------

  /** Get the SHA of a branch head (defaults to the repo default branch). */
  async getBranchSha(branch?: string): Promise<string> {
    const ref = branch ?? (await this.getDefaultBranch());
    const { data } = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${ref}`,
    });
    return data.object.sha;
  }

  /** Get the repo's default branch name. */
  async getDefaultBranch(): Promise<string> {
    const { data } = await this.octokit.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    return data.default_branch;
  }

  /** Create a new branch from a given SHA. */
  async createBranch(branchName: string, sha: string): Promise<void> {
    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${branchName}`,
      sha,
    });
  }

  /**
   * Create a commit that writes one or more files and push it to a branch.
   *
   * This uses the low-level Git Data API so we don't need a local checkout:
   *   1. Create blobs for each file
   *   2. Build a new tree referencing those blobs
   *   3. Create a commit pointing to that tree
   *   4. Update the branch ref
   */
  async commitFiles(
    branchName: string,
    files: Array<{ path: string; content: string }>,
    message: string
  ): Promise<string> {
    // Get the current commit on this branch
    const branchSha = await this.getBranchSha(branchName);

    const { data: baseCommit } = await this.octokit.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: branchSha,
    });

    // Create blobs
    const blobResults = await Promise.all(
      files.map((f) =>
        this.octokit.git.createBlob({
          owner: this.owner,
          repo: this.repo,
          content: Buffer.from(f.content).toString("base64"),
          encoding: "base64",
        })
      )
    );

    // Build tree
    const tree = files.map((f, i) => ({
      path: f.path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: blobResults[i].data.sha,
    }));

    const { data: newTree } = await this.octokit.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: baseCommit.tree.sha,
      tree,
    });

    // Create commit
    const { data: newCommit } = await this.octokit.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message,
      tree: newTree.sha,
      parents: [branchSha],
    });

    // Update branch ref
    await this.octokit.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branchName}`,
      sha: newCommit.sha,
    });

    return newCommit.sha;
  }

  // -----------------------------------------------------------------------
  // Pull requests
  // -----------------------------------------------------------------------

  async createPullRequest(params: {
    title: string;
    body: string;
    head: string;
    base: string;
    labels?: string[];
  }): Promise<{ number: number; html_url: string }> {
    const { data: pr } = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
    });

    if (params.labels?.length) {
      await this.octokit.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: pr.number,
        labels: params.labels,
      });
    }

    return { number: pr.number, html_url: pr.html_url };
  }

  // -----------------------------------------------------------------------
  // Issues (used for high-severity notifications)
  // -----------------------------------------------------------------------

  async createIssue(params: {
    title: string;
    body: string;
    labels?: string[];
  }): Promise<{ number: number; html_url: string }> {
    const { data: issue } = await this.octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: params.title,
      body: params.body,
      labels: params.labels,
    });

    return { number: issue.number, html_url: issue.html_url };
  }
}
