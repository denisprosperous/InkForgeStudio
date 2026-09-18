CREATE TABLE "chapter_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"book_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"title" text NOT NULL,
	"markdown" text NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"origin" text DEFAULT 'author' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_revisions_chapter_rev_unique" ON "chapter_revisions" USING btree ("chapter_id","revision");--> statement-breakpoint
CREATE INDEX "chapter_revisions_chapter_idx" ON "chapter_revisions" USING btree ("chapter_id","user_id");