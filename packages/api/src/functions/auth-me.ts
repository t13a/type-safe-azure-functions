import { z } from "zod";
import { defineFunction } from "../lib/define-function";

type User = { name: string };

const usersByToken = new Map<string, User>().set("my-secret-token", { name: "John Doe"});

export const authMe = defineFunction({
  parse: {
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/).transform((arg) => {
        return { token: arg.replace("Bearer ", "") };
      }),
    }),
  },
  async handler(_request, context, { headers }) {
    context.log(`Autenticating token: ${headers.authorization.token}`);

    const token = headers.authorization.token;
    const user = usersByToken.get(token);

    if (!user) {
      return {
        status: 401 as const,
        jsonBody: {
          error: "Unauthorized"
        }
      }
    }

    return {
      status: 200 as const,
      jsonBody: user
    };
  },
});
