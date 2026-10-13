CREATE TABLE `sync_record_state` (
	`kind` text NOT NULL,
	`rec_id` text NOT NULL,
	`base_version` integer NOT NULL,
	`base_hash` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`synced_at` text,
	PRIMARY KEY(`kind`, `rec_id`)
);--> statement-breakpoint
CREATE TABLE `sync_aside` (
	`kind` text NOT NULL,
	`rec_id` text NOT NULL,
	`version` integer NOT NULL,
	`min_reader_ver` integer NOT NULL,
	`payload_json` text NOT NULL,
	`seen_at` text NOT NULL,
	PRIMARY KEY(`kind`, `rec_id`)
);--> statement-breakpoint
ALTER TABLE `parties` ADD `merged_into` text;
