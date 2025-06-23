import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { world_histories, worlds_master, user_world_tags } from "./schema";
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

async function fetchVRChatWorldInfo(worldId: string): Promise<{
  world_name: string;
  world_description: string;
  world_author_name: string;
  world_thumbnail_image_url: string;
} | null> {
  try {
    const response = await fetch(`https://vrchat.com/home/world/${worldId}/info`, {
      headers: {
        'User-Agent': 'Client'
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch world info for ${worldId}: ${response.status} ${response.statusText}`);
      return null;
    }

    const html = await response.text();

    const worldNameMatch = html.match(/<meta name="twitter:title" content="([^"]+) by ([^"]+)"/);
    const descriptionMatch = html.match(/<meta name="twitter:description" content="([^"]+)"/);
    const imageMatch = html.match(/<meta name="twitter:image"\s+content="([^"]+)"/);

    // どれか1つでもマッチする場合は次の処理へ、全てマッチしない場合はnullを返す
    if (!worldNameMatch || !imageMatch) {
      console.error("Failed to parse world information from HTML");
      console.error("worldNameMatch:", worldNameMatch);
      console.error("descriptionMatch:", descriptionMatch);
      console.error("imageMatch:", imageMatch);
      return null;
    }

    // descriptionMatchしない場合は空文字列を設定
    const worldDescription = descriptionMatch ? descriptionMatch[1] : '';

    return {
      world_name: worldNameMatch[1],
      world_description: worldDescription,
      world_author_name: worldNameMatch[2],
      world_thumbnail_image_url: imageMatch[1]
    };
  } catch (error) {
    return null;
  }
}

app.post("/u/:user_id/w/tags", async (c) => {
  const userId = c.req.param("user_id");
  const params = await c.req.json();
  const { world_id, tag_name, created_at } = params;

  if (!world_id || !tag_name) {
    return c.json({ error: "world_id and tag_name are required" }, 400);
  }

  const db = drizzle(c.env.DB, { schema: { worlds_master, user_world_tags } });

  try {
    let worldExists = await db
      .select()
      .from(worlds_master)
      .where(eq(worlds_master.world_id, world_id))
      .execute();

    if (worldExists.length === 0) {
      const worldInfo = await fetchVRChatWorldInfo(world_id);

      if (!worldInfo) {
        return c.json({
          error: "World not found or could not fetch world information",
          world_id: world_id
        }, 404);
      }

      await db
        .insert(worlds_master)
        .values({
          world_id: world_id,
          world_name: worldInfo.world_name,
          world_description: worldInfo.world_description,
          world_author_name: worldInfo.world_author_name,
          world_thumbnail_image_url: worldInfo.world_thumbnail_image_url
        })
        .execute();
    }

    const tagExists = await db
      .select()
      .from(user_world_tags)
      .where(and(
        eq(user_world_tags.user_id, userId),
        eq(user_world_tags.world_id, world_id),
        eq(user_world_tags.tag_name, tag_name)
      ))
      .execute();

    if (tagExists.length > 0) {
      await db
        .update(user_world_tags)
        .set({
          updated_at: sql`(cast (unixepoch () as int))`
        })
        .where(and(
          eq(user_world_tags.user_id, userId),
          eq(user_world_tags.world_id, world_id),
          eq(user_world_tags.tag_name, tag_name)
        ))
        .execute();
    } else {
      if (created_at) {
        let timestampValue;
        if (typeof created_at === 'number') {
          timestampValue = created_at;
        } else if (typeof created_at === 'string') {
          timestampValue = Math.floor(new Date(created_at).getTime() / 1000);
        }

        await db
          .insert(user_world_tags)
          .values({
            user_id: userId,
            world_id: world_id,
            tag_name: tag_name,
            created_at: sql`${timestampValue}`,
            updated_at: sql`${timestampValue}`
          })
          .execute();
      } else {
        await db
          .insert(user_world_tags)
          .values({
            user_id: userId,
            world_id: world_id,
            tag_name: tag_name
          })
          .execute();
      }
    }

    return c.json({
      message: "Tag registered successfully",
      user_id: userId,
      world_id: world_id,
      tag_name: tag_name
    });

  } catch (error) {
    console.error("Error processing tag registration:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
})

export default app
