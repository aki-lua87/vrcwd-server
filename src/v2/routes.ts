import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/d1";
import { worlds_master, user_folders, user_folder_items, api_keys, users, user_folder_favorites, user_folder_orders } from "../schema";
import { and, eq, sql, asc, desc } from "drizzle-orm";
import { firebaseAuth, getAuthenticatedUser } from "../auth";
import { createDbWithRetry, withRetry } from "../db-utils";
import { decodeHtmlEntities } from "../utils";

type Bindings = {
  DB: D1Database;
};

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

    if (!worldNameMatch || !imageMatch) {
      console.error("Failed to parse world information from HTML");
      return null;
    }

    const worldDescription = descriptionMatch ? descriptionMatch[1] : '';

    return {
      world_name: decodeHtmlEntities(worldNameMatch[1]),
      world_description: decodeHtmlEntities(worldDescription),
      world_author_name: decodeHtmlEntities(worldNameMatch[2]),
      world_thumbnail_image_url: imageMatch[1]
    };
  } catch (error) {
    return null;
  }
}

// ワールド情報が30日以上古いかチェックし、必要に応じて更新する関数
async function ensureWorldInfoUpdated(db: any, world_id: string): Promise<void> {
  try {
    const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60; // 30日を秒で表現
    const currentTimestamp = Math.floor(Date.now() / 1000);

    const existingWorld = await db
      .select()
      .from(worlds_master)
      .where(eq(worlds_master.world_id, world_id))
      .execute();

    if (existingWorld.length > 0) {
      const world = existingWorld[0];
      const updatedAt = world.updated_at || world.created_at; // updated_atがnullの場合はcreated_atを使用

      // 30日以上古い場合のみ更新
      if (currentTimestamp - updatedAt >= THIRTY_DAYS_IN_SECONDS) {
        console.log(`World ${world_id} is older than 30 days, attempting to update...`);

        const worldInfo = await fetchVRChatWorldInfo(world_id);

        if (worldInfo) {
          await db
            .update(worlds_master)
            .set({
              world_name: worldInfo.world_name,
              world_description: worldInfo.world_description,
              world_author_name: worldInfo.world_author_name,
              world_thumbnail_image_url: worldInfo.world_thumbnail_image_url,
              updated_at: sql`(cast (unixepoch () as int))`
            })
            .where(eq(worlds_master.world_id, world_id))
            .execute();

          console.log(`Successfully updated world info for ${world_id}`);
        } else {
          console.warn(`Failed to fetch updated world info for ${world_id}, skipping update`);
        }
      }
    } else {
      // ワールドが存在しない場合は新規作成
      const worldInfo = await fetchVRChatWorldInfo(world_id);

      if (worldInfo) {
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

        console.log(`Successfully created new world info for ${world_id}`);
      } else {
        throw new Error(`Could not fetch world information for ${world_id}`);
      }
    }
  } catch (error) {
    console.error(`Error in ensureWorldInfoUpdated for ${world_id}:`, error);
    throw error;
  }
}

// folder_idを0埋め8桁の文字列から数値に変換するヘルパー関数
function parseFolderId(folderIdParam: string): number | null {
  // 8桁の数字かチェック
  if (!/^\d{8}$/.test(folderIdParam)) {
    return null;
  }
  return parseInt(folderIdParam, 10);
}

// 数値のfolder_idを0埋め8桁の文字列に変換するヘルパー関数
function formatFolderId(folderId: number): string {
  return folderId.toString().padStart(8, '0');
}

const v2Routes = new Hono<{ Bindings: Bindings }>();

// CORSミドルウェアを全てのルートに適用
v2Routes.use("*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
}));

// 認証不要なエンドポイントを除いて認証ミドルウェアを適用
// 注意: 認証不要エンドポイントを先に定義してから認証ミドルウェアを適用する必要がある

// 認証不要なエンドポイント: 
// - POST /worlds (ワールド追加)
// - GET /users/:user_id/folders/:folder_id/items (公開フォルダ閲覧)
// - PUT /worlds/:world_id (ワールド情報更新)
// - GET /folders/:folder_id/info (フォルダ情報取得)
// - POST /users/:user_id/folders/:folder_id/items (APIキー認証)

// 認証テスト用エンドポイント
v2Routes.get('/test-auth', (c) => {
  console.log('[TEST-AUTH] Authentication successful, handler reached');
  const user = getAuthenticatedUser(c);
  console.log('[TEST-AUTH] User info:', user);

  return c.json({
    message: 'Authentication test successful',
    user: user,
    timestamp: new Date().toISOString()
  });
})

