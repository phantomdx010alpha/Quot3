CREATE TABLE `ai_text_vectors` (
	`model_id` text NOT NULL,
	`text_hash` text NOT NULL,
	`dim` integer NOT NULL,
	`vector` blob NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`model_id`, `text_hash`)
);
