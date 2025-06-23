import { relations, sql } from "drizzle-orm"
import { sqliteTable, integer, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core"

// ワールド履歴テーブル 旧仕様
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
        secret_user_id: text("secret_user_id").notNull(), // system user id
        user_name: text("user_name"), // システムで追加する
        created_at: integer("created_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
        updated_at: integer("updated_at", { mode: 'timestamp' }).default(sql`(cast (unixepoch () as int))`),
    }, (table) => {
        return {
            user_id_index: unique("unique_users_user_id").on(table.user_id),
            secret_user_id_index: unique("unique_users_secret_user_id").on(table.secret_user_id)
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

// ユーザワールドタグsテーブル
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

// リレーション設定 users,tags
export const usersRelations = relations(users, ({ many }) => ({
    userWorldTags: many(user_world_tags),
}));
// リレーション設定 worlds,tags
export const worldsMasterRelations = relations(worlds_master, ({ many }) => ({
    userWorldTags: many(user_world_tags),
}));
