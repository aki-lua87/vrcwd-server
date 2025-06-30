import { relations, sql } from "drizzle-orm"
import { sqliteTable, integer, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core"

// ワールド履歴テーブル 旧旧仕様 データ保持のために残している
export const world_histories = sqliteTable(
    "world_histories",
    {
        id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
        world_id: text("world_id").notNull(),
        world_name: text("world_name"),
        registered_user_id: text("registered_user_id").notNull(),
        is_deleted: integer("is_deleted", { mode: "number" }).default(0),
        created_at: integer("created_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
        updated_at: integer("updated_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
    }, (table) => {
        return { id_index: unique("unique_world_histories_id").on(table.world_id, table.registered_user_id) }
    }
);

// ユーザテーブル
export const users = sqliteTable(
    "users",
    {
        id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
        user_id: text("user_id").notNull(), // vrc user id
        uuid_user_id: text("uuid_user_id").notNull(), // uuid user id
        user_name: text("user_name"), // システムで追加する
        created_at: integer("created_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
        updated_at: integer("updated_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
    }, (table) => {
        return {
            user_id_index: unique("unique_users_user_id").on(table.user_id),
            uuid_user_id_index: unique("unique_users_secret_user_id").on(table.uuid_user_id)
        }
    }
);

// ワールドマスタテーブル
export const worlds_master = sqliteTable(
    "worlds_master",
    {
        id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
        world_id: text("world_id").notNull(),
        world_name: text("world_name").notNull(),
        world_description: text("world_description"),
        world_thumbnail_image_url: text("world_thumbnail_image_url"),
        world_author_name: text("world_author_name").notNull(), // いれたい
        created_at: integer("created_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
        updated_at: integer("updated_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
    }, (table) => {
        return { world_id_index: unique("unique_worlds_master_world_id").on(table.world_id) }
    }
);

// ユーザフォルダテーブル
export const user_folders = sqliteTable(
    "user_folders",
    {
        id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
        user_id: text("user_id").notNull(),
        folder_name: text("folder_name").notNull(),
        is_private: integer("is_private", { mode: "number" }).default(1), // 0:公開, 1:非公開
        comment: text("comment"),
        created_at: integer("created_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
        updated_at: integer("updated_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
    }, (table) => {
        return { user_world_tags_index: unique("unique_user_folder").on(table.user_id, table.folder_name) }
    }
);

// ユーザフォルダ内アイテムテーブル
export const user_folder_items = sqliteTable(
    "user_folder_items",
    {
        id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
        user_id: text("user_id").notNull(),
        folder_id: integer("folder_id", { mode: "number" }).notNull(),
        world_id: text("world_id").notNull(),
        comment: text("comment"),
        addition_at: integer("addition_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
        created_at: integer("created_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
        updated_at: integer("updated_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
    }, (table) => {
        return { user_world_tags_index: unique("unique_user_folder_items").on(table.user_id, table.folder_id, table.world_id) }
    }
);

// ユーザワールドタグsテーブル 旧仕様 データ保持のために残している
export const user_world_tags = sqliteTable(
    "user_world_tags",
    {
        id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
        user_id: text("user_id").notNull(),
        world_id: text("world_id").notNull(),
        tag_name: text("tag_name").notNull(),
        created_at: integer("created_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
        updated_at: integer("updated_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
    }, (table) => {
        return { user_world_tags_index: unique("unique_user_world_tags").on(table.user_id, table.world_id, table.tag_name) }
    }
);

// APIキーテーブル ユーザに紐づくAPIキーを管理 APIキーを利用することで一部のAPIを利用可能
export const api_keys = sqliteTable(
    "api_keys",
    {
        id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
        user_id: text("user_id").notNull(),
        api_key: text("api_key").notNull(), // APIキー
        is_active: integer("is_active", { mode: "number" }).default(1), // 0:無効, 1:有効
        created_at: integer("created_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
        updated_at: integer("updated_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
    }, (table) => {
        return { api_key_index: unique("unique_api_keys").on(table.user_id, table.api_key) }
    }
);

// リレーション設定 users
export const usersRelations = relations(users, ({ many }) => ({
    userWorldTags: many(user_world_tags),
    // userWorldHistories: many(world_histories), 消す
    userFolders: many(user_folders),
    userFolderItems: many(user_folder_items),
}));

// リレーション設定 worlds
export const worldsMasterRelations = relations(worlds_master, ({ many }) => ({
    userWorldTags: many(user_world_tags),
    userWorldHistories: many(world_histories),
    userFolderItems: many(user_folder_items),
}));

// リレーション設定 folders
export const userFoldersRelations = relations(user_folders, ({ many }) => ({
    userFolderItems: many(user_folder_items),
}));
