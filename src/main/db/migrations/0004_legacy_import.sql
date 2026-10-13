CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`source_label` text NOT NULL,
	`branch_id` text NOT NULL,
	`po_prefix` text NOT NULL,
	`files_found` integer DEFAULT 0 NOT NULL,
	`created` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`new_parties` integer DEFAULT 0 NOT NULL,
	`po_first` integer,
	`po_last` integer,
	`next_seq_after` integer NOT NULL,
	`party_ids_json` text DEFAULT '[]' NOT NULL,
	`report_file` text,
	`undone_at` text,
	`undo_json` text
);--> statement-breakpoint
ALTER TABLE `bills` ADD `legacy_ref` text;--> statement-breakpoint
ALTER TABLE `bills` ADD `import_batch_id` text;--> statement-breakpoint
ALTER TABLE `bills` ADD `import_fingerprint` text;--> statement-breakpoint
CREATE UNIQUE INDEX `bills_import_fingerprint_uq` ON `bills` (`import_fingerprint`) WHERE `import_fingerprint` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `bills_import_batch_idx` ON `bills` (`import_batch_id`);