// 1. ワールド追加API (POST)
v2Routes.post("/worlds", async (c) => {
  const { world_id } = await c.req.json();

  if (!world_id) {
    return c.json({ error: "world_id is required" }, 400);
  }

  const db = createDbWithRetry(c.env.DB, { worlds_master });

  try {
    const existingWorld = await db
      .select()
      .from(worlds_master)
      .where(eq(worlds_master.world_id, world_id))
      .execute();

    if (existingWorld.length > 0) {
      // 既存のワールドがある場合、30日以上古いかチェックして更新
      await ensureWorldInfoUpdated(db, world_id);
      return c.json({
        message: "World already exists and has been updated if necessary",
        world_id: world_id
      }, 200);
    }

    // 新しいワールドの場合
    await ensureWorldInfoUpdated(db, world_id);

    return c.json({
      message: "World added successfully",
      world_id: world_id
    }, 201);

  } catch (error) {
    console.error("Error adding world:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 2. フォルダ一覧取得API (GET)
v2Routes.get("/folders", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;

  const db = createDbWithRetry(c.env.DB, { user_folders, user_folder_orders });

  try {
    // フォルダ情報と順序情報を結合して取得
    const folders = await db
      .select({
        id: user_folders.id,
        folder_name: user_folders.folder_name,
        is_private: user_folders.is_private,
        comment: user_folders.comment,
        created_at: user_folders.created_at,
        updated_at: user_folders.updated_at,
        display_order: user_folder_orders.display_order
      })
      .from(user_folders)
      .leftJoin(user_folder_orders, and(
        eq(user_folders.id, user_folder_orders.folder_id),
        eq(user_folder_orders.user_id, user_id)
      ))
      .where(eq(user_folders.user_id, user_id))
      .orderBy(
        // display_orderがnullの場合は末尾に、それ以外は昇順
        sql`CASE WHEN ${user_folder_orders.display_order} IS NULL THEN 1 ELSE 0 END`,
        asc(user_folder_orders.display_order),
        asc(user_folders.created_at)
      )
      .execute();

    // display_orderフィールドをレスポンスから除外
    const result = folders.map((folder: any) => ({
      id: folder.id,
      folder_name: folder.folder_name,
      is_private: folder.is_private,
      comment: folder.comment,
      created_at: folder.created_at,
      updated_at: folder.updated_at
    }));

    return c.json(result);

  } catch (error) {
    console.error("Error fetching folders:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 3. フォルダ作成API (POST)
v2Routes.post("/folders", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;
  const { folder_name, is_private, comment } = await c.req.json();

  if (!folder_name) {
    return c.json({ error: "folder_name is required" }, 400);
  }

  const db = createDbWithRetry(c.env.DB, { user_folders });

  try {
    const existingFolder = await db
      .select()
      .from(user_folders)
      .where(and(
        eq(user_folders.user_id, user_id),
        eq(user_folders.folder_name, folder_name)
      ))
      .execute();

    if (existingFolder.length > 0) {
      return c.json({
        message: "Folder already exists",
        user_id: user_id,
        folder_name: folder_name,
        folder_id: formatFolderId(existingFolder[0].id)
      }, 200);
    }

    const result = await db
      .insert(user_folders)
      .values({
        user_id: user_id,
        folder_name: folder_name,
        is_private: is_private ?? 1,
        comment: comment
      })
      .execute();

    const newFolderId = result.meta.last_row_id;

    return c.json({
      message: "Folder created successfully",
      user_id: user_id,
      folder_name: folder_name,
      folder_id: formatFolderId(newFolderId)
    }, 201);

  } catch (error) {
    console.error("Error creating folder:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 4. フォルダ内アイテム追加API (POST)
v2Routes.post("/folders/:folder_id/items", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;
  const folder_id_param = c.req.param("folder_id");
  const folder_id = parseFolderId(folder_id_param);

  if (folder_id === null) {
    return c.json({ error: "Invalid folder_id format." }, 400);
  }
  const { world_id, comment, addition_at } = await c.req.json();

  if (!world_id) {
    return c.json({ error: "world_id is required" }, 400);
  }

  // addition_atの型チェック
  if (addition_at !== undefined && (typeof addition_at !== 'number' || addition_at < 0)) {
    return c.json({ error: "addition_at must be a positive number (Unix timestamp)" }, 400);
  }

  const db = createDbWithRetry(c.env.DB, { user_folders, user_folder_items, worlds_master });

  try {
    const folderExists = await db
      .select()
      .from(user_folders)
      .where(and(
        eq(user_folders.user_id, user_id),
        eq(user_folders.id, folder_id)
      ))
      .execute();

    if (folderExists.length === 0) {
      return c.json({ error: "Folder not found" }, 404);
    }

    const existingItem = await db
      .select()
      .from(user_folder_items)
      .where(and(
        eq(user_folder_items.user_id, user_id),
        eq(user_folder_items.folder_id, folder_id),
        eq(user_folder_items.world_id, world_id)
      ))
      .execute();

    if (existingItem.length > 0) {
      return c.json({
        message: "Item already exists in folder",
        user_id: user_id,
        folder_id: formatFolderId(folder_id),
        world_id: world_id,
        item_id: existingItem[0].id
      }, 200);
    }

    // ワールド情報の存在確認と必要に応じた更新
    try {
      await ensureWorldInfoUpdated(db, world_id);
    } catch (error) {
      return c.json({
        error: "World not found or could not fetch world information",
        world_id: world_id
      }, 404);
    }

    const insertValues: any = {
      user_id: user_id,
      folder_id: folder_id,
      world_id: world_id,
      comment: comment
    };

    if (addition_at !== undefined) {
      console.log(`Setting addition_at: ${addition_at} (type: ${typeof addition_at})`);
      // UnixタイムスタンプをDateオブジェクトに変換
      insertValues.addition_at = new Date(addition_at * 1000);
      console.log(`Converted to Date: ${insertValues.addition_at}`);
    }

    console.log('Insert values:', insertValues);

    const itemResult = await db
      .insert(user_folder_items)
      .values(insertValues)
      .execute();

    const newItemId = itemResult.meta.last_row_id;

    return c.json({
      message: "Item added to folder successfully",
      user_id: user_id,
      folder_id: formatFolderId(folder_id),
      world_id: world_id,
      item_id: newItemId
    }, 201);

  } catch (error) {
    console.error("Error adding item to folder:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      user_id,
      folder_id,
      world_id,
      comment,
      addition_at
    });
    return c.json({
      error: "Internal server error",
      details: undefined
    }, 500);
  }
});

// 認証は各エンドポイントで個別に設定

// 5. フォルダ内アイテム取得API (GET)
v2Routes.get("/folders/:folder_id/items", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;
  const folder_id_param = c.req.param("folder_id");
  const folder_id = parseFolderId(folder_id_param);

  if (folder_id === null) {
    return c.json({ error: "Invalid folder_id format." }, 400);
  }

  const db = createDbWithRetry(c.env.DB, { user_folder_items, worlds_master });

  try {
    const items = await db
      .select({
        id: user_folder_items.id,
        world_id: user_folder_items.world_id,
        world_name: worlds_master.world_name,
        world_description: worlds_master.world_description,
        world_author_name: worlds_master.world_author_name,
        world_thumbnail_image_url: worlds_master.world_thumbnail_image_url,
        comment: user_folder_items.comment,
        addition_at: user_folder_items.addition_at,
        created_at: user_folder_items.created_at,
        updated_at: user_folder_items.updated_at
      })
      .from(user_folder_items)
      .leftJoin(worlds_master, eq(user_folder_items.world_id, worlds_master.world_id))
      .where(and(
        eq(user_folder_items.user_id, user_id),
        eq(user_folder_items.folder_id, folder_id)
      ))
      .orderBy(user_folder_items.addition_at)
      .execute();

    return c.json(items);

  } catch (error) {
    console.error("Error fetching folder items:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 6a. フォルダ順序更新API (PUT) - 先に定義して競合を避ける
v2Routes.put("/folders/order", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;
  const { folder_orders } = await c.req.json();

  // folder_ordersの形式: [{ folder_id: number, display_order: number }, ...]
  if (!Array.isArray(folder_orders) || folder_orders.length === 0) {
    return c.json({ error: "folder_orders must be a non-empty array" }, 400);
  }

  const db = createDbWithRetry(c.env.DB, { user_folders, user_folder_orders });

  try {
    // ユーザーのフォルダ存在確認
    const userFolders = await db
      .select({ id: user_folders.id })
      .from(user_folders)
      .where(eq(user_folders.user_id, user_id))
      .execute();

    const userFolderIds = new Set(userFolders.map((f: any) => f.id));

    // リクエストされたフォルダIDがすべてユーザーのものか確認
    for (const order of folder_orders) {
      if (!userFolderIds.has(order.folder_id)) {
        return c.json({ error: `Folder ${order.folder_id} not found or not owned by user` }, 404);
      }
    }

    // 既存の順序データを削除
    await db
      .delete(user_folder_orders)
      .where(eq(user_folder_orders.user_id, user_id))
      .execute();

    // 新しい順序データを挿入
    const orderValues = folder_orders.map(order => ({
      user_id: user_id,
      folder_id: order.folder_id,
      display_order: order.display_order
    }));

    await db
      .insert(user_folder_orders)
      .values(orderValues)
      .execute();

    return c.json({
      message: "Folder order updated successfully",
      user_id: user_id,
      updated_count: folder_orders.length
    });

  } catch (error) {
    console.error("Error updating folder order:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 6. フォルダ更新API (PUT)
v2Routes.put("/folders/:folder_id", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;
  const folder_id_param = c.req.param("folder_id");
  const folder_id = parseFolderId(folder_id_param);

  if (folder_id === null) {
    return c.json({ error: "Invalid folder_id format." }, 400);
  }
  const { folder_name, is_private, comment } = await c.req.json();

  const db = createDbWithRetry(c.env.DB, { user_folders });

  try {
    const existingFolder = await db
      .select()
      .from(user_folders)
      .where(and(
        eq(user_folders.user_id, user_id),
        eq(user_folders.id, folder_id)
      ))
      .execute();

    if (existingFolder.length === 0) {
      return c.json({ error: "Folder not found" }, 404);
    }

    // folder_nameが指定されている場合、重複チェック
    if (folder_name && folder_name !== existingFolder[0].folder_name) {
      const duplicateFolder = await db
        .select()
        .from(user_folders)
        .where(and(
          eq(user_folders.user_id, user_id),
          eq(user_folders.folder_name, folder_name)
        ))
        .execute();

      if (duplicateFolder.length > 0) {
        return c.json({ error: "Folder name already exists" }, 409);
      }
    }

    const updateData: any = {
      updated_at: sql`(cast (unixepoch () as int))`
    };

    if (folder_name !== undefined) updateData.folder_name = folder_name;
    if (is_private !== undefined) updateData.is_private = is_private;
    if (comment !== undefined) updateData.comment = comment;

    await db
      .update(user_folders)
      .set(updateData)
      .where(and(
        eq(user_folders.user_id, user_id),
        eq(user_folders.id, folder_id)
      ))
      .execute();

    return c.json({
      message: "Folder updated successfully",
      user_id: user_id,
      folder_id: formatFolderId(folder_id)
    });

  } catch (error) {
    console.error("Error updating folder:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 7. フォルダ削除API (DELETE)
v2Routes.delete("/folders/:folder_id", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;
  const folder_id_param = c.req.param("folder_id");
  const folder_id = parseFolderId(folder_id_param);

  if (folder_id === null) {
    return c.json({ error: "Invalid folder_id format." }, 400);
  }

  const db = createDbWithRetry(c.env.DB, { user_folders, user_folder_items });

  try {
    const folderExists = await db
      .select()
      .from(user_folders)
      .where(and(
        eq(user_folders.user_id, user_id),
        eq(user_folders.id, folder_id)
      ))
      .execute();

    if (folderExists.length === 0) {
      return c.json({ error: "Folder not found" }, 404);
    }

    await db
      .delete(user_folder_items)
      .where(and(
        eq(user_folder_items.user_id, user_id),
        eq(user_folder_items.folder_id, folder_id)
      ))
      .execute();

    await db
      .delete(user_folders)
      .where(and(
        eq(user_folders.user_id, user_id),
        eq(user_folders.id, folder_id)
      ))
      .execute();

    return c.json({
      message: "Folder deleted successfully",
      user_id: user_id,
      folder_id: formatFolderId(folder_id)
    });

  } catch (error) {
    console.error("Error deleting folder:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 8. フォルダ内アイテム更新API (PUT)
v2Routes.put("/folders/:folder_id/items/:world_id", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;
  const folder_id_param = c.req.param("folder_id");
  const folder_id = parseFolderId(folder_id_param);
  const world_id = c.req.param("world_id");

  if (folder_id === null) {
    return c.json({ error: "Invalid folder_id format." }, 400);
  }
  const { comment } = await c.req.json();

  const db = createDbWithRetry(c.env.DB, { user_folder_items });

  try {
    const existingItem = await db
      .select()
      .from(user_folder_items)
      .where(and(
        eq(user_folder_items.user_id, user_id),
        eq(user_folder_items.folder_id, folder_id),
        eq(user_folder_items.world_id, world_id)
      ))
      .execute();

    if (existingItem.length === 0) {
      return c.json({ error: "Item not found in folder" }, 404);
    }

    const updateData: any = {
      updated_at: sql`(cast (unixepoch () as int))`
    };

    if (comment !== undefined) updateData.comment = comment;

    await db
      .update(user_folder_items)
      .set(updateData)
      .where(and(
        eq(user_folder_items.user_id, user_id),
        eq(user_folder_items.folder_id, folder_id),
        eq(user_folder_items.world_id, world_id)
      ))
      .execute();

    return c.json({
      message: "Item updated successfully",
      user_id: user_id,
      folder_id: formatFolderId(folder_id),
      world_id: world_id,
      item_id: existingItem[0].id
    });

  } catch (error) {
    console.error("Error updating item:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 9. フォルダ内アイテム削除API (DELETE)
v2Routes.delete("/folders/:folder_id/items/:world_id", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;
  const folder_id_param = c.req.param("folder_id");
  const folder_id = parseFolderId(folder_id_param);
  const world_id = c.req.param("world_id");

  if (folder_id === null) {
    return c.json({ error: "Invalid folder_id format." }, 400);
  }

  const db = createDbWithRetry(c.env.DB, { user_folder_items });

  try {
    const itemExists = await db
      .select()
      .from(user_folder_items)
      .where(and(
        eq(user_folder_items.user_id, user_id),
        eq(user_folder_items.folder_id, folder_id),
        eq(user_folder_items.world_id, world_id)
      ))
      .execute();

    if (itemExists.length === 0) {
      return c.json({ error: "Item not found in folder" }, 404);
    }

    await db
      .delete(user_folder_items)
      .where(and(
        eq(user_folder_items.user_id, user_id),
        eq(user_folder_items.folder_id, folder_id),
        eq(user_folder_items.world_id, world_id)
      ))
      .execute();

    return c.json({
      message: "Item deleted from folder successfully",
      user_id: user_id,
      folder_id: formatFolderId(folder_id),
      world_id: world_id
    });

  } catch (error) {
    console.error("Error deleting item from folder:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 10. ワールド情報更新要求API (PUT)
v2Routes.put("/worlds/:world_id", async (c) => {
  const world_id = c.req.param("world_id");

  const db = createDbWithRetry(c.env.DB, { worlds_master });

  try {
    const existingWorld = await db
      .select()
      .from(worlds_master)
      .where(eq(worlds_master.world_id, world_id))
      .execute();

    if (existingWorld.length === 0) {
      return c.json({ error: "World not found" }, 404);
    }

    const worldInfo = await fetchVRChatWorldInfo(world_id);

    if (!worldInfo) {
      return c.json({
        error: "Could not fetch world information",
        world_id: world_id
      }, 404);
    }

    await db
      .update(worlds_master)
      .set({
        world_name: worldInfo.world_name,
        world_description: worldInfo.world_description,
        world_author_name: worldInfo.world_author_name,
        world_thumbnail_image_url: worldInfo.world_thumbnail_image_url,
        updated_at: sql`(cast (unixepoch () as int))`
      })
      .where(eq(worlds_master.world_id, world_id))
      .execute();

    return c.json({
      message: "World information updated successfully",
      world_id: world_id
    });

  } catch (error) {
    console.error("Error updating world information:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 11. 認証不要フォルダ情報取得API (GET)
v2Routes.get("/folders/:folder_id/info", async (c) => {
  const folder_id_param = c.req.param("folder_id");
  const folder_id = parseFolderId(folder_id_param);

  if (folder_id === null) {
    return c.json({ error: "Invalid folder_id format." }, 400);
  }

  const db = createDbWithRetry(c.env.DB, { user_folders, user_folder_items, users });

  try {
    // フォルダ情報を取得（ユーザ名も含む）
    const folder = await db
      .select({
        id: user_folders.id,
        user_id: user_folders.user_id,
        user_name: users.user_name,
        folder_name: user_folders.folder_name,
        is_private: user_folders.is_private,
        comment: user_folders.comment,
        created_at: user_folders.created_at,
        updated_at: user_folders.updated_at
      })
      .from(user_folders)
      .leftJoin(users, eq(user_folders.user_id, users.user_id))
      .where(eq(user_folders.id, folder_id))
      .execute();

    if (folder.length === 0) {
      return c.json({ error: "Folder not found" }, 404);
    }

    const folderInfo = folder[0];

    // 非公開フォルダの場合は最小限の情報のみ返す
    if (folderInfo.is_private === 1) {
      return c.json({
        folder_id: formatFolderId(folderInfo.id),
        is_private: true
      });
    }

    // 公開フォルダの場合は詳細情報とワールド数を取得
    const worldCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(user_folder_items)
      .where(eq(user_folder_items.folder_id, folder_id))
      .execute();

    return c.json({
      folder_id: formatFolderId(folderInfo.id),
      user_id: folderInfo.user_id,
      user_name: folderInfo.user_name,
      folder_name: folderInfo.folder_name,
      is_private: false,
      comment: folderInfo.comment,
      world_count: worldCount[0]?.count || 0,
      created_at: folderInfo.created_at,
      updated_at: folderInfo.updated_at
    });

  } catch (error) {
    console.error("Error fetching folder info:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 11. フォルダの内容取得API(認証無し版)
v2Routes.get("/users/:user_id/folders/:folder_id/items", async (c) => {
  const user_id = c.req.param("user_id");
  const folder_id_param = c.req.param("folder_id");
  const folder_id = parseFolderId(folder_id_param);

  if (folder_id === null) {
    return c.json({ error: "Invalid folder_id format." }, 400);
  }

  const db = createDbWithRetry(c.env.DB, { user_folders, user_folder_items, worlds_master });

  try {
    // フォルダの存在確認とプライベート設定チェック
    const folder = await db
      .select()
      .from(user_folders)
      .where(and(
        eq(user_folders.user_id, user_id),
        eq(user_folders.id, folder_id)
      ))
      .execute();

    if (folder.length === 0) {
      return c.json({ error: "Folder not found" }, 404);
    }

    // プライベートフォルダの場合は403エラー
    if (folder[0].is_private === 1) {
      return c.json({ error: "Folder is private" }, 403);
    }

    // フォルダ内アイテム取得
    const items = await db
      .select({
        id: user_folder_items.id,
        world_id: user_folder_items.world_id,
        world_name: worlds_master.world_name,
        world_description: worlds_master.world_description,
        world_author_name: worlds_master.world_author_name,
        world_thumbnail_image_url: worlds_master.world_thumbnail_image_url,
        comment: user_folder_items.comment,
        addition_at: user_folder_items.addition_at,
        created_at: user_folder_items.created_at,
        updated_at: user_folder_items.updated_at
      })
      .from(user_folder_items)
      .leftJoin(worlds_master, eq(user_folder_items.world_id, worlds_master.world_id))
      .where(and(
        eq(user_folder_items.user_id, user_id),
        eq(user_folder_items.folder_id, folder_id)
      ))
      .orderBy(user_folder_items.addition_at)
      .execute();

    return c.json(items);

  } catch (error) {
    console.error("Error fetching folder items (public):", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 12. フォルダ内アイテム追加API(APIキー認証版)
v2Routes.post("/users/:user_id/folders/:folder_id/items", async (c) => {
  const user_id = c.req.param("user_id");
  const folder_id_param = c.req.param("folder_id");
  const folder_id = parseFolderId(folder_id_param);
  const api_key = c.req.query("api_key");
  const { world_id, comment, addition_at } = await c.req.json();

  if (folder_id === null) {
    return c.json({ error: "Invalid folder_id format." }, 400);
  }

  if (!api_key) {
    return c.json({ error: "API key is required" }, 401);
  }

  if (!world_id) {
    return c.json({ error: "world_id is required" }, 400);
  }

  // addition_atの型チェック
  if (addition_at !== undefined && (typeof addition_at !== 'number' || addition_at < 0)) {
    return c.json({ error: "addition_at must be a positive number (Unix timestamp)" }, 400);
  }

  const db = createDbWithRetry(c.env.DB, { api_keys, user_folders, user_folder_items, worlds_master });

  try {
    // APIキーの検証
    const apiKeyRecord = await db
      .select()
      .from(api_keys)
      .where(and(
        eq(api_keys.user_id, user_id),
        eq(api_keys.api_key, api_key),
        eq(api_keys.is_active, 1)
      ))
      .execute();

    if (apiKeyRecord.length === 0) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    // フォルダの存在確認
    const folderExists = await db
      .select()
      .from(user_folders)
      .where(and(
        eq(user_folders.user_id, user_id),
        eq(user_folders.id, folder_id)
      ))
      .execute();

    if (folderExists.length === 0) {
      return c.json({ error: "Folder not found" }, 404);
    }

    // 既存アイテムの確認
    const existingItem = await db
      .select()
      .from(user_folder_items)
      .where(and(
        eq(user_folder_items.user_id, user_id),
        eq(user_folder_items.folder_id, folder_id),
        eq(user_folder_items.world_id, world_id)
      ))
      .execute();

    if (existingItem.length > 0) {
      return c.json({
        message: "Item already exists in folder",
        user_id: user_id,
        folder_id: formatFolderId(folder_id),
        world_id: world_id,
        item_id: existingItem[0].id
      }, 200);
    }

    // ワールド情報の存在確認と必要に応じた更新
    try {
      await ensureWorldInfoUpdated(db, world_id);
    } catch (error) {
      return c.json({
        error: "World not found or could not fetch world information",
        world_id: world_id
      }, 404);
    }

    // アイテム追加
    const insertValues: any = {
      user_id: user_id,
      folder_id: folder_id,
      world_id: world_id,
      comment: comment
    };

    if (addition_at !== undefined) {
      console.log(`Setting addition_at (API key): ${addition_at} (type: ${typeof addition_at})`);
      // UnixタイムスタンプをDateオブジェクトに変換
      insertValues.addition_at = new Date(addition_at * 1000);
      console.log(`Converted to Date (API key): ${insertValues.addition_at}`);
    }

    console.log('Insert values (API key):', insertValues);

    const itemResult = await db
      .insert(user_folder_items)
      .values(insertValues)
      .execute();

    const newItemId = itemResult.meta.last_row_id;

    return c.json({
      message: "Item added to folder successfully",
      user_id: user_id,
      folder_id: formatFolderId(folder_id),
      world_id: world_id,
      item_id: newItemId
    }, 201);

  } catch (error) {
    console.error("Error adding item to folder (API key auth):", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      user_id,
      folder_id,
      world_id,
      comment,
      addition_at
    });
    return c.json({
      error: "Internal server error",
      details: undefined
    }, 500);
  }
});

// 13. APIキー取得API (GET)
v2Routes.get("/auth/api-keys", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;

  const db = createDbWithRetry(c.env.DB, { api_keys });

  try {
    const apiKeyRecord = await db
      .select({
        api_key: api_keys.api_key,
        created_at: api_keys.created_at,
        updated_at: api_keys.updated_at
      })
      .from(api_keys)
      .where(and(
        eq(api_keys.user_id, user_id),
        eq(api_keys.is_active, 1)
      ))
      .execute();

    if (apiKeyRecord.length === 0) {
      return c.json({
        message: "No active API key found for this user",
        has_api_key: false
      }, 404);
    }

    return c.json({
      message: "API key retrieved successfully",
      has_api_key: true,
      api_key: apiKeyRecord[0].api_key,
      created_at: apiKeyRecord[0].created_at,
      updated_at: apiKeyRecord[0].updated_at
    });

  } catch (error) {
    console.error("Error retrieving API key:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 14. APIキー作成API (POST)
v2Routes.post("/auth/api-keys", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;

  const db = createDbWithRetry(c.env.DB, { api_keys });

  try {
    const existingApiKey = await db
      .select()
      .from(api_keys)
      .where(and(
        eq(api_keys.user_id, user_id),
        eq(api_keys.is_active, 1)
      ))
      .execute();

    if (existingApiKey.length > 0) {
      return c.json({ error: "API key already exists for this user" }, 409);
    }

    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const apiKey = Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');

    await db
      .insert(api_keys)
      .values({
        user_id: user_id,
        api_key: apiKey,
        is_active: 1
      })
      .execute();

    return c.json({
      message: "API key created successfully",
      api_key: apiKey
    }, 201);

  } catch (error) {
    console.error("Error creating API key:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 15. APIキー削除API (DELETE)
v2Routes.delete("/auth/api-keys", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;

  const db = createDbWithRetry(c.env.DB, { api_keys });

  try {
    const existingApiKey = await db
      .select()
      .from(api_keys)
      .where(and(
        eq(api_keys.user_id, user_id),
        eq(api_keys.is_active, 1)
      ))
      .execute();

    if (existingApiKey.length === 0) {
      return c.json({ error: "No active API key found for this user" }, 404);
    }

    await db
      .delete(api_keys)
      .where(and(
        eq(api_keys.user_id, user_id),
        eq(api_keys.is_active, 1)
      ))
      .execute();

    return c.json({
      message: "API key deleted successfully"
    });

  } catch (error) {
    console.error("Error deleting API key:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 16. ユーザープロフィール取得API (GET)
v2Routes.get("/profile", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;

  const db = createDbWithRetry(c.env.DB, { users });

  try {
    const userProfile = await db
      .select({
        user_id: users.user_id,
        user_name: users.user_name
      })
      .from(users)
      .where(eq(users.user_id, user_id))
      .execute();

    if (userProfile.length === 0) {
      return c.json({ error: "User profile not found" }, 404);
    }

    return c.json(userProfile[0]);
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 17. ユーザープロフィール登録・更新API (POST)
v2Routes.post("/profile", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;
  const { user_name } = await c.req.json();

  if (!user_name) {
    return c.json({ error: "user_name is required" }, 400);
  }

  const db = createDbWithRetry(c.env.DB, { users });

  try {
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.user_id, user_id))
      .execute();

    if (existingUser.length > 0) {
      await db
        .update(users)
        .set({
          user_name: user_name,
          updated_at: sql`(cast (unixepoch () as int))`
        })
        .where(eq(users.user_id, user_id))
        .execute();
    } else {
      await db
        .insert(users)
        .values({
          user_id: user_id,
          user_name: user_name
        })
        .execute();
    }

    return c.json({
      message: "Profile updated successfully",
      user_id: user_id,
      user_name: user_name
    });
  } catch (error) {
    console.error("Error updating user profile:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 18. フォルダお気に入り追加API (POST)
v2Routes.post("/favorites", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;
  const { folder_id } = await c.req.json();

  if (!folder_id) {
    return c.json({ error: "folder_id is required" }, 400);
  }

  const db = createDbWithRetry(c.env.DB, { user_folder_favorites, user_folders });

  try {
    // フォルダが存在するかチェック
    const folder = await db
      .select()
      .from(user_folders)
      .where(eq(user_folders.id, folder_id))
      .execute();

    if (folder.length === 0) {
      return c.json({ error: "Folder not found" }, 404);
    }

    // 既にお気に入りに追加されているかチェック
    const existingFavorite = await db
      .select()
      .from(user_folder_favorites)
      .where(and(
        eq(user_folder_favorites.user_id, user_id),
        eq(user_folder_favorites.folder_id, folder_id)
      ))
      .execute();

    if (existingFavorite.length > 0) {
      return c.json({ error: "Already added to favorites" }, 400);
    }

    await db
      .insert(user_folder_favorites)
      .values({
        user_id: user_id,
        folder_id: folder_id
      })
      .execute();

    return c.json({
      message: "Folder added to favorites successfully",
      user_id: user_id,
      folder_id: folder_id
    });
  } catch (error) {
    console.error("Error adding folder to favorites:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 19. フォルダお気に入り削除API (DELETE)
v2Routes.delete("/favorites/:folder_id", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;
  const folderId = parseInt(c.req.param("folder_id"), 10);

  const db = createDbWithRetry(c.env.DB, { user_folder_favorites });

  try {
    const result = await db
      .delete(user_folder_favorites)
      .where(and(
        eq(user_folder_favorites.user_id, user_id),
        eq(user_folder_favorites.folder_id, folderId)
      ))
      .execute();

    return c.json({
      message: "Folder removed from favorites successfully",
      user_id: user_id,
      folder_id: folderId
    });
  } catch (error) {
    console.error("Error removing folder from favorites:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 20. お気に入りフォルダ取得API (GET)
v2Routes.get("/favorites", firebaseAuth(), async (c) => {
  const user = getAuthenticatedUser(c);
  const user_id = user.userId;
  const db = createDbWithRetry(c.env.DB, { user_folder_favorites, user_folders, users });

  try {
    const favorites = await db
      .select({
        folder_id: user_folders.id,
        folder_name: user_folders.folder_name,
        is_private: user_folders.is_private,
        comment: user_folders.comment,
        owner_user_id: user_folders.user_id,
        owner_user_name: users.user_name
      })
      .from(user_folder_favorites)
      .leftJoin(user_folders, eq(user_folder_favorites.folder_id, user_folders.id))
      .leftJoin(users, eq(user_folders.user_id, users.user_id))
      .where(eq(user_folder_favorites.user_id, user_id))
      .execute();

    // フォルダが存在しない場合は除外
    const existingFavorites = favorites.filter((favorite: any) => favorite.folder_id !== null);

    return c.json(existingFavorites);
  } catch (error) {
    console.error("Error fetching favorite folders:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 21. WPPLS API - フォルダとワールド情報を特殊な形式で取得 (GET)
v2Routes.get("/users/:user_id/items/wppls", async (c) => {
  const user_id = c.req.param("user_id");
  const sorttype = c.req.query("sorttype") || "addition_desc"; // デフォルトはaddition_at降順

  const db = createDbWithRetry(c.env.DB, { user_folders, user_folder_items, worlds_master, users, user_folder_orders });

  try {
    // ユーザが存在するかチェック
    const userExists = await db
      .select()
      .from(users)
      .where(eq(users.user_id, user_id))
      .execute();

    if (userExists.length === 0) {
      return c.json({ error: "User not found" }, 404);
    }
    // 公開フォルダとその中身を取得（順序情報も含む）
    const foldersWithItems = await db
      .select({
        folder_id: user_folders.id,
        folder_name: user_folders.folder_name,
        display_order: user_folder_orders.display_order,
        world_id: user_folder_items.world_id,
        world_name: worlds_master.world_name,
        world_description: worlds_master.world_description,
        addition_at: user_folder_items.addition_at
      })
      .from(user_folders)
      .leftJoin(user_folder_orders, and(
        eq(user_folders.id, user_folder_orders.folder_id),
        eq(user_folder_orders.user_id, user_id)
      ))
      .leftJoin(user_folder_items, eq(user_folders.id, user_folder_items.folder_id))
      .leftJoin(worlds_master, eq(user_folder_items.world_id, worlds_master.world_id))
      .where(and(
        eq(user_folders.user_id, user_id),
        eq(user_folders.is_private, 0) // 公開フォルダのみ
      ))
      .execute();

    // フォルダごとにワールドをグループ化（display_order情報も保持）
    interface WorldItem {
      ID: string;
      Name: string;
      Description: string;
      addition_at?: number;
    }

    interface FolderCategory {
      Category: string;
      Worlds: WorldItem[];
      display_order: number | null;
    }

    const folderMap = new Map<number, FolderCategory>();

    foldersWithItems.forEach((item: any) => {
      const folderId = item.folder_id;
      const folderName = item.folder_name;

      if (!folderMap.has(folderId)) {
        folderMap.set(folderId, {
          Category: folderName,
          Worlds: [],
          display_order: item.display_order
        });
      }

      // ワールド情報がある場合のみ追加
      if (item.world_id && item.world_name) {
        folderMap.get(folderId)!.Worlds.push({
          ID: item.world_id,
          Name: item.world_name,
          Description: item.world_description || "",
          addition_at: item.addition_at
        });
      }
    });

    // 各フォルダ内でワールドをソート
    const getSortFunction = (sorttype: string) => {
      switch (sorttype) {
        case "name_desc":
          return (a: WorldItem, b: WorldItem) => b.Name.localeCompare(a.Name);
        case "addition_asc":
          return (a: WorldItem, b: WorldItem) => {
            const aTime = a.addition_at ? new Date(a.addition_at).getTime() : 0;
            const bTime = b.addition_at ? new Date(b.addition_at).getTime() : 0;
            return aTime - bTime;
          };
        case "addition_desc":
          return (a: WorldItem, b: WorldItem) => {
            const aTime = a.addition_at ? new Date(a.addition_at).getTime() : 0;
            const bTime = b.addition_at ? new Date(b.addition_at).getTime() : 0;
            return bTime - aTime;
          };
        case "name_asc":
        default:
          return (a: WorldItem, b: WorldItem) => a.Name.localeCompare(b.Name);
      }
    };

    const sortFunction = getSortFunction(sorttype);

    // フォルダを配列に変換してソート
    const sortedFolders = Array.from(folderMap.values()).sort((a, b) => {
      // display_orderがnullの場合は末尾に
      if (a.display_order === null && b.display_order === null) return 0;
      if (a.display_order === null) return 1;
      if (b.display_order === null) return -1;
      return a.display_order - b.display_order;
    });

    // 各フォルダ内のワールドをソートし、addition_atとdisplay_orderフィールドを削除
    sortedFolders.forEach((folder: FolderCategory) => {
      folder.Worlds.sort(sortFunction);
      folder.Worlds.forEach((world: WorldItem) => {
        delete world.addition_at;
      });
      delete (folder as any).display_order;
    });

    const result = {
      Categorys: sortedFolders
    };

    return c.json(result);

  } catch (error) {
    console.error("Error fetching WPPLS data:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export { v2Routes };
