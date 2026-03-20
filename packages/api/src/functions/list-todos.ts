import { defineHttp } from "../lib/http.js";

export const listTodos = defineHttp({
  handler: async () => {
    return {
      jsonBody: [
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
      ]
    };
  },
});
