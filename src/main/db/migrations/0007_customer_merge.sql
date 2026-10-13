CREATE TABLE `party_merge_log` (
	`id` text PRIMARY KEY NOT NULL,
	`survivor_id` text NOT NULL,
	`merged_id` text NOT NULL,
	`kind` text NOT NULL,
	`batch_id` text NOT NULL,
	`by_branch` text NOT NULL,
	`at` text NOT NULL,
	`survivor_before_json` text NOT NULL,
	`bill_ids_json` text NOT NULL,
	`undone_at` text
);--> statement-breakpoint
CREATE INDEX `party_merge_log_at_idx` ON `party_merge_log` (`at`);--> statement-breakpoint
CREATE TABLE `party_not_same` (
	`a_id` text NOT NULL,
	`b_id` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`a_id`, `b_id`)
);
