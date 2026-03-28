import { z } from "zod";
import { http, withCatchError } from "../lib/http-function-v2/index.js";

export const getTodos = http({
  parser: {
    query: z.object({
      completed: z.string().transform(s => s === "true").optional(),
    }),
  },
  handler: withCatchError(async (c) => {
    const todos = [
      {
        id: "cdc76033-77da-4f53-b59d-870ca1e6ba24",
        title: "Wake early",
        completed: true,
      },
      {
        id: "c6f6c030-899c-4f2e-9b05-e344b62edea9",
        title: "Sleep early",
        completed: false,
      },
    ];

    const { completed } = c.parsed.query;
    return {
      jsonBody: completed === undefined ? todos : todos.filter(t => t.completed === completed),
    };
  }),
});
