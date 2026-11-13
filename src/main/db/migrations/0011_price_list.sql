CREATE TABLE `price_tiers` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`position` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`branch_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_tiers_key_uq` ON `price_tiers` (`key`);
--> statement-breakpoint
CREATE TABLE `price_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`position` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`branch_id` text NOT NULL,
	`updated_by_seat` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_categories_name_uq` ON `price_categories` (lower(`name`)) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `price_tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL DEFAULT 0,
	`columns_json` text NOT NULL DEFAULT '[]',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`branch_id` text NOT NULL,
	`updated_by_seat` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_tabs_cat_name_uq` ON `price_tabs` (`category_id`, lower(`name`)) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `price_tabs_cat_idx` ON `price_tabs` (`category_id`, `position`);
--> statement-breakpoint
CREATE TABLE `price_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`tab_id` text NOT NULL,
	`idx` integer NOT NULL DEFAULT 0,
	`kind` text NOT NULL DEFAULT 'item',
	`name_runs_json` text NOT NULL DEFAULT '[]',
	`name_plain` text NOT NULL DEFAULT '',
	`name_norm` text NOT NULL DEFAULT '',
	`cells_json` text NOT NULL DEFAULT '{}',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`branch_id` text NOT NULL,
	`updated_by_seat` integer
);
--> statement-breakpoint
CREATE INDEX `price_rows_tab_idx` ON `price_rows` (`tab_id`, `idx`);
--> statement-breakpoint
CREATE INDEX `price_rows_norm_idx` ON `price_rows` (`name_norm`);
--> statement-breakpoint
CREATE TABLE `price_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`seat_no` integer,
	`branch_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`op` text NOT NULL,
	`path` text NOT NULL DEFAULT '',
	`before_json` text,
	`after_json` text
);
--> statement-breakpoint
CREATE INDEX `price_log_at_idx` ON `price_log` (`at`);
--> statement-breakpoint
CREATE TABLE `price_import_map` (
	`legacy_key` text PRIMARY KEY NOT NULL,
	`row_id` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`imported_at` text NOT NULL,
	`edited_since_import` integer NOT NULL DEFAULT 0
);
