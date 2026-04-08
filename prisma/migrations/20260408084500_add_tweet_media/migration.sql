-- CreateTable
CREATE TABLE "tweet_media" (
    "id" TEXT NOT NULL,
    "tweet_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "tweet_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tweet_media_tweet_id_url_key" ON "tweet_media"("tweet_id", "url");

-- CreateIndex
CREATE UNIQUE INDEX "tweet_media_tweet_id_position_key" ON "tweet_media"("tweet_id", "position");

-- CreateIndex
CREATE INDEX "tweet_media_tweet_id_position_idx" ON "tweet_media"("tweet_id", "position");

-- AddForeignKey
ALTER TABLE "tweet_media" ADD CONSTRAINT "tweet_media_tweet_id_fkey" FOREIGN KEY ("tweet_id") REFERENCES "tweets"("tweet_id") ON DELETE CASCADE ON UPDATE CASCADE;
