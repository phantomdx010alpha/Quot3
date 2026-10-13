CREATE TABLE `item_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`key_a` text NOT NULL,
	`key_b` text DEFAULT '' NOT NULL,
	`canonical` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`branch_id` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `item_rules_kind_idx` ON `item_rules` (`kind`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `item_rule_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`rule_id` text NOT NULL,
	`op` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`undone_at` text
);--> statement-breakpoint
CREATE INDEX `item_rule_log_open_idx` ON `item_rule_log` (`undone_at`,`id`);
