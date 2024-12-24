import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { world_histories } from "./schema";
import { and, eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

type Bindings = {
  DB: D1Database;
};

interface VRCLogWatcher {
  Value: string;
  Title: string;
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})
app.get("/u/:user_id/w/histories", async (c) => {
  const id = c.req.param("user_id");
  const db = drizzle(c.env.DB, { schema: { ...world_histories } });
  const result = await db
    .select()
    .from(world_histories)
    .where(and(eq(world_histories.registered_user_id, id), eq(world_histories.is_deleted, 0)))
    .orderBy(desc(world_histories.id))
    .all()
  return c.json(result);
})

/**
 * create todo
 */
app.post("/u/:user_id/w/histories", async (c) => {
  const id = c.req.param("user_id");
  const params = await c.req.json()
  const wid = params.message;
  const db = drizzle(c.env.DB, { schema: { ...world_histories } });
  // UNIQUE条件で検索
  const exists = await db
    .select()
    .from(world_histories)
    .where(and(eq(world_histories.world_id, wid), eq(world_histories.registered_user_id, id)))
    .execute()
  if (exists.length > 0) {
    const result = await db
      .update(world_histories)
      .set(
        {
          updated_at: sql`(cast (unixepoch () as int))`,
        }
      )
      .where(and(eq(world_histories.world_id, wid), eq(world_histories.registered_user_id, id)))
      .execute()
  } else {
    const result = await db
      .insert(world_histories)
      .values({
        world_id: wid,
        registered_user_id: id,
      })
      .execute()
  }
  return c.json({ message: "success" });
})

export default app
