import { Hono } from "hono";
import { cors } from "hono/cors";
import { v2Routes } from "./v2/routes";

type Bindings = {
  DB: D1Database;
  COGNITO_USER_POOL_ID?: string;
  COGNITO_CLIENT_ID?: string;
  AWS_REGION?: string;
};

const app = new Hono<{ Bindings: Bindings }>()

app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}))

app.route("/v2", v2Routes)

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default app
