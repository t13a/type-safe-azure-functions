import { defineHttp } from "../lib/http.js";

type User = { name: string };

const usersByToken = new Map<string, User>().set("my-secret-token", { name: "John Doe"});

export const authMe = defineHttp({
  handler: async (request, context) => {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return { status: 401, jsonBody: { message: "Unauthorized" } } as const;
    }

    const token = authHeader.replace("Bearer ", "");
    context.log(`Authenticating token: ${token}`);
    const user = usersByToken.get(token);

    if (!user) {
      return { status: 401, jsonBody: { message: "Unauthorized" } } as const;
    }

    return { status: 200, jsonBody: user } as const;
  },
});
