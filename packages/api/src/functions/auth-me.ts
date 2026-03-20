import { z } from "zod";
import { defaultErrorHandler, defineFunction } from "../lib/define-function";

type User = { name: string };

const usersByToken = new Map<string, User>().set("my-secret-token", { name: "John Doe"});

function unauthorizedErrorHandler() {
  return { status: 401 as const, jsonBody: { error: "Unauthorized" } };
}

export const authMe = defineFunction({
  parse: {
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/).transform((arg) => {
        return { token: arg.replace("Bearer ", "") };
      }),
    }),
  },
  handler: async (_request, context, { headers }) => {
    context.log(`Autenticating token: ${headers.authorization.token}`);

    const token = headers.authorization.token;
    const user = usersByToken.get(token);

    if (!user) {
      return unauthorizedErrorHandler();
    }

    return {
      status: 200 as const,
      jsonBody: user
    };
  },
  errorHandler: (request, context, error) => {
    if (!request.headers.has("authorizaton")) {
      return unauthorizedErrorHandler();
    }

    return defaultErrorHandler(request,context,error);
  },
});
