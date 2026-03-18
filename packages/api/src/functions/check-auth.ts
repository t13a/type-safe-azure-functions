import { z } from "zod";
import { defineFunction } from "../lib/define-function";

export const checkAuth = defineFunction({
  parse: {
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/),
    }),
  },
  async handler(_request, _context, parsed) {
    const token = parsed.headers.authorization.replace("Bearer ", "");
    return {
      jsonBody: {
        authenticated: true,
        token,
      },
    };
  },
});
