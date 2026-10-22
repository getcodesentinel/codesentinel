import { PR_COMMENT_MARKER } from "./format-pr-comment.js";

export type PrCommentMode = "change" | "always" | "never";
export type PrCommentAction = "created" | "updated" | "skipped";

export type GitHubIssueComment = { id: number; body: string };

export type PrCommentClient = {
  listComments: () => Promise<readonly GitHubIssueComment[]>;
  createComment: (body: string) => Promise<GitHubIssueComment>;
  updateComment: (commentId: number, body: string) => Promise<GitHubIssueComment>;
};

export type PublishPrCommentResult = {
  action: PrCommentAction;
  reason?: string;
  commentId?: number;
};

export const publishPrComment = async (
  client: PrCommentClient,
  body: string,
  mode: PrCommentMode,
): Promise<PublishPrCommentResult> => {
  if (mode === "never") {
    return { action: "skipped", reason: "comment-on never" };
  }

  const comments = await client.listComments();
  const existing = comments.find((comment) => comment.body.includes(PR_COMMENT_MARKER));

  if (existing === undefined) {
    const created = await client.createComment(body);
    return { action: "created", commentId: created.id };
  }

  if (mode === "change" && existing.body.trim() === body.trim()) {
    return { action: "skipped", reason: "no change" };
  }

  const updated = await client.updateComment(existing.id, body);
  return { action: "updated", commentId: updated.id };
};
