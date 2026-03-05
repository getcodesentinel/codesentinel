import { describe, expect, it } from "vitest";
import { countTodoFixmeInComments } from "./todo-fixme-counter.js";

describe("countTodoFixmeInComments", () => {
  it("counts markers in line comments", () => {
    const input = `
      // TODO: clean this up
      const x = 1; // FIXME later
      const y = "TODO in string should not count";
    `;

    expect(countTodoFixmeInComments(input)).toBe(2);
  });

  it("counts markers in block comments", () => {
    const input = `
      /*
       * TODO item one
       * FIXME item two
       */
      const x = 1;
    `;

    expect(countTodoFixmeInComments(input)).toBe(2);
  });

  it("ignores markers outside comments", () => {
    const input = `
      const regex = /TODO|FIXME/gi;
      const message = "Found TODO/FIXME marker(s)";
      function TODO() {}
    `;

    expect(countTodoFixmeInComments(input)).toBe(0);
  });

  it("ignores comment-like markers embedded inside string literals", () => {
    const input = `
      const line = "// TODO this is data, not a comment";
      const block = "/* FIXME this is also data */";
      // TODO real one
    `;

    expect(countTodoFixmeInComments(input)).toBe(1);
  });
});
