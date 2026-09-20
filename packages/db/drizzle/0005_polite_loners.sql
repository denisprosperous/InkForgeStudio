CREATE TABLE "corpus_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"book_id" uuid NOT NULL,
	"source" text NOT NULL,
	"idx" integer DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rights_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"book_id" uuid NOT NULL,
	"kind" text DEFAULT 'license' NOT NULL,
	"title" text NOT NULL,
	"holder" text NOT NULL,
	"terms" text DEFAULT '' NOT NULL,
	"territory" text DEFAULT 'world' NOT NULL,
	"exclusive" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "corpus_chunks_book_source_idx_unique" ON "corpus_chunks" USING btree ("book_id","source","idx");--> statement-breakpoint
CREATE INDEX "corpus_chunks_book_idx" ON "corpus_chunks" USING btree ("book_id","user_id");--> statement-breakpoint
CREATE INDEX "rights_records_book_idx" ON "rights_records" USING btree ("book_id","user_id");