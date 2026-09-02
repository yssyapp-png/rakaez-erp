CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_events_org_created_idx` ON `audit_events` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text NOT NULL,
	`location_id` text NOT NULL,
	`part_id` text NOT NULL,
	`shelf_code` text NOT NULL,
	`on_hand` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`reorder_point` integer DEFAULT 0 NOT NULL,
	`offline_allocation` integer DEFAULT 0 NOT NULL,
	`unit_cost_minor` integer DEFAULT 0 NOT NULL,
	`sale_price_minor` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'SAR' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `stock_locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_non_negative_ck" CHECK("inventory_items"."on_hand" >= 0 AND "inventory_items"."reserved" >= 0 AND "inventory_items"."reorder_point" >= 0 AND "inventory_items"."offline_allocation" >= 0),
	CONSTRAINT "inventory_reserved_limit_ck" CHECK("inventory_items"."reserved" <= "inventory_items"."on_hand"),
	CONSTRAINT "inventory_prices_non_negative_ck" CHECK("inventory_items"."unit_cost_minor" >= 0 AND "inventory_items"."sale_price_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_location_part_uq` ON `inventory_items` (`location_id`,`part_id`);--> statement-breakpoint
CREATE INDEX `inventory_org_shop_idx` ON `inventory_items` (`organization_id`,`shop_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`display_name_ar` text NOT NULL,
	`display_name_en` text NOT NULL,
	`status` text DEFAULT 'trial' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `part_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`part_id` text NOT NULL,
	`locale` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`review_status` text DEFAULT 'draft' NOT NULL,
	`reviewed_by` text,
	`source_version` text NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `part_translations_part_locale_uq` ON `part_translations` (`part_id`,`locale`);--> statement-breakpoint
CREATE TABLE `parts` (
	`id` text PRIMARY KEY NOT NULL,
	`manufacturer_id` text,
	`part_number_original` text NOT NULL,
	`part_number_normalized` text NOT NULL,
	`brand_code` text NOT NULL,
	`gtin` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`source_name` text NOT NULL,
	`source_version` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parts_brand_number_uq` ON `parts` (`brand_code`,`part_number_normalized`);--> statement-breakpoint
CREATE INDEX `parts_number_idx` ON `parts` (`part_number_normalized`);--> statement-breakpoint
CREATE TABLE `shops` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`city` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shops_org_code_uq` ON `shops` (`organization_id`,`code`);--> statement-breakpoint
CREATE INDEX `shops_org_idx` ON `shops` (`organization_id`);--> statement-breakpoint
CREATE TABLE `stock_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text NOT NULL,
	`code` text NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_locations_shop_code_uq` ON `stock_locations` (`shop_id`,`code`);--> statement-breakpoint
CREATE INDEX `stock_locations_org_idx` ON `stock_locations` (`organization_id`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shop_id` text NOT NULL,
	`inventory_item_id` text NOT NULL,
	`movement_type` text NOT NULL,
	`quantity_delta` integer NOT NULL,
	`reference_type` text NOT NULL,
	`reference_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`actor_id` text NOT NULL,
	`device_id` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_movements_idempotency_uq` ON `stock_movements` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `stock_movements_item_idx` ON `stock_movements` (`inventory_item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workshop_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`workshop_name` text NOT NULL,
	`vehicle_vin` text,
	`vehicle_label` text NOT NULL,
	`requested_part_number` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workshop_requests_quantity_positive_ck" CHECK("workshop_requests"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `workshop_requests_org_status_idx` ON `workshop_requests` (`organization_id`,`status`);