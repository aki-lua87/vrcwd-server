import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { world_histories, worlds_master, user_world_tags } from "./schema";
import { and, eq, desc, or, inArray } from "drizzle-orm";
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

app.get("/u/:user_id/w/tags", async (c) => {
  const userId = c.req.param("user_id");
  const tags = c.req.query("tags");
  const mode = c.req.query("mode") || "or";
  const offset = c.req.query("offset");
  const pageSize = 20;
  
  const db = drizzle(c.env.DB, { schema: { user_world_tags, worlds_master } });
  
  try {
    let baseQuery = db
      .select({
        world_id: user_world_tags.world_id,
        world_name: worlds_master.world_name,
        world_description: worlds_master.world_description,
        world_author_name: worlds_master.world_author_name,
        world_thumbnail_image_url: worlds_master.world_thumbnail_image_url,
        tags: sql<string[]>`json_group_array(${user_world_tags.tag_name})`.as('tags'),
        created_at: sql<number>`MIN(${user_world_tags.created_at})`.as('created_at'),
        updated_at: sql<number>`MIN(${user_world_tags.updated_at})`.as('updated_at')
      })
      .from(user_world_tags)
      .leftJoin(worlds_master, eq(user_world_tags.world_id, worlds_master.world_id))
      .where(eq(user_world_tags.user_id, userId))
      .groupBy(user_world_tags.world_id)
      .orderBy(desc(sql`MIN(${user_world_tags.created_at})`));

    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      
      if (tagArray.length > 0) {
        if (mode === "and") {
          const tagConditions = tagArray.map(tag => 
            sql`EXISTS (
              SELECT 1 FROM ${user_world_tags} uwt2 
              WHERE uwt2.world_id = ${user_world_tags.world_id} 
              AND uwt2.user_id = ${userId} 
              AND uwt2.tag_name = ${tag}
            )`
          );
          
          baseQuery = db
            .select({
              world_id: user_world_tags.world_id,
              world_name: worlds_master.world_name,
              world_description: worlds_master.world_description,
              world_author_name: worlds_master.world_author_name,
              world_thumbnail_image_url: worlds_master.world_thumbnail_image_url,
              tags: sql<string[]>`json_group_array(${user_world_tags.tag_name})`.as('tags'),
              created_at: sql<number>`MIN(${user_world_tags.created_at})`.as('created_at'),
              updated_at: sql<number>`MIN(${user_world_tags.updated_at})`.as('updated_at')
            })
            .from(user_world_tags)
            .leftJoin(worlds_master, eq(user_world_tags.world_id, worlds_master.world_id))
            .where(and(
              eq(user_world_tags.user_id, userId),
              ...tagConditions
            ))
            .groupBy(user_world_tags.world_id)
            .orderBy(desc(sql`MIN(${user_world_tags.created_at})`));
        } else {
          baseQuery = db
            .select({
              world_id: user_world_tags.world_id,
              world_name: worlds_master.world_name,
              world_description: worlds_master.world_description,
              world_author_name: worlds_master.world_author_name,
              world_thumbnail_image_url: worlds_master.world_thumbnail_image_url,
              tags: sql<string[]>`json_group_array(${user_world_tags.tag_name})`.as('tags'),
              created_at: sql<number>`MIN(${user_world_tags.created_at})`.as('created_at'),
              updated_at: sql<number>`MIN(${user_world_tags.updated_at})`.as('updated_at')
            })
            .from(user_world_tags)
            .leftJoin(worlds_master, eq(user_world_tags.world_id, worlds_master.world_id))
            .where(and(
              eq(user_world_tags.user_id, userId),
              inArray(user_world_tags.tag_name, tagArray)
            ))
            .groupBy(user_world_tags.world_id)
            .orderBy(desc(sql`MIN(${user_world_tags.created_at})`));
        }
      }
    }

    if (offset === "all") {
      // 全件取得の場合はlimitとoffsetを適用しない
    } else {
      const offsetNum = offset ? parseInt(offset, 10) : 0;
      if (!isNaN(offsetNum) && offsetNum >= 0) {
        baseQuery = (baseQuery as any).limit(pageSize).offset(offsetNum);
      } else {
        baseQuery = (baseQuery as any).limit(pageSize);
      }
    }

    const result = await baseQuery.execute();
    
    const formattedResult = result.map(row => ({
      ...row,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
      created_at: new Date(row.created_at * 1000).toISOString(),
      updated_at: new Date(row.updated_at * 1000).toISOString()
    }));

    return c.json(formattedResult);
  } catch (error) {
    console.error("Error fetching user world tags:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
})

app.get("/u/:user_id/w/tags/count", async (c) => {
  const userId = c.req.param("user_id");
  const tags = c.req.query("tags");
  const mode = c.req.query("mode") || "or";
  
  const db = drizzle(c.env.DB, { schema: { user_world_tags, worlds_master } });
  
  try {
    let countQuery;

    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      
      if (tagArray.length > 0) {
        if (mode === "and") {
          countQuery = db
            .select({
              count: sql<number>`COUNT(DISTINCT world_id)`.as('count')
            })
            .from(sql`(
              SELECT DISTINCT world_id
              FROM ${user_world_tags}
              WHERE user_id = ${userId}
              GROUP BY world_id
              HAVING ${sql.join(
                tagArray.map(tag => 
                  sql`SUM(CASE WHEN tag_name = ${tag} THEN 1 ELSE 0 END) > 0`
                ),
                sql` AND `
              )}
            ) as filtered_worlds`);
        } else {
          countQuery = db
            .select({
              count: sql<number>`COUNT(DISTINCT ${user_world_tags.world_id})`.as('count')
            })
            .from(user_world_tags)
            .where(and(
              eq(user_world_tags.user_id, userId),
              inArray(user_world_tags.tag_name, tagArray)
            ));
        }
      } else {
        countQuery = db
          .select({
            count: sql<number>`COUNT(DISTINCT ${user_world_tags.world_id})`.as('count')
          })
          .from(user_world_tags)
          .where(eq(user_world_tags.user_id, userId));
      }
    } else {
      countQuery = db
        .select({
          count: sql<number>`COUNT(DISTINCT ${user_world_tags.world_id})`.as('count')
        })
        .from(user_world_tags)
        .where(eq(user_world_tags.user_id, userId));
    }

    const result = await countQuery.execute();
    const totalCount = result[0]?.count || 0;

    return c.json({
      total_count: totalCount,
      page_size: 20,
      total_pages: Math.ceil(totalCount / 20)
    });
  } catch (error) {
    console.error("Error fetching user world tags count:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
})

export default app
