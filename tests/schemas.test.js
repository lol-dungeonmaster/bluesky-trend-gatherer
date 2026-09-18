const { 
    ActorSchema, 
    TrendingTopicSchema, 
    TrendPayloadSchema, 
    DatabaseRowSchema 
} = require('../src/schemas.js');

describe("Zod Schema Validations", () => {
    describe("ActorSchema", () => {
        it("should accept valid actor payloads", () => {
            const valid = { did: "did:plc:123", handle: "user.bsky.social" };
            expect(() => ActorSchema.parse(valid)).not.toThrow();
        });

        it("should throw if did or handle are missing", () => {
            const invalid = { handle: "user.bsky.social" };
            expect(() => ActorSchema.parse(invalid)).toThrow();
        });
        
        it("should allow unknown fields via passthrough", () => {
            const extra = { did: "did:1", handle: "a", extraField: true };
            const parsed = ActorSchema.parse(extra);
            expect(parsed.extraField).toBe(true);
        });
    });

    describe("TrendingTopicSchema", () => {
        it("should assign default description if missing", () => {
            const valid = { topic: "Test Topic", link: "/search" };
            const parsed = TrendingTopicSchema.parse(valid);
            expect(parsed.description).toBe("No context provided");
        });

        it("should throw if topic or link are missing", () => {
            expect(() => TrendingTopicSchema.parse({ topic: "Topic" })).toThrow();
        });
    });

    describe("TrendPayloadSchema", () => {
        it("should validate an array of trending topics", () => {
            const validArray = [{ topic: "T1", link: "L1" }, { topic: "T2", link: "L2" }];
            expect(() => TrendPayloadSchema.parse(validArray)).not.toThrow();
        });

        it("should throw on object instead of array", () => {
            const invalidObject = { topic: "T1", link: "L1" };
            expect(() => TrendPayloadSchema.parse(invalidObject)).toThrow("Invalid input: expected array, received object");
        });
    });

    describe("DatabaseRowSchema", () => {
        it("should require strict data types", () => {
            const valid = {
                viewer_did: "anonymous",
                is_flutter: false,
                gap_ms: 500,
                payload_hash: "abcdef123",
                raw_json: "[]"
            };
            expect(() => DatabaseRowSchema.parse(valid)).not.toThrow();
        });

        it("should throw on invalid data types", () => {
            const invalid = {
                viewer_did: "anonymous",
                is_flutter: "false", // string instead of boolean
                gap_ms: 500,
                payload_hash: "abcdef123",
                raw_json: "[]"
            };
            expect(() => DatabaseRowSchema.parse(invalid)).toThrow();
        });
    });
});
