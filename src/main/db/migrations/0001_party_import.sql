ALTER TABLE `parties` ADD `import_id` text;--> statement-breakpoint
CREATE INDEX `parties_import_idx` ON `parties` (`import_id`);--> statement-breakpoint
CREATE TABLE `party_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`file_name` text NOT NULL,
	`created` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`invalid` integer DEFAULT 0 NOT NULL,
	`before_json` text DEFAULT '[]' NOT NULL,
	`undone_at` text
);
