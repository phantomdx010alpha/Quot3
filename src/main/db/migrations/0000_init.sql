CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`branch_id` text,
	`entity` text NOT NULL,
	`entity_id` text,
	`action` text NOT NULL,
	`detail_json` text
);
--> statement-breakpoint
CREATE TABLE `backups` (
	`file` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`kind` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`bill_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bill_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`bill_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`saved_at` text NOT NULL,
	`saved_by_branch` text NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_revisions_bill_rev_uq` ON `bill_revisions` (`bill_id`,`revision`);--> statement-breakpoint
CREATE TABLE `bill_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`bill_id` text NOT NULL,
	`idx` integer NOT NULL,
	`name_runs_json` text DEFAULT '[]' NOT NULL,
	`name_plain` text DEFAULT '' NOT NULL,
	`qty` text,
	`rate` text,
	`total_override` text,
	`gst_rate` text,
	`extras_json` text DEFAULT '{}' NOT NULL,
	`cell_style_json` text,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_rows_bill_idx_uq` ON `bill_rows` (`bill_id`,`idx`);--> statement-breakpoint
CREATE TABLE `bills` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`po_seq` integer NOT NULL,
	`po_number` text NOT NULL,
	`party_id` text,
	`party_snapshot_json` text NOT NULL,
	`format_id` text NOT NULL,
	`extra_cols_json` text DEFAULT '[]' NOT NULL,
	`paper_override` text,
	`bill_date` text NOT NULL,
	`totals_json` text DEFAULT '{}' NOT NULL,
	`item_row_count` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`sync_state` text DEFAULT 'local_only' NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bills_bill_date_idx` ON `bills` (`bill_date`);--> statement-breakpoint
CREATE INDEX `bills_party_id_idx` ON `bills` (`party_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bills_branch_po_seq_uq` ON `bills` (`branch_id`,`po_seq`);--> statement-breakpoint
CREATE INDEX `bills_deleted_at_idx` ON `bills` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`po_prefix` text NOT NULL,
	`is_local` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_po_prefix_uq` ON `branches` (`po_prefix`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`bill_id` text,
	`payload_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `parties` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_norm` text NOT NULL,
	`phone` text,
	`address` text,
	`transport` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `parties_name_norm_idx` ON `parties` (`name_norm`);--> statement-breakpoint
CREATE INDEX `parties_phone_idx` ON `parties` (`phone`);--> statement-breakpoint
CREATE TABLE `po_counters` (
	`branch_id` text PRIMARY KEY NOT NULL,
	`next_seq` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bill_id` text NOT NULL,
	`op` text NOT NULL,
	`revision` integer NOT NULL,
	`payload_hash` text,
	`created_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`state` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_outbox_state_idx` ON `sync_outbox` (`state`,`id`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
