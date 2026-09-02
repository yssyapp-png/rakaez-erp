CREATE TABLE `sales_invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`part_number` text NOT NULL,
	`description` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`vat_rate_bps` integer DEFAULT 1500 NOT NULL,
	`vat_minor` integer NOT NULL,
	`line_total_minor` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `sales_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sales_invoice_lines_values_ck" CHECK("sales_invoice_lines"."quantity" > 0 AND "sales_invoice_lines"."unit_price_minor" >= 0 AND "sales_invoice_lines"."discount_minor" >= 0 AND "sales_invoice_lines"."vat_minor" >= 0 AND "sales_invoice_lines"."line_total_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `sales_invoice_lines_invoice_idx` ON `sales_invoice_lines` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `sales_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_number` text NOT NULL,
	`invoice_type` text NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`customer_name` text NOT NULL,
	`customer_vat_number` text DEFAULT '' NOT NULL,
	`seller_name` text NOT NULL,
	`seller_vat_number` text NOT NULL,
	`seller_address` text NOT NULL,
	`payment_method` text NOT NULL,
	`currency` text DEFAULT 'SAR' NOT NULL,
	`subtotal_minor` integer NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`vat_minor` integer NOT NULL,
	`total_minor` integer NOT NULL,
	`issued_at` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "sales_invoices_totals_non_negative_ck" CHECK("sales_invoices"."subtotal_minor" >= 0 AND "sales_invoices"."discount_minor" >= 0 AND "sales_invoices"."vat_minor" >= 0 AND "sales_invoices"."total_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_invoices_number_uq` ON `sales_invoices` (`invoice_number`);--> statement-breakpoint
CREATE INDEX `sales_invoices_issued_idx` ON `sales_invoices` (`issued_at`);--> statement-breakpoint
CREATE INDEX `sales_invoices_customer_idx` ON `sales_invoices` (`customer_name`);