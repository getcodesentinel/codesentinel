import { describe, expect, it, vi } from "vitest";
import { PR_COMMENT_MARKER } from "./format-pr-comment.js";
import {
  publishPrComment,
  type GitHubIssueComment,
  type PrCommentClient,
} from "./publish-pr-comment.js";

const createClient = (comments: readonly GitHubIssueComment[] = []) => {
  const listComments = vi.fn<PrCommentClient["listComments"]>(() => Promise.resolve(comments));
  const createComment = vi.fn<PrCommentClient["createComment"]>((body) =>
    Promise.resolve({ id: 900, body }),
  );
  const updateComment = vi.fn<PrCommentClient["updateComment"]>((commentId, body) =>
    Promise.resolve({ id: commentId, body }),
  );

  const client: PrCommentClient = { listComments, createComment, updateComment };
  return { client, listComments, createComment, updateComment };
};

describe("publishPrComment", () => {
  it("does nothing when the mode is never", async () => {
    const { client, listComments, createComment, updateComment } = createClient([
      { id: 1, body: PR_COMMENT_MARKER },
    ]);

    const result = await publishPrComment(client, "body", "never");

    expect(result).toEqual({ action: "skipped", reason: "comment-on never" });
    expect(listComments).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("creates the comment when no marker comment exists", async () => {
    const { client, listComments, createComment, updateComment } = createClient();

    const result = await publishPrComment(client, "body", "always");

    expect(result).toEqual({ action: "created", commentId: 900 });
    expect(listComments).toHaveBeenCalledTimes(1);
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment).toHaveBeenCalledWith("body");
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("updates the existing marker comment in always mode", async () => {
    const { client, createComment, updateComment } = createClient([
      { id: 42, body: `${PR_COMMENT_MARKER}\nold` },
    ]);

    const result = await publishPrComment(client, "new body", "always");

    expect(result).toEqual({ action: "updated", commentId: 42 });
    expect(updateComment).toHaveBeenCalledWith(42, "new body");
    expect(createComment).not.toHaveBeenCalled();
  });

  it("skips in change mode when the existing body is identical", async () => {
    const { client, createComment, updateComment } = createClient([
      { id: 42, body: `${PR_COMMENT_MARKER}\nsame\n` },
    ]);

    const result = await publishPrComment(client, `${PR_COMMENT_MARKER}\nsame`, "change");

    expect(result).toEqual({ action: "skipped", reason: "no change" });
    expect(createComment).not.toHaveBeenCalled();
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("updates in change mode when the body moved", async () => {
    const { client, createComment, updateComment } = createClient([
      { id: 42, body: `${PR_COMMENT_MARKER}\nold` },
    ]);

    const result = await publishPrComment(client, `${PR_COMMENT_MARKER}\nnew`, "change");

    expect(result).toEqual({ action: "updated", commentId: 42 });
    expect(updateComment).toHaveBeenCalledWith(42, `${PR_COMMENT_MARKER}\nnew`);
    expect(createComment).not.toHaveBeenCalled();
  });

  it("creates in change mode when no marker comment exists", async () => {
    const { client, createComment, updateComment } = createClient([
      { id: 1, body: "unrelated discussion" },
    ]);

    const result = await publishPrComment(client, "body", "change");

    expect(result).toEqual({ action: "created", commentId: 900 });
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("ignores non-marker comments and never updates them", async () => {
    const { client, updateComment } = createClient([
      { id: 1, body: "first unrelated comment" },
      { id: 2, body: `${PR_COMMENT_MARKER}\nold` },
    ]);

    const result = await publishPrComment(client, "new", "change");

    expect(result).toEqual({ action: "updated", commentId: 2 });
    expect(updateComment).toHaveBeenCalledTimes(1);
    expect(updateComment).toHaveBeenCalledWith(2, "new");
  });
});
