const { z } = require('zod');

const ActorSchema = z.object({
  did: z.string(),
  handle: z.string(),
  displayName: z.string().optional(),
  avatar: z.string().optional()
}).passthrough();

const TrendingTopicSchema = z.object({
  topic: z.string(),
  link: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional().default("No context provided"),
  postCount: z.number().int().optional(),
  category: z.string().optional(),
  actors: z.array(ActorSchema).optional()
}).passthrough();

const TrendPayloadSchema = z.array(TrendingTopicSchema);

const DatabaseRowSchema = z.object({
    viewer_did: z.string(),
    is_flutter: z.boolean(),
    gap_ms: z.number().int(),
    payload_hash: z.string(),
    raw_json: z.string()
});

module.exports = {
  ActorSchema,
  TrendingTopicSchema,
  TrendPayloadSchema,
  DatabaseRowSchema
};
