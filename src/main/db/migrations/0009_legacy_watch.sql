CREATE TABLE `legacy_watch_files` (
	`file_name` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`content_hash` text DEFAULT '' NOT NULL,
	`last_result` text NOT NULL,
	`bill_id` text,
	`seen_at` text NOT NULL
);--> statement-breakpoint
CREATE TABLE `legacy_watch_bills` (
	`bill_id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`source_mtime_ms` integer NOT NULL,
	`content_fp` text NOT NULL,
	`content_json` text NOT NULL,
	`applied_revision` integer NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE TABLE `legacy_watch_review` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`party` text DEFAULT '' NOT NULL,
	`bill_date` text DEFAULT '' NOT NULL,
	`total` text DEFAULT '' NOT NULL,
	`mtime_ms` integer NOT NULL,
	`why` text NOT NULL,
	`reason` text NOT NULL,
	`candidates_json` text DEFAULT '[]' NOT NULL,
	`payload_text` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolution` text
);--> statement-breakpoint
CREATE INDEX `legacy_watch_review_open_idx` ON `legacy_watch_review` (`resolved_at`);--> statement-breakpoint
CREATE TABLE `legacy_watch_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`file_name` text NOT NULL,
	`bill_id` text,
	`party` text DEFAULT '' NOT NULL,
	`po_number` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`revision` integer,
	`prev_revision` integer,
	`prev_source_mtime_ms` integer,
	`undone_at` text
);--> statement-breakpoint
CREATE INDEX `legacy_watch_activity_at_idx` ON `legacy_watch_activity` (`at`);
