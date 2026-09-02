CREATE TABLE `cash_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`movement_type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`cashier_name` text NOT NULL,
	`deposit_reference` text DEFAULT '' NOT NULL,
	`invoice_id` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `sales_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cash_movements_amount_positive_ck" CHECK("cash_movements"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE INDEX `cash_movements_created_idx` ON `cash_movements` (`created_at`);--> statement-breakpoint
CREATE INDEX `cash_movements_type_idx` ON `cash_movements` (`movement_type`);