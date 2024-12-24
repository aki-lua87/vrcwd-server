import { relations, sql } from "drizzle-orm"
import { sqliteTable, integer, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core"

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
