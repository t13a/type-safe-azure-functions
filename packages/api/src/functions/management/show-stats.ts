import { http, withCatchError } from "../../lib/http-function-v2/index.js";

export const showStats = http({
  handler: withCatchError(async () => {
    return {
      jsonBody: {
        totalUsers: 42,
        activeTodos: 7,
      },
    } as const;
  }),
});
