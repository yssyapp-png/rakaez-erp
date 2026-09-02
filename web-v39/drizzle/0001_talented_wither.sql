CREATE TABLE `vehicle_vin_records` (
	`vin` text PRIMARY KEY NOT NULL,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`model_year` text NOT NULL,
	`engine` text DEFAULT '' NOT NULL,
	`source_name` text NOT NULL,
	`source_version` text NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vehicle_vin_make_model_idx` ON `vehicle_vin_records` (`make`,`model`);