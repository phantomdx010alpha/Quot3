ALTER TABLE `bills` ADD `footer_extras_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `bills` ADD `tail_rows_json` text DEFAULT '[]' NOT NULL;
