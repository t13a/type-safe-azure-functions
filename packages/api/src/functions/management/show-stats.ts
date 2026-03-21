import { defineHttp } from "../../lib/http-function.js";

export const showStats = defineHttp({
  handler: async () => {
    return {
      jsonBody: {
        totalUsers: 42,
        activeTodos: 7,
      },
    } as const;
  },
});
